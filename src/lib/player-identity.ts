import { cookies } from "next/headers";
import { auth } from "@/auth/auth";
import {
  createIdentityToken,
  getMatchTokenSecret,
  verifyIdentityToken,
  type VerifiedPlayerType,
} from "@/lib/match-tokens";
import { createSupabaseServer } from "@/lib/supabase-server";

const GUEST_COOKIE_NAME = "guest_player";
const GUEST_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const IDENTITY_TOKEN_TTL_SECONDS = 60 * 15;

export interface VerifiedPlayerIdentity {
  playerId: string;
  playerType: VerifiedPlayerType;
  displayName: string;
}

function sanitizeDisplayName(input: string) {
  const trimmed = input.trim().replace(/\s+/g, " ");
  return trimmed.slice(0, 32);
}

export async function issueGuestIdentity() {
  const playerId = crypto.randomUUID();
  const displayName = `Guest_${playerId.slice(0, 4).toUpperCase()}`;
  const identity: VerifiedPlayerIdentity = {
    playerId: `guest:${playerId}`,
    playerType: "guest",
    displayName,
  };
  const secret = getMatchTokenSecret();
  const token = await createIdentityToken(identity, secret, GUEST_TOKEN_TTL_SECONDS);
  const cookieStore = await cookies();
  cookieStore.set(GUEST_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_TOKEN_TTL_SECONDS,
  });
  return identity;
}

export async function getVerifiedPlayerIdentity(): Promise<VerifiedPlayerIdentity | null> {
  const session = await auth();
  if (session?.user?.xId) {
    return {
      playerId: `auth:${session.user.xId}`,
      playerType: "auth",
      displayName: sanitizeDisplayName(
        session.user.displayName
          || session.user.name
          || session.user.xHandle
          || "Authenticated Player",
      ) || "Authenticated Player",
    };
  }

  const cookieStore = await cookies();
  const guestToken = cookieStore.get(GUEST_COOKIE_NAME)?.value;
  if (!guestToken) return null;

  const claims = await verifyIdentityToken(guestToken, getMatchTokenSecret());
  if (!claims) {
    cookieStore.delete(GUEST_COOKIE_NAME);
    return null;
  }

  return {
    playerId: claims.playerId,
    playerType: claims.playerType,
    displayName: claims.displayName,
  };
}

export async function createIdentityResponsePayload() {
  const identity = await getVerifiedPlayerIdentity();
  if (!identity) return null;

  const identityToken = await createIdentityToken(
    identity,
    getMatchTokenSecret(),
    IDENTITY_TOKEN_TTL_SECONDS,
  );

  let elo: number | null = null;
  if (identity.playerType === "auth") {
    const xId = identity.playerId.replace("auth:", "");
    try {
      const supabase = await createSupabaseServer();
      const { data } = await supabase
        .from("players")
        .select("elo")
        .eq("x_id", xId)
        .single();
      if (data) elo = data.elo;
    } catch {
      // Supabase not configured or player not found — skip
    }
  }

  return {
    player: identity,
    identityToken,
    elo,
  };
}
