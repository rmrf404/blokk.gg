import {
  applyInput,
  cloneMatchState,
  createMatch,
  serializeMatchState,
  setPlayerPaddleTarget,
  tickMatch,
  type PongMatchState,
} from "../src/engine/pong";
import type {
  GameResultReason,
  InputAction,
  MatchStatePayload,
  PlayerSlot,
  PlayerType,
} from "../src/multiplayer/types";

const TICK_MS = 1000 / 60;
const MAX_ROLLBACK_MS = 100;
const MAX_ROLLBACK_FRAMES = Math.ceil(MAX_ROLLBACK_MS / TICK_MS);
const HISTORY_FRAMES = MAX_ROLLBACK_FRAMES + 8;
const INPUT_LEAD_MS = TICK_MS * 3;
/** Inputs targeting frames within this many frames of the current frame are
 *  redirected to the next tick instead of triggering a full rollback. */
const GRACE_FRAMES = 3;

type ScheduledCommand =
  | { slot: PlayerSlot; frame: number; type: "input"; seq: number; action: InputAction }
  | { slot: PlayerSlot; frame: number; type: "paddle_target"; seq: number; paddleY: number };

interface HistoryEntry {
  frame: number;
  state: PongMatchState;
  lastProcessedSeq: Record<PlayerSlot, number>;
}

interface PlayerRuntime {
  slot: PlayerSlot;
  playerId: string;
  playerType: PlayerType;
  displayName: string;
  lastSeq: number;
  lastProcessedSeq: number;
}

export interface RegisteredPlayer {
  slot: PlayerSlot;
  playerId: string;
  playerType: PlayerType;
  displayName: string;
}

export class AuthoritativeMatch {
  private readonly players: Record<PlayerSlot, PlayerRuntime>;
  private state: PongMatchState;
  private readonly scheduledCommands = new Map<number, ScheduledCommand[]>();
  private history: HistoryEntry[] = [];
  private winnerSlot: PlayerSlot | null = null;
  private winnerReason: GameResultReason | null = null;
  private gameStarted = false;
  private serverFrame = 0;

  constructor(top: RegisteredPlayer, bottom: RegisteredPlayer) {
    const baseSeed = (crypto.getRandomValues(new Uint32Array(1))[0] % 2147483646) + 1;
    this.players = {
      top: this.createRuntime(top),
      bottom: this.createRuntime(bottom),
    };
    this.state = createMatch(baseSeed, top.displayName, bottom.displayName);
    this.pushHistoryEntry(0);
  }

  start() {
    this.gameStarted = true;
  }

  isStarted() {
    return this.gameStarted;
  }

  isOver() {
    return this.winnerSlot !== null;
  }

  getWinnerPlayerId(): string | null {
    return this.winnerSlot ? this.players[this.winnerSlot].playerId : null;
  }

  getWinnerSlot(): PlayerSlot | null {
    return this.winnerSlot;
  }

  getWinnerReason(): GameResultReason | null {
    return this.winnerReason;
  }

  getPlayers(): { top: RegisteredPlayer; bottom: RegisteredPlayer } {
    const pick = (p: PlayerRuntime): RegisteredPlayer => ({
      slot: p.slot,
      playerId: p.playerId,
      playerType: p.playerType,
      displayName: p.displayName,
    });
    return { top: pick(this.players.top), bottom: pick(this.players.bottom) };
  }

  enqueueInput(slot: PlayerSlot, seq: number, action: InputAction, clientTimeMs?: number) {
    const player = this.players[slot];
    if (this.isOver() || !this.gameStarted) return;
    if (seq <= player.lastSeq) return;
    player.lastSeq = seq;
    const frame = this.resolveTargetFrame(clientTimeMs);
    this.scheduleCommand({ slot, frame, type: "input", seq, action });
  }

  enqueuePaddleTarget(slot: PlayerSlot, seq: number, paddleY: number, clientTimeMs?: number) {
    const player = this.players[slot];
    if (this.isOver() || !this.gameStarted) return;
    if (seq <= player.lastSeq) return;
    player.lastSeq = seq;
    const frame = this.resolveTargetFrame(clientTimeMs);
    this.scheduleCommand({ slot, frame, type: "paddle_target", seq, paddleY });
  }

  tick(): void {
    if (!this.gameStarted || this.isOver()) return;

    this.serverFrame++;
    this.processCommandsForFrame(this.serverFrame);
    tickMatch(this.state, TICK_MS);
    this.pushHistoryEntry(this.serverFrame);
    this.syncWinnerState();
  }

  getStateFor(slot: PlayerSlot): MatchStatePayload {
    const self = this.players[slot];
    return serializeMatchState(
      this.state,
      slot,
      this.serverFrame,
      self.lastProcessedSeq,
    );
  }

  private createRuntime(player: RegisteredPlayer): PlayerRuntime {
    return {
      ...player,
      lastSeq: -1,
      lastProcessedSeq: -1,
    };
  }

  private resolveTargetFrame(clientTimeMs?: number) {
    const fallbackTimeMs = this.state.elapsedMs;
    const requestedTimeMs = Number.isFinite(clientTimeMs) ? clientTimeMs! : fallbackTimeMs;
    const clampedTimeMs = Math.min(
      this.state.elapsedMs + INPUT_LEAD_MS,
      Math.max(this.state.elapsedMs - MAX_ROLLBACK_MS, requestedTimeMs),
    );
    const oldestHistoryFrame = this.history[0]?.frame ?? 0;
    return Math.max(oldestHistoryFrame + 1, Math.floor(clampedTimeMs / TICK_MS) + 1);
  }

  private scheduleCommand(command: ScheduledCommand) {
    // Redirect near-past inputs to the next tick instead of rolling back.
    // This eliminates most rollbacks caused by inputs arriving just barely late.
    if (command.frame <= this.serverFrame && this.serverFrame - command.frame <= GRACE_FRAMES) {
      command.frame = this.serverFrame + 1;
    }

    const existing = this.scheduledCommands.get(command.frame);
    if (existing) {
      existing.push(command);
    } else {
      this.scheduledCommands.set(command.frame, [command]);
    }

    if (command.frame <= this.serverFrame) {
      this.rewindAndReplay(command.frame);
    }
  }

  private rewindAndReplay(fromFrame: number) {
    const target = this.history.find((entry) => entry.frame === fromFrame - 1);
    if (!target) {
      return;
    }

    const originalFrame = this.serverFrame;
    this.restoreHistoryEntry(target);
    for (let frame = fromFrame; frame <= originalFrame; frame++) {
      this.serverFrame = frame;
      if (!this.isOver()) {
        this.processCommandsForFrame(frame);
      }
      if (!this.isOver()) {
        tickMatch(this.state, TICK_MS);
      }
      this.upsertHistoryEntry(frame);
    }
    this.serverFrame = originalFrame;
    this.syncWinnerState();
    this.pruneHistory();
  }

  private processCommandsForFrame(frame: number) {
    const commands = this.scheduledCommands.get(frame);
    if (!commands || commands.length === 0) {
      return;
    }

    commands
      .slice()
      .sort((a, b) => {
        if (a.slot !== b.slot) {
          return a.slot === "top" ? -1 : 1;
        }
        return a.seq - b.seq;
      })
      .forEach((command) => {
        const player = this.players[command.slot];
        if (command.type === "input") {
          applyInput(this.state, command.slot, command.action);
        } else {
          setPlayerPaddleTarget(this.state, command.slot, command.paddleY);
        }
        player.lastProcessedSeq = Math.max(player.lastProcessedSeq, command.seq);
      });
  }

  private pushHistoryEntry(frame: number) {
    this.history.push(this.createHistoryEntry(frame));
    this.pruneHistory();
  }

  private upsertHistoryEntry(frame: number) {
    const existingIndex = this.history.findIndex((entry) => entry.frame === frame);
    const nextEntry = this.createHistoryEntry(frame);
    if (existingIndex >= 0) {
      this.history[existingIndex] = nextEntry;
    } else {
      this.history.push(nextEntry);
    }
    this.history.sort((a, b) => a.frame - b.frame);
    this.pruneHistory();
  }

  private createHistoryEntry(frame: number): HistoryEntry {
    return {
      frame,
      state: cloneMatchState(this.state),
      lastProcessedSeq: {
        top: this.players.top.lastProcessedSeq,
        bottom: this.players.bottom.lastProcessedSeq,
      },
    };
  }

  private restoreHistoryEntry(entry: HistoryEntry) {
    this.serverFrame = entry.frame;
    this.state = cloneMatchState(entry.state);
    this.players.top.lastProcessedSeq = entry.lastProcessedSeq.top;
    this.players.bottom.lastProcessedSeq = entry.lastProcessedSeq.bottom;
    this.syncWinnerState();
  }

  private syncWinnerState() {
    if (this.state.winnerSlot) {
      this.winnerSlot = this.state.winnerSlot;
      this.winnerReason = "score";
    } else {
      this.winnerSlot = null;
      this.winnerReason = null;
    }
  }

  private pruneHistory() {
    if (this.history.length > HISTORY_FRAMES) {
      this.history = this.history.slice(this.history.length - HISTORY_FRAMES);
    }

    const oldestFrame = this.history[0]?.frame;
    if (oldestFrame === undefined) {
      return;
    }

    for (const frame of [...this.scheduledCommands.keys()]) {
      if (frame < oldestFrame) {
        this.scheduledCommands.delete(frame);
      }
    }
  }
}
