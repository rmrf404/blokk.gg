"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

export default function Home() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [guestPending, setGuestPending] = useState(false);

  const playAsGuest = useCallback(() => {
    setGuestPending(true);
    void fetch("/api/guest", { method: "POST" })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to create guest session");
        }
        router.push("/lobby");
      })
      .catch(() => {
        setGuestPending(false);
      });
  }, [router]);

  const isAuthenticated = status === "authenticated" && !!session;

  return (
    <div className="relative flex h-dvh flex-1 flex-col items-center justify-center gap-12 overflow-hidden bg-[#0a0a0a] px-4 py-4 sm:gap-16">
      <div className="relative flex flex-col items-center gap-3">
        <h1 className="font-mono text-6xl font-black tracking-[-0.08em] sm:text-9xl">
          BLOKK
          <span className="text-neutral-500">.GG</span>
        </h1>
        <p className="font-mono text-xs tracking-[0.36em] text-neutral-500 uppercase sm:text-sm sm:tracking-[0.45em]">
          Competitive Pong
        </p>
      </div>

      <div className="relative flex flex-col items-center gap-5 sm:gap-8">
        <p className="max-w-lg text-center text-sm text-neutral-500">
          Fast-paced 1v1 Pong. First to 10 wins. Play ranked or jump in as a guest.
        </p>

        {status === "loading" ? (
          <div className="flex flex-col gap-3 w-72">
            <div className="h-16 flex items-center justify-center rounded-sm border border-white/30 bg-black">
              <p className="font-mono text-sm text-neutral-500 animate-pulse">LOADING...</p>
            </div>
          </div>
        ) : isAuthenticated ? (
          <div className="flex flex-col gap-3 w-72">
            <p className="text-center font-mono text-sm text-neutral-400">
              Welcome back, <span className="text-white">{session.user?.displayName ?? session.user?.xHandle ?? "Player"}</span>
            </p>
            <button
              onClick={() => router.push("/lobby")}
              className="h-16 rounded-sm border border-white bg-white font-mono text-sm font-bold tracking-[0.28em] text-black transition-colors hover:bg-neutral-100 active:bg-neutral-200"
            >
              GO TO LOBBY
            </button>
            <button
              onClick={() => signOut()}
              className="h-10 rounded-sm border border-neutral-700 bg-black font-mono text-xs font-bold tracking-[0.28em] text-neutral-500 transition-colors hover:border-white hover:text-white"
            >
              SIGN OUT
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 w-72">
            <button
              onClick={() => signIn("twitter", { callbackUrl: "/lobby" })}
              className="h-16 rounded-sm border border-white bg-white font-mono text-sm font-bold tracking-[0.28em] text-black transition-colors hover:bg-neutral-100 active:bg-neutral-200"
            >
              SIGN IN WITH X
            </button>
            <button
              onClick={playAsGuest}
              disabled={guestPending}
              className="h-16 rounded-sm border border-white bg-black font-mono text-sm font-bold tracking-[0.28em] text-white transition-colors hover:bg-white hover:text-black"
            >
              {guestPending ? "CREATING GUEST..." : "PLAY AS GUEST"}
            </button>
          </div>
        )}

        <a
          href="/leaderboard"
          className="px-4 py-2 text-center font-mono text-xs tracking-[0.2em] text-neutral-500 transition-colors hover:text-white"
        >
          LEADERBOARD
        </a>
      </div>
    </div>
  );
}
