import {
  applyInput,
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
const INPUT_LEAD_MS = TICK_MS * 3;

type ScheduledCommand =
  | { slot: PlayerSlot; frame: number; type: "input"; seq: number; action: InputAction }
  | { slot: PlayerSlot; frame: number; type: "paddle_target"; seq: number; paddleY: number };

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
      Math.max(0, requestedTimeMs),
    );
    return Math.max(this.serverFrame + 1, Math.floor(clampedTimeMs / TICK_MS) + 1);
  }

  private scheduleCommand(command: ScheduledCommand) {
    // Always redirect past inputs to the next tick instead of rolling back.
    // Pong paddle movement is continuous — applying a late input at the next
    // tick instead of its exact historical frame produces negligible gameplay
    // difference while completely eliminating rollback-induced paddle jumps
    // and ball-through-paddle artifacts.
    if (command.frame <= this.serverFrame) {
      command.frame = this.serverFrame + 1;
    }

    const existing = this.scheduledCommands.get(command.frame);
    if (existing) {
      existing.push(command);
    } else {
      this.scheduledCommands.set(command.frame, [command]);
    }
  }

  private processCommandsForFrame(frame: number) {
    const commands = this.scheduledCommands.get(frame);
    if (!commands || commands.length === 0) {
      return;
    }
    // Clean up — commands for this frame will not be needed again.
    this.scheduledCommands.delete(frame);

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

  private syncWinnerState() {
    if (this.state.winnerSlot) {
      this.winnerSlot = this.state.winnerSlot;
      this.winnerReason = "score";
    } else {
      this.winnerSlot = null;
      this.winnerReason = null;
    }
  }
}
