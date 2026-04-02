import type { PlayerType } from "@/multiplayer/types";

export type VerifiedPlayerType = Exclude<PlayerType, "cpu">;

interface BaseClaims {
  iat: number;
  exp: number;
}

export interface IdentityClaims extends BaseClaims {
  kind: "identity";
  playerId: string;
  playerType: VerifiedPlayerType;
  displayName: string;
}

export interface RoomJoinClaims extends BaseClaims {
  kind: "room_join";
  roomId: string;
  playerId: string;
  playerType: VerifiedPlayerType;
  displayName: string;
}

type TokenClaims = IdentityClaims | RoomJoinClaims;

const FALLBACK_MATCH_TOKEN_SECRET = "local-match-token-secret-change-me";

function getProcessEnvSecret() {
  if (typeof process === "undefined") return undefined;
  return process.env.MATCH_TOKEN_SECRET
    ?? process.env.AUTH_SECRET
    ?? process.env.NEXTAUTH_SECRET
    ?? undefined;
}

export function getMatchTokenSecret(env?: { MATCH_TOKEN_SECRET?: string }) {
  return env?.MATCH_TOKEN_SECRET || getProcessEnvSecret() || FALLBACK_MATCH_TOKEN_SECRET;
}

function base64UrlEncode(input: string) {
  const base64 = typeof btoa === "function"
    ? btoa(input)
    : Buffer.from(input, "utf8").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return typeof atob === "function"
    ? atob(padded)
    : Buffer.from(padded, "base64").toString("utf8");
}

async function signPayload(payload: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const bytes = new Uint8Array(signature);
  let text = "";
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return base64UrlEncode(text);
}

async function verifyPayloadSignature(payload: string, signature: string, secret: string) {
  const expected = await signPayload(payload, secret);
  if (expected.length !== signature.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

async function signClaims<T extends TokenClaims>(claims: T, secret: string) {
  const payload = base64UrlEncode(JSON.stringify(claims));
  const signature = await signPayload(payload, secret);
  return `${payload}.${signature}`;
}

async function verifyClaims<T extends TokenClaims["kind"]>(
  token: string,
  kind: T,
  secret: string,
): Promise<Extract<TokenClaims, { kind: T }> | null> {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const validSignature = await verifyPayloadSignature(payload, signature, secret);
  if (!validSignature) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(base64UrlDecode(payload));
  } catch {
    return null;
  }

  if (!decoded || typeof decoded !== "object") return null;
  const claims = decoded as Partial<TokenClaims>;
  const now = Math.floor(Date.now() / 1000);

  if (claims.kind !== kind || typeof claims.iat !== "number" || typeof claims.exp !== "number") {
    return null;
  }
  if (claims.exp < now) return null;

  if (kind === "identity") {
    if (
      typeof claims.playerId !== "string"
      || typeof claims.displayName !== "string"
      || (claims.playerType !== "auth" && claims.playerType !== "guest")
    ) {
      return null;
    }
  }

  if (kind === "room_join") {
    const roomJoinClaims = claims as Partial<RoomJoinClaims>;
    if (
      typeof roomJoinClaims.roomId !== "string"
      || typeof roomJoinClaims.playerId !== "string"
      || typeof roomJoinClaims.displayName !== "string"
      || (roomJoinClaims.playerType !== "auth" && roomJoinClaims.playerType !== "guest")
    ) {
      return null;
    }
  }

  return claims as Extract<TokenClaims, { kind: T }>;
}

export async function createIdentityToken(
  player: { playerId: string; playerType: VerifiedPlayerType; displayName: string },
  secret: string,
  ttlSeconds: number,
) {
  const now = Math.floor(Date.now() / 1000);
  return signClaims(
    {
      kind: "identity",
      ...player,
      iat: now,
      exp: now + ttlSeconds,
    },
    secret,
  );
}

export async function verifyIdentityToken(token: string, secret: string) {
  return verifyClaims(token, "identity", secret);
}

export async function createRoomJoinToken(
  room: { roomId: string; playerId: string; playerType: VerifiedPlayerType; displayName: string },
  secret: string,
  ttlSeconds: number,
) {
  const now = Math.floor(Date.now() / 1000);
  return signClaims(
    {
      kind: "room_join",
      ...room,
      iat: now,
      exp: now + ttlSeconds,
    },
    secret,
  );
}

export async function verifyRoomJoinToken(token: string, secret: string) {
  return verifyClaims(token, "room_join", secret);
}
