/** WebSocket message types shared between client and server. */

export type PlayerType = "auth" | "guest" | "cpu";
export type PlayerSlot = "top" | "bottom";
export type GameResultReason = "score" | "disconnect";
export type InputAction =
  | "move_up_start"
  | "move_up_stop"
  | "move_down_start"
  | "move_down_stop";

export interface SerializedPlayerState {
  paddleY: number;
  paddleSize: number;
  score: number;
  displayName: string;
}

export interface SerializedBallState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface MatchStatePayload {
  serverFrame: number;
  lastProcessedInputSeq: number;
  serverTimeMs: number;
  elapsedMs: number;
  self: SerializedPlayerState;
  opponent: SerializedPlayerState;
  balls: SerializedBallState[];
}

/** Client -> Server messages */
export type ClientMessage =
  | { type: "join_queue"; identityToken: string }
  | { type: "join_room"; joinToken: string }
  | { type: "request_rematch" }
  | { type: "input"; seq: number; action: InputAction; clientTimeMs?: number }
  | { type: "paddle_target"; seq: number; paddleY: number; clientTimeMs?: number }
  | { type: "paddle_position"; seq: number; paddleY: number; clientTimeMs?: number };

/** Server -> Client messages */
export type ServerMessage =
  | { type: "matched"; roomId: string; joinToken: string; opponent: { displayName: string; playerType: PlayerType } }
  | { type: "waiting" }
  | { type: "countdown"; value: number }
  | { type: "game_start" }
  | { type: "room_joined"; slot: PlayerSlot; isRanked: boolean }
  | { type: "match_state"; state: MatchStatePayload }
  | { type: "rematch_status"; selfRequested: boolean; opponentRequested: boolean }
  | { type: "game_result"; winnerSlot: PlayerSlot; isRanked: boolean; reason: GameResultReason }
  | { type: "elo_update"; oldElo: number | null; newElo: number | null; delta: number | null; isRanked: boolean }
  | { type: "opponent_left" }
  | { type: "offer_cpu"; message: string };
