"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "@/multiplayer/types";
import type { VerifiedPlayerType } from "@/lib/match-tokens";
import { getPartyServerUrl } from "@/lib/partyserver";

interface PlayerPayload {
  player: {
    playerId: string;
    playerType: VerifiedPlayerType;
    displayName: string;
  };
  identityToken: string;
  elo: number | null;
}

export default function LobbyPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-1 items-center justify-center">
        <p className="font-mono text-neutral-500 animate-pulse">Loading...</p>
      </div>
    }>
      <LobbyContent />
    </Suspense>
  );
}

function LobbyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const autoSearch = searchParams.get("autosearch") === "1";
  const [matchState, setMatchState] = useState<
    "idle" | "searching" | "matched" | "offer_cpu"
  >("idle");
  const [player, setPlayer] = useState<PlayerPayload["player"] | null>(null);
  const [identityToken, setIdentityToken] = useState<string | null>(null);
  const [elo, setElo] = useState<number | null>(null);
  const [loadingPlayer, setLoadingPlayer] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const autoSearchStartedRef = useRef(false);

  const playCpu = useCallback(() => {
    const seed = Math.floor(Math.random() * 2147483647);
    router.push(`/game?mode=cpu&seed=${seed}`);
  }, [router]);

  const findMatch = useCallback(() => {
    if (!identityToken || !player) return;
    setMatchState("searching");

    const ws = new WebSocket(getPartyServerUrl("/parties/matchmaker/main"));
    wsRef.current = ws;

    ws.onopen = () => {
      const msg: ClientMessage = {
        type: "join_queue",
        identityToken,
      };
      ws.send(JSON.stringify(msg));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as ServerMessage;

      switch (msg.type) {
        case "waiting":
          break;
        case "matched":
          setMatchState("matched");
          ws.close();
          router.push(
            `/game?mode=pvp&roomId=${msg.roomId}&joinToken=${encodeURIComponent(msg.joinToken)}&opponent=${encodeURIComponent(msg.opponent.displayName)}`,
          );
          break;
        case "offer_cpu":
          setMatchState("offer_cpu");
          break;
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
    };
  }, [identityToken, player, router]);

  const cancelSearch = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setMatchState("idle");
  }, []);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/player")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Unauthorized");
        }
        return response.json() as Promise<PlayerPayload>;
      })
      .then((payload) => {
        if (cancelled) return;
        setPlayer(payload.player);
        setIdentityToken(payload.identityToken);
        setElo(payload.elo);
        setLoadingPlayer(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadingPlayer(false);
        router.replace("/");
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!autoSearch || loadingPlayer || !player || !identityToken || matchState !== "idle") {
      return;
    }

    if (autoSearchStartedRef.current) {
      return;
    }

    autoSearchStartedRef.current = true;
    const timer = window.setTimeout(() => {
      findMatch();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [autoSearch, findMatch, identityToken, loadingPlayer, matchState, player]);

  if (loadingPlayer || !player) {
    return null;
  }

  return (
    <div className="relative flex h-dvh flex-1 flex-col items-center justify-center gap-6 overflow-hidden bg-[#0a0a0a] px-4 py-4 sm:gap-10">
      <div className="relative flex flex-col items-center gap-1.5 sm:gap-2">
        <h2 className="font-mono text-3xl font-black tracking-[0.12em]">LOBBY</h2>
        <p className="font-mono text-sm text-neutral-500">
          Playing as <span className="text-white">{player.displayName}</span>
          {elo !== null && <span className="ml-2 text-neutral-600">{elo} ELO</span>}
        </p>
        <p className="font-mono text-xs uppercase tracking-[0.28em] text-neutral-600">
          First to 10. At 9-9, sudden death.
        </p>
      </div>

      <div className="relative flex flex-col items-center gap-5 sm:gap-8">
        <div className="flex flex-col gap-3 w-72">
          {matchState === "idle" && (
            <>
              <button
                onClick={findMatch}
                className="h-16 rounded-sm border border-white bg-white font-mono text-sm font-bold tracking-[0.28em] text-black transition-colors hover:bg-neutral-100 active:bg-neutral-200"
              >
                FIND MATCH
              </button>
              <button
                onClick={playCpu}
                className="h-16 rounded-sm border border-white bg-black font-mono text-sm font-bold tracking-[0.28em] text-white transition-colors hover:bg-white hover:text-black"
              >
                PLAY VS CPU
              </button>
            </>
          )}

          {matchState === "searching" && (
            <>
              <div className="flex min-h-16 flex-col items-center justify-center rounded-sm border border-white/30 bg-black px-3">
                <p className="text-center font-mono text-sm font-bold text-white animate-pulse">
                  SEARCHING FOR A PONG RIVAL...
                </p>
              </div>
              <button
                onClick={cancelSearch}
                className="h-12 rounded-sm border border-white/40 bg-black font-mono text-sm font-bold tracking-[0.28em] text-white transition-colors hover:bg-white hover:text-black"
              >
                CANCEL
              </button>
            </>
          )}

          {matchState === "offer_cpu" && (
            <>
              <div className="flex min-h-16 flex-col items-center justify-center rounded-sm border border-white/30 bg-black px-3">
                <p className="text-center font-mono text-sm font-bold text-white animate-pulse">
                  SEARCHING FOR A PONG RIVAL...
                </p>
              </div>
              <p className="text-center font-mono text-xs text-neutral-500">
                Taking longer than expected
              </p>
              <button
                onClick={playCpu}
                className="h-16 rounded-sm border border-white bg-white font-mono text-sm font-bold tracking-[0.28em] text-black transition-colors hover:bg-neutral-100 active:bg-neutral-200"
              >
                PLAY VS CPU
              </button>
              <button
                onClick={cancelSearch}
                className="h-12 rounded-sm border border-white/40 bg-black font-mono text-sm font-bold tracking-[0.28em] text-white transition-colors hover:bg-white hover:text-black"
              >
                CANCEL
              </button>
            </>
          )}

          {matchState === "matched" && (
            <div className="h-16 flex items-center justify-center rounded-sm border border-white/30 bg-black">
              <p className="font-mono text-sm font-bold text-white animate-pulse">
                MATCH FOUND — LOADING...
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="relative flex flex-col items-center gap-3 px-4 py-2">
        {player.playerType === "auth" ? (
          <p className="text-center text-xs text-neutral-600">Ranked identity verified</p>
        ) : (
          <button
            onClick={() => signIn("twitter", { callbackUrl: "/lobby" })}
            className="rounded-sm border border-white/40 bg-black px-5 py-2.5 font-mono text-xs font-bold tracking-[0.28em] text-white transition-colors hover:bg-white hover:text-black"
          >
            SIGN IN WITH X
          </button>
        )}
        <div className="flex items-center gap-4">
          <a
            href="/leaderboard"
            className="font-mono text-xs tracking-[0.2em] text-neutral-500 transition-colors hover:text-white"
          >
            LEADERBOARD
          </a>
          <span className="text-neutral-700">·</span>
          <Link
            href="/"
            className="font-mono text-xs tracking-[0.2em] text-neutral-500 transition-colors hover:text-white"
          >
            HOME
          </Link>
        </div>
      </div>
    </div>
  );
}
