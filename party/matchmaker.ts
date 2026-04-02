/**
 * Matchmaker Durable Object.
 * Manages the player queue and pairs players into game rooms.
 */

import { Server, type Connection } from "partyserver";
import type { ClientMessage, PlayerType, ServerMessage } from "../src/multiplayer/types";
import {
  createRoomJoinToken,
  getMatchTokenSecret,
  verifyIdentityToken,
} from "../src/lib/match-tokens";

interface QueuedPlayer {
  conn: Connection;
  playerId: string;
  playerType: PlayerType;
  displayName: string;
  joinedAt: number;
  cpuOffered: boolean;
}

export class Matchmaker extends Server {
  private queue: QueuedPlayer[] = [];
  private matchCheckInterval: ReturnType<typeof setInterval> | null = null;

  private ensureMatchLoop() {
    if (this.matchCheckInterval) return;
    this.matchCheckInterval = setInterval(() => {
      this.tryMatch();
      this.checkForCpuOffer();
    }, 1000);
  }

  private stopMatchLoopIfIdle() {
    if (this.queue.length === 0 && this.matchCheckInterval) {
      clearInterval(this.matchCheckInterval);
      this.matchCheckInterval = null;
    }
  }

  onClose(conn: Connection) {
    this.queue = this.queue.filter((p) => p.conn.id !== conn.id);
    this.stopMatchLoopIfIdle();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onConnect(_conn: Connection) {
    // Player sends join_queue message after connecting
  }

  onMessage(conn: Connection, message: string) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(message) as ClientMessage;
    } catch {
      conn.close(4000, "Invalid message");
      return;
    }

    if (msg.type === "join_queue") {
      void this.handleJoinQueue(conn, msg.identityToken);
    }
  }

  private async handleJoinQueue(conn: Connection, identityToken: string) {
    const identity = await verifyIdentityToken(identityToken, getMatchTokenSecret(this.env));
    if (!identity) {
      conn.close(4001, "Invalid identity");
      return;
    }

      // Remove any existing entry for this connection
    this.queue = this.queue.filter((p) => p.conn.id !== conn.id && p.playerId !== identity.playerId);

    this.queue.push({
      conn,
      playerId: identity.playerId,
      playerType: identity.playerType,
      displayName: identity.displayName,
      joinedAt: Date.now(),
      cpuOffered: false,
    });

    this.send(conn, { type: "waiting" });
    this.ensureMatchLoop();

    await this.tryMatch();
  }

  private async tryMatch() {
    while (this.queue.length >= 2) {
      const player1 = this.queue.shift()!;
      const player2 = this.queue.shift()!;

      const roomId = crypto.randomUUID();
      const secret = getMatchTokenSecret(this.env);
      const [player1JoinToken, player2JoinToken] = await Promise.all([
        createRoomJoinToken(
          {
            roomId,
            playerId: player1.playerId,
            playerType: player1.playerType,
            displayName: player1.displayName,
          },
          secret,
          60 * 5,
        ),
        createRoomJoinToken(
          {
            roomId,
            playerId: player2.playerId,
            playerType: player2.playerType,
            displayName: player2.displayName,
          },
          secret,
          60 * 5,
        ),
      ]);

      this.send(player1.conn, {
        type: "matched",
        roomId,
        joinToken: player1JoinToken,
        opponent: {
          displayName: player2.displayName,
          playerType: player2.playerType,
        },
      });

      this.send(player2.conn, {
        type: "matched",
        roomId,
        joinToken: player2JoinToken,
        opponent: {
          displayName: player1.displayName,
          playerType: player1.playerType,
        },
      });
    }

    this.stopMatchLoopIfIdle();
  }

  private checkForCpuOffer() {
    const now = Date.now();
    for (const player of this.queue) {
      if (!player.cpuOffered && now - player.joinedAt > 30000) {
        player.cpuOffered = true;
        this.send(player.conn, {
          type: "offer_cpu",
          message: "No opponent found. Play vs CPU?",
        });
      }
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
