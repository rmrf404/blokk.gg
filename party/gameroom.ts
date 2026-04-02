/**
 * Game Room Durable Object.
 * Runs an authoritative match simulation and broadcasts snapshots to clients.
 *
 * Server ticks at 60 Hz for physics accuracy.
 * State is broadcast at 20 Hz (every 3rd tick) to save bandwidth.
 */

import { Server, type Connection } from "partyserver";
import { AuthoritativeMatch, type RegisteredPlayer } from "./match";
import type {
  ClientMessage,
  GameResultReason,
  InputAction,
  PlayerSlot,
  PlayerType,
  ServerMessage,
} from "../src/multiplayer/types";
import { ARENA_HEIGHT } from "../src/engine/pong";
import { getMatchTokenSecret, verifyRoomJoinToken } from "../src/lib/match-tokens";
import { calculateElo } from "../src/lib/elo";
import { createPartySupabase } from "./supabase";

interface Player {
  conn: Connection;
  playerId: string | null;
  playerType: PlayerType | null;
  displayName: string | null;
  slot: PlayerSlot;
  joined: boolean;
  rematchRequested: boolean;
}

export class Gameroom extends Server {
  private players: Player[] = [];
  private gameOver = false;
  private gameStarted = false;
  private countdownInProgress = false;
  private match: AuthoritativeMatch | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;

  onConnect(conn: Connection) {
    if (this.gameOver && this.players.length === 0) {
      conn.close(4001, "Room is closed");
      return;
    }
    if (this.players.length >= 2) {
      conn.close(4000, "Room is full");
      return;
    }

    this.players.push({
      conn,
      playerId: null,
      playerType: null,
      displayName: null,
      slot: this.players.length === 0 ? "top" : "bottom",
      joined: false,
      rematchRequested: false,
    });
  }

  onMessage(conn: Connection, message: string) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(message) as ClientMessage;
    } catch {
      conn.close(4000, "Invalid message");
      return;
    }

    switch (msg.type) {
      case "join_room": {
        void this.handleJoinRoom(conn, msg.joinToken);
        return;
      }
      case "request_rematch": {
        this.handleRequestRematch(conn);
        return;
      }
      case "input": {
        if (this.gameOver) return;
        const player = this.players.find((p) => p.conn.id === conn.id);
        if (!player?.joined || !this.match || !this.isValidInputMessage(msg.seq, msg.action)) return;
        this.match.enqueueInput(player.slot, msg.seq, msg.action);
        break;
      }
      case "paddle_position": {
        if (this.gameOver) return;
        const player = this.players.find((p) => p.conn.id === conn.id);
        if (!player?.joined || !this.match || !this.isValidPaddlePositionMessage(msg.seq, msg.paddleY)) return;
        this.match.enqueuePaddlePosition(player.slot, msg.seq, msg.paddleY);
        break;
      }
    }
  }

  private async handleJoinRoom(conn: Connection, joinToken: string) {
    const claims = await verifyRoomJoinToken(joinToken, getMatchTokenSecret(this.env));
    const player = this.players.find((p) => p.conn.id === conn.id);

    if (!player || !claims || claims.roomId !== this.name) {
      this.players = this.players.filter((candidate) => candidate.conn.id !== conn.id);
      conn.close(4001, "Invalid join token");
      return;
    }

    const duplicate = this.players.find((candidate) =>
      candidate.conn.id !== conn.id && candidate.playerId === claims.playerId);
    if (duplicate) {
      this.players = this.players.filter((candidate) => candidate.conn.id !== conn.id);
      conn.close(4002, "Duplicate player");
      return;
    }

    player.playerId = claims.playerId;
    player.playerType = claims.playerType;
    player.displayName = claims.displayName;
    player.joined = true;
    player.rematchRequested = false;
    this.send(player.conn, {
      type: "room_joined",
      slot: player.slot,
      isRanked: this.determineIsRanked(),
    });

    if (this.canStartCountdown()) {
      await this.startCountdown();
    }
  }

  onClose(conn: Connection) {
    const opponent = this.getOpponent(conn);
    this.players = this.players.filter((p) => p.conn.id !== conn.id);

    if (!this.gameStarted) {
      if (this.players.length < 2) {
        this.countdownInProgress = false;
      }
      if (this.gameOver && opponent) {
        opponent.rematchRequested = false;
        this.send(opponent.conn, { type: "opponent_left" });
      }
      return;
    }

    if (!this.gameOver && opponent && opponent.playerId) {
      this.finishMatch(opponent.slot, "disconnect");
    }
  }

  private async startCountdown() {
    if (this.countdownInProgress || this.gameStarted) return;
    this.countdownInProgress = true;
    for (const player of this.players) {
      player.rematchRequested = false;
    }
    try {
      for (let i = 3; i >= 1; i--) {
        if (this.players.length < 2) {
          return;
        }
        const recipients = [...this.players];
        for (const player of recipients) {
          this.send(player.conn, { type: "countdown", value: i });
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (this.players.length === 2) {
        this.gameStarted = true;
        this.gameOver = false;
        this.createMatch();
        const recipients = [...this.players];
        for (const player of recipients) {
          this.send(player.conn, { type: "game_start" });
        }
        this.match?.start();
        this.broadcastMatchState();
        this.startTickLoop();
      }
    } finally {
      this.countdownInProgress = false;
    }
  }

  private determineIsRanked(): boolean {
    const types = this.players.map((p) => p.playerType);
    if (types.includes("cpu")) return false;
    if (types.every((t) => t === "guest" || t === null)) return false;
    return types.some((t) => t === "auth");
  }

  private getOpponent(conn: Connection): Player | undefined {
    return this.players.find((p) => p.conn.id !== conn.id);
  }

  private canStartCountdown(): boolean {
    return this.players.length === 2
      && this.players.every((p) => p.joined && p.playerId && p.displayName && p.playerType)
      && !this.countdownInProgress
      && !this.gameStarted;
  }

  private createMatch() {
    const top = this.players.find((p) => p.slot === "top");
    const bottom = this.players.find((p) => p.slot === "bottom");
    if (!top?.playerId || !top.playerType || !top.displayName || !bottom?.playerId || !bottom.playerType || !bottom.displayName) {
      return;
    }

    const topPlayer: RegisteredPlayer = {
      slot: "top",
      playerId: top.playerId,
      playerType: top.playerType,
      displayName: top.displayName,
    };
    const bottomPlayer: RegisteredPlayer = {
      slot: "bottom",
      playerId: bottom.playerId,
      playerType: bottom.playerType,
      displayName: bottom.displayName,
    };
    this.match = new AuthoritativeMatch(topPlayer, bottomPlayer);
  }

  private startTickLoop() {
    if (this.tickInterval || !this.match) return;
    this.tickCount = 0;
    this.tickInterval = setInterval(() => {
      this.match?.tick();
      this.tickCount++;

      const winnerSlot = this.match?.getWinnerSlot();
      if (winnerSlot) {
        this.broadcastMatchState();
        this.finishMatch(winnerSlot, this.match?.getWinnerReason() ?? "score");
        return;
      }

      // Broadcast at 20 Hz (every 3rd tick) to save bandwidth
      if (this.tickCount % 3 === 0) {
        this.broadcastMatchState();
      }
    }, 1000 / 60);
  }

  private stopTickLoop() {
    if (!this.tickInterval) return;
    clearInterval(this.tickInterval);
    this.tickInterval = null;
  }

  private broadcastMatchState() {
    if (!this.match) return;
    for (const player of this.players) {
      this.send(player.conn, {
        type: "match_state",
        state: this.match.getStateFor(player.slot),
      });
    }
  }

  private finishMatch(winnerSlot: PlayerSlot, reason: GameResultReason) {
    if (this.gameOver) return;
    this.gameOver = true;
    this.gameStarted = false;
    for (const player of this.players) {
      player.rematchRequested = false;
    }
    this.stopTickLoop();

    // Snapshot player data before any async work — needed because onClose
    // removes the disconnected player from this.players before finishMatch runs.
    const matchPlayers = this.match?.getPlayers();
    const topData = matchPlayers?.top ?? null;
    const bottomData = matchPlayers?.bottom ?? null;
    const isRanked = topData && bottomData
      ? topData.playerType !== "cpu" && bottomData.playerType !== "cpu"
        && (topData.playerType === "auth" || bottomData.playerType === "auth")
      : this.determineIsRanked();

    for (const player of this.players) {
      this.send(player.conn, {
        type: "game_result",
        winnerSlot,
        isRanked,
        reason,
      });
    }
    const durationSeconds = Math.round(this.tickCount / 60);
    void this.recordMatchResult(winnerSlot, isRanked, durationSeconds, topData, bottomData);
  }

  private async recordMatchResult(
    winnerSlot: PlayerSlot,
    isRanked: boolean,
    durationSeconds: number,
    topData: RegisteredPlayer | null,
    bottomData: RegisteredPlayer | null,
  ) {
    try {
      if (!topData || !bottomData) return;

      const topType = topData.playerType;
      const bottomType = bottomData.playerType;

      // Skip DB write if both guests or CPU involved
      if (topType === "cpu" || bottomType === "cpu") return;
      if (topType === "guest" && bottomType === "guest") return;

      const supabase = createPartySupabase(this.env);
      if (!supabase) return;

      // Extract x_id from playerId (format: "auth:xId" or "guest:uuid")
      const topXId = topType === "auth" ? topData.playerId.replace("auth:", "") : null;
      const bottomXId = bottomType === "auth" ? bottomData.playerId.replace("auth:", "") : null;

      // Fetch player records for auth players
      const authXIds = [topXId, bottomXId].filter((id): id is string => id !== null);
      const { data: playerRows } = await supabase
        .from("players")
        .select("id, x_id, elo, wins, losses, games_vs_guests")
        .in("x_id", authXIds);

      if (!playerRows) return;

      const topRow = topXId ? playerRows.find((r) => r.x_id === topXId) ?? null : null;
      const bottomRow = bottomXId ? playerRows.find((r) => r.x_id === bottomXId) ?? null : null;

      // Calculate ELO
      const topWon = winnerSlot === "top";
      const eloResult = calculateElo(
        topRow?.elo ?? null,
        bottomRow?.elo ?? null,
        topWon,
      );

      // Insert match record
      const winnerRow = winnerSlot === "top" ? topRow : bottomRow;
      await supabase.from("matches").insert({
        player1_id: topRow?.id ?? null,
        player2_id: bottomRow?.id ?? null,
        winner_id: winnerRow?.id ?? null,
        player1_type: topType,
        player2_type: bottomType,
        is_ranked: isRanked,
        duration_seconds: durationSeconds,
      });

      // Update each auth player's stats
      const updates: Array<{
        row: { id: string; wins: number; losses: number; games_vs_guests: number };
        newElo: number;
        won: boolean;
        opponentIsGuest: boolean;
      }> = [];

      if (topRow) {
        updates.push({
          row: topRow,
          newElo: eloResult.newRatingA,
          won: topWon,
          opponentIsGuest: bottomType === "guest",
        });
      }
      if (bottomRow) {
        updates.push({
          row: bottomRow,
          newElo: eloResult.newRatingB,
          won: !topWon,
          opponentIsGuest: topType === "guest",
        });
      }

      for (const { row, newElo, won, opponentIsGuest } of updates) {
        await supabase
          .from("players")
          .update({
            elo: newElo,
            wins: won ? row.wins + 1 : row.wins,
            losses: won ? row.losses : row.losses + 1,
            games_vs_guests: opponentIsGuest ? row.games_vs_guests + 1 : row.games_vs_guests,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
      }

      // Send ELO updates to connected players
      for (const player of this.players) {
        const isTop = player.slot === "top";
        const row = isTop ? topRow : bottomRow;
        const oldElo = row?.elo ?? null;
        const newElo = isTop ? eloResult.newRatingA : eloResult.newRatingB;
        const delta = isTop ? eloResult.deltaA : eloResult.deltaB;
        const playerType = isTop ? topType : bottomType;

        this.send(player.conn, {
          type: "elo_update",
          oldElo: playerType === "auth" ? oldElo : null,
          newElo: playerType === "auth" ? newElo : null,
          delta: playerType === "auth" ? delta : null,
          isRanked,
        });
      }
    } catch (error) {
      console.error("[Gameroom] Failed to record match result:", error);
    }
  }

  private isValidInputMessage(seq: number, action: InputAction) {
    return Number.isInteger(seq)
      && seq >= 0
      && seq <= 10_000_000
      && (
        action === "move_up_start"
        || action === "move_up_stop"
        || action === "move_down_start"
        || action === "move_down_stop"
      );
  }

  private isValidPaddlePositionMessage(seq: number, paddleY: number) {
    return Number.isInteger(seq)
      && seq >= 0
      && seq <= 10_000_000
      && Number.isFinite(paddleY)
      && paddleY >= 0
      && paddleY <= ARENA_HEIGHT;
  }

  private handleRequestRematch(conn: Connection) {
    const player = this.players.find((candidate) => candidate.conn.id === conn.id);
    if (!player?.joined || !this.gameOver || this.countdownInProgress || this.players.length !== 2) {
      return;
    }

    player.rematchRequested = true;
    this.broadcastRematchStatus();

    if (this.players.every((candidate) => candidate.joined && candidate.rematchRequested)) {
      void this.startCountdown();
    }
  }

  private broadcastRematchStatus() {
    if (this.players.length !== 2) return;

    for (const player of this.players) {
      const opponent = this.players.find((candidate) => candidate.conn.id !== player.conn.id);
      this.send(player.conn, {
        type: "rematch_status",
        selfRequested: player.rematchRequested,
        opponentRequested: opponent?.rematchRequested ?? false,
      });
    }
  }

  private send(conn: Connection, msg: ServerMessage) {
    try {
      conn.send(JSON.stringify(msg));
    } catch (error) {
      console.error("Failed to send message", { id: conn.id, error });
    }
  }
}
