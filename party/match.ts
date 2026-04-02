import {
  applyInput,
  createMatch,
  serializeMatchState,
  setPlayerPaddlePosition,
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

type QueuedCommand =
  | { type: "input"; seq: number; action: InputAction }
  | { type: "paddle_position"; seq: number; paddleY: number };

interface PlayerRuntime {
  slot: PlayerSlot;
  playerId: string;
  playerType: PlayerType;
  displayName: string;
  commandQueue: QueuedCommand[];
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
  private readonly state: PongMatchState;
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

  enqueueInput(slot: PlayerSlot, seq: number, action: InputAction) {
    const player = this.players[slot];
    if (this.isOver() || !this.gameStarted) return;
    if (seq <= player.lastSeq) return;
    player.lastSeq = seq;
    player.commandQueue.push({ type: "input", seq, action });
  }

  enqueuePaddlePosition(slot: PlayerSlot, seq: number, paddleY: number) {
    const player = this.players[slot];
    if (this.isOver() || !this.gameStarted) return;
    if (seq <= player.lastSeq) return;
    player.lastSeq = seq;
    player.commandQueue.push({ type: "paddle_position", seq, paddleY });
  }

  tick(): void {
    if (!this.gameStarted || this.isOver()) return;

    this.serverFrame++;
    this.processInputs("top");
    this.processInputs("bottom");
    tickMatch(this.state, TICK_MS);

    if (this.state.winnerSlot) {
      this.winnerSlot = this.state.winnerSlot;
      this.winnerReason = "score";
    }
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
      commandQueue: [],
      lastSeq: -1,
      lastProcessedSeq: -1,
    };
  }

  private processInputs(slot: PlayerSlot) {
    const player = this.players[slot];
    while (player.commandQueue.length > 0 && !this.isOver()) {
      const cmd = player.commandQueue.shift()!;
      if (cmd.type === "input") {
        applyInput(this.state, slot, cmd.action);
      } else if (cmd.type === "paddle_position") {
        setPlayerPaddlePosition(this.state, slot, cmd.paddleY);
      }
      player.lastProcessedSeq = cmd.seq;
    }
  }
}
