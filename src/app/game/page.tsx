"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { GameView } from "@/components/GameView";

function generateSeed(): number {
  return Math.floor(Math.random() * 2147483647);
}

function GameContent() {
  const router = useRouter();
  const params = useSearchParams();

  const [init] = useState(() => {
    const mode = (params.get("mode") ?? "cpu") as "cpu" | "pvp";
    const roomId = params.get("roomId");
    const joinToken = params.get("joinToken");
    const seedParam = params.get("seed");

    if (mode === "pvp" && (!roomId || !joinToken)) {
      return null;
    }

    return {
      mode,
      seed: seedParam ? Number(seedParam) : generateSeed(),
      roomId: roomId ?? undefined,
      joinToken: joinToken ?? undefined,
      opponent: params.get("opponent") ?? "Opponent",
    };
  });

  useEffect(() => {
    if (!init) {
      router.replace("/lobby");
      return;
    }
    window.history.replaceState({}, "", "/game");
  }, [init, router]);

  if (!init) return null;

  return (
    <GameView
      seed={init.seed}
      mode={init.mode}
      roomId={init.roomId}
      joinToken={init.joinToken}
      opponentName={init.opponent}
    />
  );
}

export default function GamePage() {
  return (
    <Suspense fallback={
      <div className="flex flex-1 items-center justify-center bg-[#0a0a0a]">
        <p className="font-mono text-neutral-500 animate-pulse">Loading...</p>
      </div>
    }>
      <GameContent />
    </Suspense>
  );
}
