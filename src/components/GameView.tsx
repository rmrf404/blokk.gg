"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { shareOnX } from "@/lib/share";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BALL_RADIUS,
  PADDLE_MARGIN,
  PADDLE_SIZE,
  PADDLE_SPEED,
  PADDLE_WIDTH,
  applyInput,
  cloneMatchState,
  createMatch,
  setPlayerPaddleTarget,
  serializePlayerState,
  tickCpu,
  tickMatch,
  type PongMatchState,
} from "@/engine/pong";
import type {
  ClientMessage,
  GameResultReason,
  InputAction,
  MatchStatePayload,
  PlayerSlot,
  SerializedPlayerState,
  ServerMessage,
} from "@/multiplayer/types";
import { getPartyServerUrl } from "@/lib/partyserver";
import { useRouter } from "next/navigation";
import { useResponsiveGameLayout } from "./GameControls";

interface GameViewProps {
  seed: number;
  mode: "cpu" | "pvp";
  roomId?: string;
  joinToken?: string;
  opponentName?: string;
  playerName?: string;
}

const PADDLE_POSITION_SEND_INTERVAL_MS = 1000 / 60;

/** Engine initial paddle Y: centered in arena. */
const INITIAL_PADDLE_Y = ARENA_HEIGHT / 2 - PADDLE_SIZE / 2;

/**
 * Fixed interpolation delay in milliseconds.
 * Kept minimal (~1.2 snapshots at 60 Hz) to minimize visual mismatch between
 * the predicted paddle (real-time) and the interpolated ball/opponent.
 * A large delay causes "ball bounces off nothing" because the server decided
 * the collision based on the paddle position from delay-ms ago.
 */
const INTERPOLATION_DELAY_MS = 20;

/** Server tick duration — must match TICK_MS on the server. */
const TICK_MS = 1000 / 60;

/** EMA smoothing factor for server clock offset estimation. */
const CLOCK_OFFSET_ALPHA = 0.1;

interface ArenaSnapshot {
  elapsedMs: number;
  winnerSlot?: "top" | "bottom" | null;
  self: SerializedPlayerState;
  opponent: SerializedPlayerState;
  balls: MatchStatePayload["balls"];
}

function formatClock(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatResultReason(reason: GameResultReason | null, didWin: boolean) {
  switch (reason) {
    case "disconnect":
      return didWin ? "Opponent disconnected" : "Connection dropped";
    case "score":
    default:
      return didWin ? "You hit the winning point" : "They reached the winning point";
  }
}

function createArenaSnapshot(state: PongMatchState): ArenaSnapshot {
  return {
    elapsedMs: state.elapsedMs,
    winnerSlot: state.winnerSlot,
    self: serializePlayerState(state.players.top),
    opponent: serializePlayerState(state.players.bottom),
    balls: state.balls.map((ball) => ({ ...ball })),
  };
}

const Arena = memo(function Arena({
  snapshot,
  selfPaddleLeft,
  interactive,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  snapshot: ArenaSnapshot;
  selfPaddleLeft?: number;
  interactive?: boolean;
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const paddleThickness = (PADDLE_WIDTH / ARENA_WIDTH) * 100;
  const resolvedSelfPaddleLeft = selfPaddleLeft ?? snapshot.self.paddleY;

  return (
    <div
      className={[
        "relative h-full w-full overflow-hidden",
        interactive ? "cursor-ew-resize" : "",
      ].filter(Boolean).join(" ")}
      style={{
        ...(interactive ? { touchAction: "none", WebkitTapHighlightColor: "transparent" } as React.CSSProperties : {}),
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Border overlay — inverts: black on white half, white on black half */}
      <div
        className="pointer-events-none absolute inset-0 border border-white"
        style={{ mixBlendMode: "difference" }}
      />


      {/* Player paddle (bottom) — white on black half */}
      <div
        className="absolute bg-white will-change-transform"
        style={{
          left: `${(resolvedSelfPaddleLeft / ARENA_HEIGHT) * 100}%`,
          bottom: `${(PADDLE_MARGIN / ARENA_WIDTH) * 100}%`,
          width: `${(snapshot.self.paddleSize / ARENA_HEIGHT) * 100}%`,
          height: `${paddleThickness}%`,
          borderRadius: "1px",
          mixBlendMode: "difference",
        }}
      />

      {/* Opponent paddle (top) — black on white half */}
      <div
        className="absolute bg-white will-change-transform"
        style={{
          left: `${(snapshot.opponent.paddleY / ARENA_HEIGHT) * 100}%`,
          top: `${(PADDLE_MARGIN / ARENA_WIDTH) * 100}%`,
          width: `${(snapshot.opponent.paddleSize / ARENA_HEIGHT) * 100}%`,
          height: `${paddleThickness}%`,
          borderRadius: "1px",
          mixBlendMode: "difference",
        }}
      />

      {/* Balls */}
      {snapshot.balls.map((ball) => (
        <div
          key={ball.id}
          className="absolute aspect-square rounded-full bg-white will-change-transform"
          style={{
            left: `${(ball.y / ARENA_HEIGHT) * 100}%`,
            top: `${100 - (ball.x / ARENA_WIDTH) * 100}%`,
            width: "2.4%",
            transform: "translate(-50%, -50%)",
            mixBlendMode: "difference",
          }}
        />
      ))}
    </div>
  );
});

type ArenaPointerHandler = (event: React.PointerEvent<HTMLDivElement>) => void;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function applyPredictedInputDirection(current: -1 | 0 | 1, action: InputAction): -1 | 0 | 1 {
  switch (action) {
    case "move_up_start":
      return -1;
    case "move_down_start":
      return 1;
    case "move_up_stop":
      return current === -1 ? 0 : current;
    case "move_down_stop":
      return current === 1 ? 0 : current;
  }
}

function useMobileSlideControls({
  enabled,
  isMobile,
  serverPaddleLeft,
  paddleSize,
  onPaddlePosition,
  onDraggingChange,
}: {
  enabled: boolean;
  isMobile: boolean;
  serverPaddleLeft: number;
  paddleSize: number;
  onPaddlePosition: (paddleLeft: number) => void;
  onDraggingChange?: (dragging: boolean) => void;
}) {
  const activePointerIdRef = useRef<number | null>(null);
  const pointerOffsetRef = useRef(0);
  const paddleSizeRef = useRef(paddleSize);
  const [dragPaddleLeft, setDragPaddleLeft] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    paddleSizeRef.current = paddleSize;
  }, [paddleSize]);

  useEffect(() => {
    if (enabled || !isDragging) return;
    activePointerIdRef.current = null;
    const animationFrame = window.requestAnimationFrame(() => {
      onDraggingChange?.(false);
      setIsDragging(false);
      setDragPaddleLeft(null);
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [enabled, isDragging, onDraggingChange]);

  const displayPaddleLeft = enabled
    ? dragPaddleLeft ?? serverPaddleLeft
    : serverPaddleLeft;

  const updatePaddleFromPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const coalesced = typeof event.nativeEvent.getCoalescedEvents === "function"
      ? event.nativeEvent.getCoalescedEvents()
      : [];
    const sample = coalesced[coalesced.length - 1] ?? event.nativeEvent;
    const rect = event.currentTarget.getBoundingClientRect();
    const relativeX = ((sample.clientX - rect.left) / rect.width) * ARENA_HEIGHT;
    const nextLeft = clamp(
      relativeX - pointerOffsetRef.current,
      0,
      ARENA_HEIGHT - paddleSizeRef.current,
    );

    setDragPaddleLeft(nextLeft);
    onPaddlePosition(nextLeft);
  }, [onPaddlePosition]);

  const handlePointerDown = useCallback<ArenaPointerHandler>((event) => {
    if (!enabled || !isMobile) return;
    activePointerIdRef.current = event.pointerId;
    onDraggingChange?.(true);
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();
    const relativeX = ((event.clientX - rect.left) / rect.width) * ARENA_HEIGHT;
    pointerOffsetRef.current = relativeX - displayPaddleLeft;
    updatePaddleFromPointer(event);
  }, [displayPaddleLeft, enabled, isMobile, onDraggingChange, updatePaddleFromPointer]);

  const handlePointerMove = useCallback<ArenaPointerHandler>((event) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    updatePaddleFromPointer(event);
  }, [updatePaddleFromPointer]);

  const handlePointerUp = useCallback<ArenaPointerHandler>((event) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.preventDefault();
    activePointerIdRef.current = null;
    onDraggingChange?.(false);
    setIsDragging(false);
    setDragPaddleLeft(null);
  }, [onDraggingChange]);

  return isMobile
    ? {
        displayPaddleLeft,
        isDragging,
        handlePointerDown,
        handlePointerMove,
        handlePointerUp,
      }
    : {
        displayPaddleLeft: serverPaddleLeft,
        isDragging: false,
        handlePointerDown: undefined,
        handlePointerMove: undefined,
        handlePointerUp: undefined,
      };
}

function usePaddleKeyboard({
  enabled,
  onAction,
  winner,
  onPlayAgain,
}: {
  enabled: boolean;
  onAction: (action: InputAction) => void;
  winner: "player" | "opponent" | null;
  onPlayAgain?: () => void;
}) {
  useEffect(() => {
    if (!enabled) return;

    const held = new Set<string>();
    const startAction = (key: string): InputAction | null => {
      switch (key) {
        case "ArrowLeft":
        case "a":
        case "A":
          return "move_up_start";
        case "ArrowRight":
        case "d":
        case "D":
          return "move_down_start";
        default:
          return null;
      }
    };
    const stopAction = (key: string): InputAction | null => {
      switch (key) {
        case "ArrowLeft":
        case "a":
        case "A":
          return "move_up_stop";
        case "ArrowRight":
        case "d":
        case "D":
          return "move_down_stop";
        default:
          return null;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if ((event.key === "r" || event.key === "R") && winner) {
        event.preventDefault();
        onPlayAgain?.();
        return;
      }

      if (event.repeat || held.has(event.key)) return;
      const action = startAction(event.key);
      if (!action) return;
      event.preventDefault();
      held.add(event.key);
      onAction(action);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      held.delete(event.key);
      const action = stopAction(event.key);
      if (!action) return;
      event.preventDefault();
      onAction(action);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [enabled, onAction, onPlayAgain, winner]);
}

function GameShell({
  snapshot,
  countdown,
  waiting,
  winner,
  resultReason,
  selfPaddleLeftOverride,
  onAction,
  onPaddlePosition,
  onMobileDraggingChange,
  onPlayAgain,
  rematchPending,
  opponentRematchRequested,
  opponentLeft,
  onFindNewOpponent,
  onLobby,
  eloDelta,
  newElo,
}: {
  snapshot: ArenaSnapshot;
  countdown: number;
  waiting: boolean;
  winner: "player" | "opponent" | null;
  resultReason: GameResultReason | null;
  selfPaddleLeftOverride?: number | null;
  onAction: (action: InputAction) => void;
  onPaddlePosition: (paddleLeft: number) => void;
  onMobileDraggingChange?: (dragging: boolean) => void;
  onPlayAgain?: () => void;
  rematchPending?: boolean;
  opponentRematchRequested?: boolean;
  opponentLeft?: boolean;
  onFindNewOpponent?: () => void;
  onLobby: () => void;
  eloDelta?: number | null;
  newElo?: number | null;
}) {
  const { arenaHeight, arenaWidth, isMobile } = useResponsiveGameLayout();
  const controlsDisabled = waiting || countdown > 0 || !!winner;
  const sidePanelClass = isMobile
    ? "flex w-full min-h-[76px] flex-row items-center justify-between gap-3"
    : "flex w-[132px] min-h-[180px] flex-col justify-between";
  const mobileSlideControls = useMobileSlideControls({
    enabled: !controlsDisabled,
    isMobile,
    serverPaddleLeft: selfPaddleLeftOverride ?? snapshot.self.paddleY,
    paddleSize: snapshot.self.paddleSize,
    onPaddlePosition,
    onDraggingChange: onMobileDraggingChange,
  });

  usePaddleKeyboard({
    enabled: true,
    onAction,
    winner,
    onPlayAgain,
  });

  return (
    <div className="relative flex h-dvh w-full items-center justify-center overflow-hidden text-white" style={{ background: "linear-gradient(to bottom, #ffffff 50%, #000000 50%)" }}>
      <div className="relative flex flex-col items-center gap-3">
        {/* Main arena row: scores flanking arena */}
        <div className={`flex items-center ${isMobile ? "flex-col gap-2" : "gap-6"}`}>
          {/* Opponent score */}
          <div className={`${sidePanelClass} ${isMobile ? "" : "items-end text-right"}`} style={{ mixBlendMode: "difference" }}>
            <div>
              <p className="truncate font-mono text-[10px] uppercase tracking-[0.2em] text-white/50">
                {snapshot.opponent.displayName}
              </p>
              <p className="font-mono text-5xl font-black tabular-nums tracking-tight text-white">
                {snapshot.opponent.score}
              </p>
            </div>
          </div>

          {/* Arena */}
          <div className="relative" style={{ width: arenaWidth, height: arenaHeight }}>
            <Arena
              snapshot={snapshot}
              selfPaddleLeft={mobileSlideControls.displayPaddleLeft}
              interactive={isMobile && !controlsDisabled}
              onPointerDown={mobileSlideControls?.handlePointerDown}
              onPointerMove={mobileSlideControls?.handlePointerMove}
              onPointerUp={mobileSlideControls?.handlePointerUp}
            />

            {/* Countdown */}
            {countdown > 0 && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/95">
                <p className="animate-scale-in font-mono text-8xl font-black text-white" key={countdown}>
                  {countdown}
                </p>
              </div>
            )}

            {/* Waiting */}
            {waiting && countdown < 0 && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/95">
                <p className="animate-pulse font-mono text-2xl font-black tracking-[0.28em] text-white/60">
                  STANDBY
                </p>
              </div>
            )}

            {/* Winner */}
            {winner && (
              <div className="animate-fade-in absolute inset-0 flex flex-col items-center justify-center bg-black/95 px-6 text-center">
                <p className="font-mono text-5xl font-black tracking-[0.18em] text-white">
                  {winner === "player" ? "YOU WIN" : "YOU LOSE"}
                </p>
                <p className="mt-4 max-w-md text-sm text-white/40">
                  {formatResultReason(resultReason, winner === "player")}
                </p>
                {eloDelta !== null && eloDelta !== undefined && (
                  <div className="mt-3 flex flex-col items-center gap-0.5">
                    <p className="font-mono text-lg font-bold tracking-wider text-white">
                      {eloDelta > 0 ? "+" : ""}{eloDelta} ELO
                    </p>
                    {newElo !== null && newElo !== undefined && (
                      <p className="font-mono text-xs text-white/30">
                        Rating: {newElo}
                      </p>
                    )}
                  </div>
                )}
                {opponentLeft ? (
                  <div className="mt-5 rounded-sm border border-white/45 bg-white/10 px-5 py-3">
                    <p className="font-mono text-xs font-black uppercase tracking-[0.28em] text-white">
                      Opponent Left
                    </p>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/70">
                      They closed the match or returned to lobby
                    </p>
                  </div>
                ) : opponentRematchRequested ? (
                  <div className="mt-5 animate-pulse rounded-sm border border-white bg-white px-5 py-3">
                    <p className="font-mono text-xs font-black uppercase tracking-[0.28em] text-black">
                      Opponent Wants A Rematch
                    </p>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-black/70">
                      Hit play again to start the next round
                    </p>
                  </div>
                ) : rematchPending ? (
                  <div className="mt-5 rounded-sm border border-white/25 bg-white/8 px-5 py-3">
                    <p className="font-mono text-xs font-black uppercase tracking-[0.28em] text-white">
                      Rematch Requested
                    </p>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/70">
                      Waiting for opponent to accept
                    </p>
                  </div>
                ) : null}
                <div className="mt-8 flex gap-3">
                  {!opponentLeft && (
                    <button
                      type="button"
                      onClick={onPlayAgain}
                      disabled={!onPlayAgain || rematchPending}
                      className="rounded-sm border border-white bg-white px-6 py-3 font-mono text-xs font-bold uppercase tracking-[0.28em] text-black transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:border-white/20 disabled:bg-white/20 disabled:text-white/50"
                    >
                      {rematchPending ? "Waiting..." : "Play Again"}
                    </button>
                  )}
                  {opponentLeft && (
                    <button
                      type="button"
                      onClick={onFindNewOpponent}
                      className="rounded-sm border border-white bg-white px-6 py-3 font-mono text-xs font-bold uppercase tracking-[0.28em] text-black transition-colors hover:bg-neutral-100"
                    >
                      Find Opponent
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onLobby}
                    className="rounded-sm border border-white/30 bg-black px-6 py-3 font-mono text-xs font-bold uppercase tracking-[0.28em] text-white/60 transition-colors hover:border-white/60 hover:text-white"
                  >
                    Lobby
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const result = winner === "player" ? "Won" : "Lost";
                      const text = `${result} a game of Pong on blokk.gg! 🏓\n\n${snapshot.self.displayName} ${snapshot.self.score} - ${snapshot.opponent.score} ${snapshot.opponent.displayName}\n\nhttps://blokk.gg`;
                      shareOnX(text);
                    }}
                    className="rounded-sm border border-white/30 bg-black px-6 py-3 font-mono text-xs font-bold uppercase tracking-[0.28em] text-white/60 transition-colors hover:border-white/60 hover:text-white"
                  >
                    Share on X
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Player score */}
          <div className={`${sidePanelClass} ${isMobile ? "" : "items-start text-left"}`} style={{ mixBlendMode: "difference" }}>
            <div>
              <p className="truncate font-mono text-[10px] uppercase tracking-[0.2em] text-white/50">
                {snapshot.self.displayName}
              </p>
              <p className="font-mono text-5xl font-black tabular-nums tracking-tight text-white">
                {snapshot.self.score}
              </p>
            </div>
          </div>
        </div>

        {/* Clock */}
        <div className="flex min-h-[16px] items-center gap-3" style={{ mixBlendMode: "difference" }}>
          <p className="font-mono text-[10px] tracking-[0.16em] text-white/60">{formatClock(snapshot.elapsedMs)}</p>
        </div>

        {isMobile && (
          <div className="mt-1">
            <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/50" style={{ mixBlendMode: "difference" }}>
              Slide on the arena to move your paddle
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function LocalGameView({
  seed,
  opponentName,
  playerName,
}: Pick<GameViewProps, "seed" | "opponentName" | "playerName">) {
  const router = useRouter();
  const [initialMatch] = useState<PongMatchState>(() => {
    const match = createMatch(seed, playerName ?? "You", opponentName ?? "CPU Nemesis");
    match.players.bottom.isCpu = true;
    return match;
  });
  const stateRef = useRef<PongMatchState>(initialMatch);
  const [snapshot, setSnapshot] = useState<ArenaSnapshot>(() =>
    createArenaSnapshot(cloneMatchState(initialMatch)),
  );
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    if (countdown > 0 || stateRef.current.winnerSlot) return;

    let animationFrame = 0;
    let lastTime = performance.now();

    const loop = (now: number) => {
      const delta = Math.min(32, now - lastTime);
      lastTime = now;
      tickCpu(stateRef.current, "bottom");
      tickMatch(stateRef.current, delta);
      setSnapshot(createArenaSnapshot(cloneMatchState(stateRef.current)));
      animationFrame = window.requestAnimationFrame(loop);
    };

    animationFrame = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [countdown]);

  const onAction = useCallback((action: InputAction) => {
    applyInput(stateRef.current, "top", action);
    setSnapshot(createArenaSnapshot(cloneMatchState(stateRef.current)));
  }, []);

  const onPaddlePosition = useCallback((paddleLeft: number) => {
    setPlayerPaddleTarget(stateRef.current, "top", paddleLeft);
    setSnapshot(createArenaSnapshot(cloneMatchState(stateRef.current)));
  }, []);

  const winner = snapshot.winnerSlot === "top"
    ? "player"
    : snapshot.winnerSlot === "bottom"
      ? "opponent"
      : null;

  return (
    <GameShell
      snapshot={snapshot}
      countdown={countdown}
      waiting={false}
      winner={winner}
      resultReason={winner ? "score" : null}
      onAction={onAction}
      onPaddlePosition={onPaddlePosition}
      onLobby={() => router.replace("/lobby")}
    />
  );
}

// ---------------------------------------------------------------------------
// Networked (PvP) game view
// ---------------------------------------------------------------------------

interface TimedSnapshot {
  serverTimeMs: number;
  snapshot: ArenaSnapshot;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Interpolate between two arena snapshots without overshooting paddle reversals. */
function interpolateSnapshots(prev: ArenaSnapshot, next: ArenaSnapshot, t: number): ArenaSnapshot {
  const prevBalls = new Map(prev.balls.map((b) => [b.id, b]));

  return {
    ...next,
    elapsedMs: lerp(prev.elapsedMs, next.elapsedMs, t),
    opponent: {
      ...next.opponent,
      paddleY: lerp(prev.opponent.paddleY, next.opponent.paddleY, t),
    },
    balls: next.balls.map((ball) => {
      const p = prevBalls.get(ball.id);
      if (!p) return ball;
      return { ...ball, x: lerp(p.x, ball.x, t), y: lerp(p.y, ball.y, t) };
    }),
  };
}

function NetworkedGameView({
  roomId,
  joinToken,
}: Pick<GameViewProps, "roomId" | "joinToken">) {
  const router = useRouter();
  // --- WebSocket & sequencing --------------------------------------------------
  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(0);
  const joinedSlotRef = useRef<PlayerSlot | null>(null);
  const winnerRef = useRef<"player" | "opponent" | null>(null);
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Paddle position sending (mobile touch) ----------------------------------
  const pendingPaddleUpdateRef = useRef<{ seq: number; paddleY: number } | null>(null);
  const queuedPaddleLeftRef = useRef<number | null>(null);
  const paddleFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPaddleSendAtRef = useRef(0);

  // --- Snapshot interpolation --------------------------------------------------
  const snapshotBufferRef = useRef<TimedSnapshot[]>([]);
  const renderTimeRef = useRef<number | null>(null);
  const gameActiveRef = useRef(false);

  // --- Server clock (EMA-smoothed offset) ------------------------------------
  const clockOffsetRef = useRef<number | null>(null);

  // --- Own paddle prediction ---------------------------------------------------
  const serverPaddleRef = useRef(INITIAL_PADDLE_Y);
  const predictedPaddleRef = useRef(INITIAL_PADDLE_Y);
  const predictedTargetPaddleRef = useRef<number | null>(null);
  const predictedDirRef = useRef<-1 | 0 | 1>(0);
  const touchDraggingRef = useRef(false);

  // --- Input replay reconciliation (Gambetta) --------------------------------
  const unackedInputsRef = useRef<Array<{ seq: number; action: InputAction }>>(
    [],
  );

  // --- React state -------------------------------------------------------------
  const [countdown, setCountdown] = useState(-1);
  const [waiting, setWaiting] = useState(true);
  const [snapshot, setSnapshot] = useState<ArenaSnapshot>({
    elapsedMs: 0,
    self: { paddleY: INITIAL_PADDLE_Y, paddleSize: PADDLE_SIZE, score: 0, displayName: "Player" },
    opponent: { paddleY: INITIAL_PADDLE_Y, paddleSize: PADDLE_SIZE, score: 0, displayName: "Opponent" },
    balls: [],
  });
  const [winner, setWinner] = useState<"player" | "opponent" | null>(null);
  const [resultReason, setResultReason] = useState<GameResultReason | null>(null);
  const [rematchPending, setRematchPending] = useState(false);
  const [opponentRematchRequested, setOpponentRematchRequested] = useState(false);
  const [opponentLeft, setOpponentLeft] = useState(false);
  const [eloDelta, setEloDelta] = useState<number | null>(null);
  const [newElo, setNewElo] = useState<number | null>(null);
  const [selfPaddleLeftOverride, setSelfPaddleLeftOverride] = useState<number | null>(INITIAL_PADDLE_Y);

  useEffect(() => { winnerRef.current = winner; }, [winner]);
  const gameActive = !waiting && countdown <= 0 && !winner;
  useEffect(() => { gameActiveRef.current = gameActive; }, [gameActive]);

  // --- Paddle position flush helpers -------------------------------------------
  const clearQueuedPaddleFlush = useCallback(() => {
    if (!paddleFlushTimeoutRef.current) return;
    clearTimeout(paddleFlushTimeoutRef.current);
    paddleFlushTimeoutRef.current = null;
  }, []);

  const estimateServerTimeMs = useCallback(() => {
    if (clockOffsetRef.current === null) {
      return undefined;
    }
    return performance.now() + clockOffsetRef.current;
  }, []);

  const flushQueuedPaddlePosition = useCallback(() => {
    clearQueuedPaddleFlush();
    const ws = wsRef.current;
    const paddleY = queuedPaddleLeftRef.current;
    queuedPaddleLeftRef.current = null;
    if (paddleY === null || ws?.readyState !== WebSocket.OPEN) return;

    const nextSeq = seqRef.current++;
    lastPaddleSendAtRef.current = performance.now();
    pendingPaddleUpdateRef.current = { seq: nextSeq, paddleY };
    ws.send(JSON.stringify({
      type: "paddle_target",
      seq: nextSeq,
      paddleY,
      clientTimeMs: estimateServerTimeMs(),
    } satisfies ClientMessage));
  }, [clearQueuedPaddleFlush, estimateServerTimeMs]);

  const schedulePaddlePositionFlush = useCallback(() => {
    const elapsed = performance.now() - lastPaddleSendAtRef.current;
    if (elapsed >= PADDLE_POSITION_SEND_INTERVAL_MS) {
      flushQueuedPaddlePosition();
      return;
    }
    if (paddleFlushTimeoutRef.current) return;
    paddleFlushTimeoutRef.current = setTimeout(flushQueuedPaddlePosition, PADDLE_POSITION_SEND_INTERVAL_MS - elapsed);
  }, [flushQueuedPaddlePosition]);

  useEffect(() => () => clearQueuedPaddleFlush(), [clearQueuedPaddleFlush]);

  // Helper: reset all transient state for a new match
  const resetTransientState = useCallback(() => {
    pendingPaddleUpdateRef.current = null;
    queuedPaddleLeftRef.current = null;
    snapshotBufferRef.current = [];
    renderTimeRef.current = null;
    clockOffsetRef.current = null;
    serverPaddleRef.current = INITIAL_PADDLE_Y;
    predictedPaddleRef.current = INITIAL_PADDLE_Y;
    predictedTargetPaddleRef.current = null;
    predictedDirRef.current = 0;
    touchDraggingRef.current = false;
    unackedInputsRef.current = [];
    clearQueuedPaddleFlush();
    setSelfPaddleLeftOverride(INITIAL_PADDLE_Y);
  }, [clearQueuedPaddleFlush]);

  // --- WebSocket connection ----------------------------------------------------
  useEffect(() => {
    if (!roomId || !joinToken) return;

    const ws = new WebSocket(getPartyServerUrl(`/parties/gameroom/${roomId}`));
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join_room", joinToken } satisfies ClientMessage));
      connectionTimeoutRef.current = setTimeout(() => {
        connectionTimeoutRef.current = null;
        ws.close();
        router.replace("/lobby");
      }, 5000);
    };

    ws.onerror = () => {
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
      ws.close();
      router.replace("/lobby");
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as ServerMessage;
      switch (msg.type) {
        case "room_joined":
          if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
            connectionTimeoutRef.current = null;
          }
          joinedSlotRef.current = msg.slot;
          setWaiting(true);
          break;

        case "countdown":
          setWinner(null);
          setResultReason(null);
          setRematchPending(false);
          setOpponentRematchRequested(false);
          setOpponentLeft(false);
          resetTransientState();
          setWaiting(true);
          setCountdown(msg.value);
          break;

        case "game_start":
          setCountdown(0);
          setWaiting(false);
          break;

        // ----- Core netcode: receive authoritative state -----------------------
        case "match_state": {
          setWaiting(false);
          setOpponentLeft(false);

          // ACK pending paddle position
          if (
            pendingPaddleUpdateRef.current
            && msg.state.lastProcessedInputSeq >= pendingPaddleUpdateRef.current.seq
          ) {
            pendingPaddleUpdateRef.current = null;
          }

          const snap: ArenaSnapshot = {
            elapsedMs: msg.state.elapsedMs,
            self: msg.state.self,
            opponent: msg.state.opponent,
            balls: msg.state.balls,
          };

          // EMA-smoothed server clock offset
          const rawOffset = msg.state.serverTimeMs - performance.now();
          if (clockOffsetRef.current === null) {
            clockOffsetRef.current = rawOffset;
          } else {
            clockOffsetRef.current += CLOCK_OFFSET_ALPHA * (rawOffset - clockOffsetRef.current);
          }

          serverPaddleRef.current = snap.self.paddleY;

          // --- Gambetta-style input replay reconciliation ---
          // Prune acknowledged inputs
          unackedInputsRef.current = unackedInputsRef.current.filter(
            (input) => input.seq > msg.state.lastProcessedInputSeq,
          );

          if (predictedTargetPaddleRef.current !== null) {
            // Mobile touch: absolute positioning — keep predicted target,
            // only snap to server when no pending update remains.
            if (!pendingPaddleUpdateRef.current && !touchDraggingRef.current) {
              predictedPaddleRef.current = snap.self.paddleY;
            }
          } else {
            // Blend toward server position. With 20ms interpolation delay the
            // max drift is ~1.5 units, so the blend converges in a few frames.
            // Snap for large drift (connection hiccup or first frame).
            const delta = snap.self.paddleY - predictedPaddleRef.current;
            const absDelta = Math.abs(delta);
            if (absDelta > 10) {
              predictedPaddleRef.current = snap.self.paddleY;
            } else if (absDelta > 0.5) {
              predictedPaddleRef.current += delta * 0.35;
            }
          }
          setSelfPaddleLeftOverride(predictedPaddleRef.current);

          // --- Buffer snapshot for interpolation ---
          const buf = snapshotBufferRef.current;
          buf.push({ serverTimeMs: msg.state.serverTimeMs, snapshot: snap });
          if (buf.length > 20) buf.splice(0, buf.length - 20);

          // Show immediately when game is not active (countdown, result screen)
          if (!gameActiveRef.current) setSnapshot(snap);
          break;
        }

        case "rematch_status":
          setRematchPending(msg.selfRequested);
          setOpponentRematchRequested(msg.opponentRequested);
          break;

        case "game_result":
          resetTransientState();
          setEloDelta(null);
          setNewElo(null);
          setOpponentLeft(false);
          setResultReason(msg.reason);
          setWinner(msg.winnerSlot === joinedSlotRef.current ? "player" : "opponent");
          break;

        case "elo_update":
          setEloDelta(msg.delta);
          setNewElo(msg.newElo);
          break;

        case "opponent_left":
          resetTransientState();
          setOpponentLeft(true);
          setOpponentRematchRequested(false);
          setRematchPending(false);
          break;
      }
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      if (!winnerRef.current && joinedSlotRef.current) {
        resetTransientState();
        setWinner("opponent");
        setResultReason("disconnect");
      }
    };

    return () => {
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
      if (wsRef.current === ws) wsRef.current = null;
      clearQueuedPaddleFlush();
      ws.close();
    };
  }, [clearQueuedPaddleFlush, joinToken, resetTransientState, roomId, router]);

  // --- Render loop: interpolation + own paddle prediction ----------------------
  useEffect(() => {
    if (!gameActive) return;

    let animFrame = 0;
    let lastTime = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(50, now - lastTime);
      lastTime = now;

      // 1. Own paddle prediction — advance immediately based on the active control mode
      if (predictedTargetPaddleRef.current !== null) {
        const deltaToTarget = predictedTargetPaddleRef.current - predictedPaddleRef.current;
        const maxStep = PADDLE_SPEED * (dt / 1000);
        if (Math.abs(deltaToTarget) <= maxStep) {
          predictedPaddleRef.current = predictedTargetPaddleRef.current;
        } else {
          predictedPaddleRef.current += Math.sign(deltaToTarget) * maxStep;
        }
        predictedPaddleRef.current = clamp(predictedPaddleRef.current, 0, ARENA_HEIGHT - PADDLE_SIZE);
        setSelfPaddleLeftOverride(predictedPaddleRef.current);
      } else if (!touchDraggingRef.current && predictedDirRef.current !== 0) {
        predictedPaddleRef.current = clamp(
          predictedPaddleRef.current + predictedDirRef.current * PADDLE_SPEED * (dt / 1000),
          0,
          ARENA_HEIGHT - PADDLE_SIZE,
        );
        setSelfPaddleLeftOverride(predictedPaddleRef.current);
      }

      // 2. Snapshot interpolation — render everything "in the past"
      const buf = snapshotBufferRef.current;
      if (buf.length === 0) {
        animFrame = requestAnimationFrame(loop);
        return;
      }

      const latestServerTime = buf[buf.length - 1].serverTimeMs;
      const targetRenderTime = latestServerTime - INTERPOLATION_DELAY_MS;

      // Initialize or advance render clock
      if (renderTimeRef.current === null) {
        renderTimeRef.current = Math.max(buf[0].serverTimeMs, targetRenderTime);
      } else {
        renderTimeRef.current = Math.min(renderTimeRef.current + dt, targetRenderTime);
      }

      const renderAt = renderTimeRef.current;

      // Discard snapshots we've passed (keep at least 1 before renderAt)
      while (buf.length >= 3 && buf[1].serverTimeMs <= renderAt) {
        buf.shift();
      }

      const prev = buf[0];
      const next = buf[1];
      if (!prev) {
        animFrame = requestAnimationFrame(loop);
        return;
      }

      let rendered: ArenaSnapshot;
      if (!next || next.serverTimeMs <= prev.serverTimeMs) {
        // Only one snapshot — extrapolate ball positions using velocity.
        // Clamp to paddle lines so the ball never visually passes through a paddle.
        const elapsed = (renderAt - prev.serverTimeMs) / 1000;
        if (elapsed > 0 && elapsed < 0.1) {
          rendered = {
            ...prev.snapshot,
            balls: prev.snapshot.balls.map((ball) => {
              let x = ball.x + ball.vx * elapsed;
              let y = ball.y + ball.vy * elapsed;
              if (y - BALL_RADIUS < 0) y = BALL_RADIUS;
              else if (y + BALL_RADIUS > ARENA_HEIGHT) y = ARENA_HEIGHT - BALL_RADIUS;
              return { ...ball, x, y };
            }),
          };
        } else {
          rendered = prev.snapshot;
        }
      } else if (renderAt <= prev.serverTimeMs) {
        rendered = prev.snapshot;
      } else if (renderAt >= next.serverTimeMs) {
        rendered = next.snapshot;
      } else {
        const t = (renderAt - prev.serverTimeMs) / (next.serverTimeMs - prev.serverTimeMs);
        rendered = interpolateSnapshots(prev.snapshot, next.snapshot, clamp(t, 0, 1));
      }

      // Hide balls that are past a paddle and heading toward exit.
      // This prevents the "ball through paddle" visual without causing
      // the "ball slides along paddle" artifact that clamping created.
      const leftLimit = PADDLE_MARGIN + PADDLE_WIDTH + BALL_RADIUS;
      const rightLimit = ARENA_WIDTH - PADDLE_MARGIN - PADDLE_WIDTH - BALL_RADIUS;
      rendered = {
        ...rendered,
        balls: rendered.balls.filter((b) => {
          if (b.x < leftLimit && b.vx <= 0) return false;
          if (b.x > rightLimit && b.vx >= 0) return false;
          return true;
        }),
      };

      // --- Debug: detect issues in real-time ---
      if (typeof window !== "undefined" && (window as any).__PONG_DEBUG) {
        const prevSnap = (window as any).__prevRendered as ArenaSnapshot | undefined;
        if (prevSnap) {
          // Paddle jump
          const selfJump = Math.abs(rendered.self.paddleY - prevSnap.self.paddleY);
          const oppJump = Math.abs(rendered.opponent.paddleY - prevSnap.opponent.paddleY);
          if (selfJump > 5) console.warn(`[PONG] Self paddle jump: ${selfJump.toFixed(1)}`);
          if (oppJump > 5) console.warn(`[PONG] Opponent paddle jump: ${oppJump.toFixed(1)}`);

          // Ball through paddle
          for (const ball of rendered.balls) {
            const pb = prevSnap.balls.find((b) => b.id === ball.id);
            if (!pb) continue;
            if (pb.x > leftLimit + 1 && ball.x < leftLimit - 1 && ball.vx <= 0) {
              console.warn(`[PONG] Ball crossed LEFT paddle: x ${pb.x.toFixed(1)}->${ball.x.toFixed(1)}`);
            }
            if (pb.x < rightLimit - 1 && ball.x > rightLimit + 1 && ball.vx >= 0) {
              console.warn(`[PONG] Ball crossed RIGHT paddle: x ${pb.x.toFixed(1)}->${ball.x.toFixed(1)}`);
            }
          }

          // Ball bounce off nothing — use refs for current paddle position.
          // Server uses dynamic hit tolerance up to 4.5 units, so match that.
          const HIT_TOL = 4.5;
          for (const ball of rendered.balls) {
            const pb = prevSnap.balls.find((b) => b.id === ball.id);
            if (!pb) continue;
            if (pb.vx < 0 && ball.vx > 0) {
              const padY = predictedPaddleRef.current;
              const ballInPaddle = ball.y >= padY - HIT_TOL && ball.y <= padY + PADDLE_SIZE + HIT_TOL;
              if (!ballInPaddle) {
                console.warn(`[PONG] Ball bounced LEFT but paddle not covering! ball.y=${ball.y.toFixed(1)} pad=${padY.toFixed(1)}-${(padY + PADDLE_SIZE).toFixed(1)} serverPad=${serverPaddleRef.current.toFixed(1)}`);
              }
            }
          }

          // Score change
          const prevScore = prevSnap.self.score + prevSnap.opponent.score;
          const currScore = rendered.self.score + rendered.opponent.score;
          if (currScore > prevScore) {
            console.log(`[PONG] SCORE: ${rendered.self.score}-${rendered.opponent.score}`);
          }
        }
        // Paddle prediction vs server (use refs, not stale closure state)
        const drift = Math.abs(predictedPaddleRef.current - serverPaddleRef.current);
        if (drift > 8) {
          console.warn(`[PONG] Paddle drift: predicted=${predictedPaddleRef.current.toFixed(1)} server=${serverPaddleRef.current.toFixed(1)} drift=${drift.toFixed(1)}`);
        }

        (window as any).__prevRendered = rendered;
      }

      setSnapshot(rendered);
      animFrame = requestAnimationFrame(loop);
    };

    animFrame = requestAnimationFrame(loop);
    return () => {
      renderTimeRef.current = null;
      cancelAnimationFrame(animFrame);
    };
  }, [gameActive]);

  // --- Input handlers ----------------------------------------------------------
  const onAction = useCallback((action: InputAction) => {
    const ws = wsRef.current;
    if (countdown > 0 || waiting || winner || ws?.readyState !== WebSocket.OPEN) return;
    predictedTargetPaddleRef.current = null;
    predictedDirRef.current = applyPredictedInputDirection(predictedDirRef.current, action);
    const seq = seqRef.current++;
    unackedInputsRef.current.push({ seq, action });
    ws.send(JSON.stringify({
      type: "input",
      seq,
      action,
      clientTimeMs: estimateServerTimeMs(),
    } satisfies ClientMessage));
  }, [countdown, estimateServerTimeMs, waiting, winner]);

  const onPaddlePosition = useCallback((paddleLeft: number) => {
    const ws = wsRef.current;
    if (countdown > 0 || waiting || winner || ws?.readyState !== WebSocket.OPEN) return;
    predictedDirRef.current = 0;
    predictedTargetPaddleRef.current = paddleLeft;
    unackedInputsRef.current = [];
    queuedPaddleLeftRef.current = paddleLeft;
    schedulePaddlePositionFlush();
  }, [countdown, schedulePaddlePositionFlush, waiting, winner]);

  const onMobileDraggingChange = useCallback((dragging: boolean) => {
    touchDraggingRef.current = dragging;
  }, []);

  const onPlayAgain = useCallback(() => {
    const ws = wsRef.current;
    if (!winner || rematchPending || opponentLeft || ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "request_rematch" } satisfies ClientMessage));
    setRematchPending(true);
  }, [opponentLeft, rematchPending, winner]);

  const onFindNewOpponent = useCallback(() => {
    router.replace("/lobby?autosearch=1");
  }, [router]);

  return (
    <GameShell
      snapshot={snapshot}
      countdown={countdown}
      waiting={waiting}
      winner={winner}
      resultReason={resultReason}
      selfPaddleLeftOverride={selfPaddleLeftOverride}
      onAction={onAction}
      onPaddlePosition={onPaddlePosition}
      onMobileDraggingChange={onMobileDraggingChange}
      onPlayAgain={onPlayAgain}
      rematchPending={rematchPending}
      opponentRematchRequested={opponentRematchRequested}
      opponentLeft={opponentLeft}
      onFindNewOpponent={onFindNewOpponent}
      onLobby={() => router.replace("/lobby")}
      eloDelta={eloDelta}
      newElo={newElo}
    />
  );
}

export function GameView(props: GameViewProps) {
  if (props.mode === "pvp" && props.roomId && props.joinToken) {
    return (
      <NetworkedGameView
        roomId={props.roomId}
        joinToken={props.joinToken}
      />
    );
  }

  return (
    <LocalGameView
      seed={props.seed}
      opponentName={props.opponentName}
      playerName={props.playerName}
    />
  );
}
