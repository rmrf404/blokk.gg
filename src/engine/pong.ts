import type {
  InputAction,
  MatchStatePayload,
  PlayerSlot,
  SerializedBallState,
  SerializedPlayerState,
} from "@/multiplayer/types";

export const ARENA_WIDTH = 100;
export const ARENA_HEIGHT = 60;
export const PADDLE_MARGIN = 5;
export const PADDLE_WIDTH = 2;
export const BALL_RADIUS = 1.4;
/** Base Y-axis tolerance on paddle collision to compensate for network latency. */
const BASE_HIT_TOLERANCE = 2;
/** Maximum tolerance at MAX_BALL_SPEED — accounts for larger per-tick travel. */
const MAX_HIT_TOLERANCE = 4.5;
export const PADDLE_SIZE = 11;
export const PADDLE_SPEED = 78;
export const BASE_BALL_SPEED = 62;
export const MAX_BALL_SPEED = 138;
export const BALL_SPEED_GAIN = 8.5;
export const SCORE_TO_WIN = 10;

type InputDirection = -1 | 0 | 1;

export interface PongRngState {
  seed: number;
}

export interface BallState extends SerializedBallState {
  lastHitSlot: PlayerSlot | null;
}

export interface PongPlayerState {
  paddleY: number;
  inputDirection: InputDirection;
  movementDirection: InputDirection;
  targetPaddleY: number | null;
  score: number;
  displayName: string;
  isCpu?: boolean;
}

export interface PongMatchState {
  rng: PongRngState;
  elapsedMs: number;
  nextBallId: number;
  balls: BallState[];
  players: Record<PlayerSlot, PongPlayerState>;
  winnerSlot: PlayerSlot | null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function nextRandom(rng: PongRngState): number {
  rng.seed |= 0;
  rng.seed = (rng.seed + 0x6d2b79f5) | 0;
  let t = Math.imul(rng.seed ^ (rng.seed >>> 15), 1 | rng.seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function randomRange(rng: PongRngState, min: number, max: number) {
  return min + (max - min) * nextRandom(rng);
}

function spawnBall(state: PongMatchState, direction?: PlayerSlot): BallState {
  const angle = randomRange(state.rng, -0.42, 0.42);
  const towardRight = direction ? direction === "bottom" : nextRandom(state.rng) > 0.5;
  return {
    id: state.nextBallId++,
    x: ARENA_WIDTH / 2,
    y: randomRange(state.rng, 18, 42),
    vx: Math.cos(angle) * BASE_BALL_SPEED * (towardRight ? 1 : -1),
    vy: Math.sin(angle) * BASE_BALL_SPEED,
    lastHitSlot: null,
  };
}

export function createMatch(seed: number, topName: string, bottomName: string): PongMatchState {
  const state: PongMatchState = {
    rng: { seed: seed || 1 },
    elapsedMs: 0,
    nextBallId: 1,
    balls: [],
    players: {
      top: {
        paddleY: ARENA_HEIGHT / 2 - PADDLE_SIZE / 2,
        inputDirection: 0,
        movementDirection: 0,
        targetPaddleY: null,
        score: 0,
        displayName: topName,
      },
      bottom: {
        paddleY: ARENA_HEIGHT / 2 - PADDLE_SIZE / 2,
        inputDirection: 0,
        movementDirection: 0,
        targetPaddleY: null,
        score: 0,
        displayName: bottomName,
      },
    },
    winnerSlot: null,
  };

  state.balls.push(spawnBall(state));
  return state;
}

export function cloneMatchState(state: PongMatchState): PongMatchState {
  return {
    ...state,
    rng: { ...state.rng },
    balls: state.balls.map((ball) => ({ ...ball })),
    players: {
      top: { ...state.players.top },
      bottom: { ...state.players.bottom },
    },
  };
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

export function serializePlayerState(player: PongPlayerState): SerializedPlayerState {
  return {
    paddleY: round2(player.paddleY),
    paddleSize: PADDLE_SIZE,
    score: player.score,
    displayName: player.displayName,
  };
}

function mirrorBallState(ball: BallState): SerializedBallState {
  return {
    id: ball.id,
    x: round2(ARENA_WIDTH - ball.x),
    y: round2(ball.y),
    vx: round2(-ball.vx),
    vy: round2(ball.vy),
  };
}

export function serializeMatchState(
  state: PongMatchState,
  slot: PlayerSlot,
  serverFrame: number,
  lastProcessedInputSeq: number,
): MatchStatePayload {
  const opponentSlot = slot === "top" ? "bottom" : "top";
  const shouldMirrorArena = slot === "bottom";
  return {
    serverFrame,
    lastProcessedInputSeq,
    serverTimeMs: Math.floor(state.elapsedMs),
    elapsedMs: Math.floor(state.elapsedMs),
    self: serializePlayerState(state.players[slot]),
    opponent: serializePlayerState(state.players[opponentSlot]),
    balls: state.balls.map((ball) => shouldMirrorArena ? mirrorBallState(ball) : {
      id: ball.id, x: round2(ball.x), y: round2(ball.y), vx: round2(ball.vx), vy: round2(ball.vy),
    }),
  };
}

export function applyInput(state: PongMatchState, slot: PlayerSlot, action: InputAction) {
  const player = state.players[slot];
  switch (action) {
    case "move_up_start":
      player.targetPaddleY = null;
      player.inputDirection = -1;
      return;
    case "move_down_start":
      player.targetPaddleY = null;
      player.inputDirection = 1;
      return;
    case "move_up_stop":
      if (player.inputDirection === -1) {
        player.inputDirection = 0;
      }
      return;
    case "move_down_stop":
      if (player.inputDirection === 1) {
        player.inputDirection = 0;
      }
      return;
  }
}

export function setPlayerPaddleTarget(state: PongMatchState, slot: PlayerSlot, paddleY: number) {
  const player = state.players[slot];
  player.inputDirection = 0;
  player.targetPaddleY = clamp(paddleY, 0, ARENA_HEIGHT - PADDLE_SIZE);
}

export function setPlayerPaddlePosition(state: PongMatchState, slot: PlayerSlot, paddleY: number) {
  const player = state.players[slot];
  player.targetPaddleY = null;
  player.inputDirection = 0;
  player.movementDirection = 0;
  player.paddleY = clamp(paddleY, 0, ARENA_HEIGHT - PADDLE_SIZE);
}

/** CPU only reacts when the ball is within this fraction of the arena width. */
const CPU_REACT_DISTANCE = 0.55;
/** Dead-zone: CPU stops adjusting when within this distance of the target. */
const CPU_DEAD_ZONE = 4;

export function tickCpu(state: PongMatchState, slot: PlayerSlot) {
  const player = state.players[slot];

  // Only consider balls heading toward the CPU's side
  const incoming = state.balls.filter((ball) =>
    slot === "top" ? ball.vx < 0 : ball.vx > 0,
  );

  // If no ball is heading our way, drift toward center and wait
  if (incoming.length === 0) {
    const center = (ARENA_HEIGHT - PADDLE_SIZE) / 2;
    const delta = center - player.paddleY;
    if (Math.abs(delta) < CPU_DEAD_ZONE) {
      player.inputDirection = 0;
    } else {
      player.inputDirection = delta > 0 ? 1 : -1;
    }
    return;
  }

  // Focus on the closest incoming ball
  const paddleX = slot === "top" ? PADDLE_MARGIN : ARENA_WIDTH - PADDLE_MARGIN;
  incoming.sort(
    (a, b) => Math.abs(a.x - paddleX) - Math.abs(b.x - paddleX),
  );
  const focusBall = incoming[0];

  // Only react when ball is close enough
  const distanceFraction = Math.abs(focusBall.x - paddleX) / ARENA_WIDTH;
  if (distanceFraction > CPU_REACT_DISTANCE) {
    player.inputDirection = 0;
    return;
  }

  const targetY = clamp(
    focusBall.y - PADDLE_SIZE / 2,
    0,
    ARENA_HEIGHT - PADDLE_SIZE,
  );
  const delta = targetY - player.paddleY;

  if (Math.abs(delta) < CPU_DEAD_ZONE) {
    player.inputDirection = 0;
  } else {
    player.inputDirection = delta > 0 ? 1 : -1;
  }
}

/** CPU moves at this fraction of normal paddle speed. */
const CPU_SPEED_FACTOR = 0.55;

function updatePlayers(state: PongMatchState, deltaMs: number) {
  for (const slot of ["top", "bottom"] as PlayerSlot[]) {
    const player = state.players[slot];
    const speed = player.isCpu ? PADDLE_SPEED * CPU_SPEED_FACTOR : PADDLE_SPEED;
    const previousY = player.paddleY;

    if (player.targetPaddleY !== null) {
      const delta = player.targetPaddleY - player.paddleY;
      const maxStep = speed * (deltaMs / 1000);
      if (Math.abs(delta) <= maxStep) {
        player.paddleY = player.targetPaddleY;
      } else {
        player.paddleY += Math.sign(delta) * maxStep;
      }
      player.paddleY = clamp(player.paddleY, 0, ARENA_HEIGHT - PADDLE_SIZE);
    } else {
      player.paddleY = clamp(
        player.paddleY + player.inputDirection * speed * (deltaMs / 1000),
        0,
        ARENA_HEIGHT - PADDLE_SIZE,
      );
    }

    const movedBy = player.paddleY - previousY;
    player.movementDirection = movedBy > 0 ? 1 : movedBy < 0 ? -1 : 0;
  }
}

function reflectBallFromPaddle(
  state: PongMatchState,
  ball: BallState,
  slot: PlayerSlot,
) {
  const player = state.players[slot];
  const paddleCenter = player.paddleY + PADDLE_SIZE / 2;
  const impact = clamp((ball.y - paddleCenter) / (PADDLE_SIZE / 2), -1, 1);
  const speed = clamp(
    Math.hypot(ball.vx, ball.vy) + BALL_SPEED_GAIN,
    BASE_BALL_SPEED,
    MAX_BALL_SPEED,
  );
  const verticalInfluence = clamp(impact * 0.72 + player.movementDirection * 0.18, -0.82, 0.82);
  const vertical = speed * verticalInfluence;
  const minHorizontalSpeed = speed * 0.6;
  const horizontal = Math.sqrt(Math.max(speed * speed - vertical * vertical, minHorizontalSpeed * minHorizontalSpeed));

  ball.vx = slot === "top" ? horizontal : -horizontal;
  ball.vy = vertical;
  ball.lastHitSlot = slot;
  ball.x = slot === "top"
    ? PADDLE_MARGIN + PADDLE_WIDTH + BALL_RADIUS
    : ARENA_WIDTH - PADDLE_MARGIN - PADDLE_WIDTH - BALL_RADIUS;
}

function maybeBounceOnWalls(ball: BallState) {
  if (ball.y - BALL_RADIUS < 0) {
    ball.y = BALL_RADIUS;
    ball.vy = Math.abs(ball.vy);
  } else if (ball.y + BALL_RADIUS > ARENA_HEIGHT) {
    ball.y = ARENA_HEIGHT - BALL_RADIUS;
    ball.vy = -Math.abs(ball.vy);
  }
}

function maybeBounceOnPaddles(
  state: PongMatchState,
  ball: BallState,
  previousX: number,
  previousY: number,
  movedX: number,
  movedY: number,
  previousTopPaddleY: number,
  previousBottomPaddleY: number,
) {
  const leftPlayer = state.players.top;
  const rightPlayer = state.players.bottom;
  const leftFrontX = PADDLE_MARGIN + PADDLE_WIDTH;
  const rightFrontX = ARENA_WIDTH - PADDLE_MARGIN - PADDLE_WIDTH;

  // Dynamic tolerance: scales with ball speed to prevent tunneling at high velocity
  const ballSpeed = Math.hypot(ball.vx, ball.vy);
  const speedRatio = Math.min(ballSpeed / MAX_BALL_SPEED, 1);
  const hitTolerance = BASE_HIT_TOLERANCE + speedRatio * (MAX_HIT_TOLERANCE - BASE_HIT_TOLERANCE);

  if (
    ball.vx < 0
    && previousX - BALL_RADIUS >= leftFrontX
    && movedX - BALL_RADIUS <= leftFrontX
  ) {
    const t = (previousX - BALL_RADIUS - leftFrontX) / (previousX - movedX);
    const yAtCross = previousY + (movedY - previousY) * t;
    const paddleYAtCross = previousTopPaddleY + (leftPlayer.paddleY - previousTopPaddleY) * clamp(t, 0, 1);
    if (
      yAtCross + BALL_RADIUS + hitTolerance >= paddleYAtCross
      && yAtCross - BALL_RADIUS - hitTolerance <= paddleYAtCross + PADDLE_SIZE
    ) {
      ball.y = yAtCross;
      reflectBallFromPaddle(state, ball, "top");
      return;
    }
  }

  if (
    ball.vx > 0
    && previousX + BALL_RADIUS <= rightFrontX
    && movedX + BALL_RADIUS >= rightFrontX
  ) {
    const t = (rightFrontX - previousX - BALL_RADIUS) / (movedX - previousX);
    const yAtCross = previousY + (movedY - previousY) * t;
    const paddleYAtCross = previousBottomPaddleY + (rightPlayer.paddleY - previousBottomPaddleY) * clamp(t, 0, 1);
    if (
      yAtCross + BALL_RADIUS + hitTolerance >= paddleYAtCross
      && yAtCross - BALL_RADIUS - hitTolerance <= paddleYAtCross + PADDLE_SIZE
    ) {
      ball.y = yAtCross;
      reflectBallFromPaddle(state, ball, "bottom");
    }
  }
}

function awardPoint(state: PongMatchState, slot: PlayerSlot) {
  state.players[slot].score += 1;

  if (state.players[slot].score >= SCORE_TO_WIN) {
    state.winnerSlot = slot;
    return;
  }

  state.balls = [spawnBall(state, slot === "top" ? "bottom" : "top")];
  state.players.top.inputDirection = 0;
  state.players.top.movementDirection = 0;
  state.players.top.targetPaddleY = null;
  state.players.bottom.inputDirection = 0;
  state.players.bottom.movementDirection = 0;
  state.players.bottom.targetPaddleY = null;
}

function updateBalls(
  state: PongMatchState,
  deltaMs: number,
  previousTopPaddleY: number,
  previousBottomPaddleY: number,
) {
  const nextBalls: BallState[] = [];
  let scored = false;

  for (const ball of state.balls) {
    const previousX = ball.x;
    const previousY = ball.y;
    ball.x += ball.vx * (deltaMs / 1000);
    ball.y += ball.vy * (deltaMs / 1000);

    const movedX = ball.x;
    const movedY = ball.y;
    maybeBounceOnWalls(ball);
    maybeBounceOnPaddles(
      state,
      ball,
      previousX,
      previousY,
      movedX,
      movedY,
      previousTopPaddleY,
      previousBottomPaddleY,
    );

    if (ball.x + BALL_RADIUS < 0) {
      awardPoint(state, "bottom");
      scored = true;
      if (state.winnerSlot) {
        return;
      }
      break;
    }
    if (ball.x - BALL_RADIUS > ARENA_WIDTH) {
      awardPoint(state, "top");
      scored = true;
      if (state.winnerSlot) {
        return;
      }
      break;
    }

    nextBalls.push(ball);
  }

  // When a point is scored, awardPoint already set state.balls to the
  // correctly directed respawn. Don't overwrite it with nextBalls.
  if (!state.winnerSlot && !scored) {
    state.balls = nextBalls;
  }
}

/** Maximum physics sub-step in ms. Keeps swept-collision reliable at high ball speeds. */
const MAX_SUBSTEP_MS = 1000 / 60;

export function tickMatch(state: PongMatchState, deltaMs: number) {
  if (state.winnerSlot) {
    return;
  }

  state.elapsedMs += deltaMs;

  // Sub-step the physics so that fast balls cannot tunnel through paddles
  // when deltaMs exceeds a single 60 Hz frame (e.g. during catch-up ticks).
  let remaining = deltaMs;
  while (remaining > 0 && !state.winnerSlot) {
    const step = Math.min(remaining, MAX_SUBSTEP_MS);
    remaining -= step;

    const previousTopPaddleY = state.players.top.paddleY;
    const previousBottomPaddleY = state.players.bottom.paddleY;
    updatePlayers(state, step);
    updateBalls(state, step, previousTopPaddleY, previousBottomPaddleY);
  }
}
