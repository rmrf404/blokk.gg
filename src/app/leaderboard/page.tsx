"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { shareOnX } from "@/lib/share";

interface LeaderboardEntry {
  player_id: string;
  x_handle: string;
  x_avatar: string | null;
  display_name: string;
  wins: number;
  losses: number;
  total_games: number;
  win_rate: number;
  elo: number;
}

interface PlayerRank extends LeaderboardEntry {
  position: number;
}

interface LeaderboardData {
  week_start: string | null;
  week_end: string | null;
  entries: LeaderboardEntry[];
  me: PlayerRank | null;
}

function formatWeekRange(start: string | null, end: string | null): string {
  if (!start || !end) return "";
  const s = new Date(start);
  const e = new Date(end);
  e.setDate(e.getDate() - 1);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(s)} — ${fmt(e)}`;
}

function EntryRow({
  entry,
  position,
  highlight,
}: {
  entry: LeaderboardEntry;
  position: number;
  highlight?: boolean;
}) {
  const isTop3 = position <= 3 && !highlight;
  return (
    <div
      className={`grid grid-cols-[2rem_2.5rem_1fr_3rem_3.5rem_4rem] items-center gap-3 rounded-sm px-3 py-2.5 ${
        highlight
          ? "bg-white/[0.08] border border-white/20"
          : isTop3
            ? "bg-white/[0.04] border border-white/10"
            : "border border-transparent"
      }`}
    >
      <span
        className={`font-mono text-sm font-bold ${
          highlight || isTop3 ? "text-white" : "text-neutral-600"
        }`}
      >
        {position}
      </span>

      {entry.x_avatar ? (
        <Image
          src={entry.x_avatar}
          alt=""
          width={28}
          height={28}
          className="h-7 w-7 rounded-full bg-neutral-800"
        />
      ) : (
        <div className="h-7 w-7 rounded-full bg-neutral-800" />
      )}

      <span
        className={`font-mono text-sm truncate ${
          highlight || isTop3 ? "text-white font-bold" : "text-neutral-300"
        }`}
      >
        @{entry.x_handle}
      </span>

      <span
        className={`font-mono text-xs text-right ${
          highlight || isTop3 ? "text-white" : "text-neutral-400"
        }`}
      >
        {entry.elo}
      </span>

      <span className="font-mono text-xs text-neutral-500 text-right">
        {entry.wins}-{entry.losses}
      </span>

      <span
        className={`font-mono text-xs text-right ${
          highlight || isTop3 ? "text-white" : "text-neutral-400"
        }`}
      >
        {(entry.win_rate * 100).toFixed(0)}%
      </span>
    </div>
  );
}

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/leaderboard")
      .then((r) => r.json())
      .then((d: LeaderboardData) => setData(d))
      .catch(() => setData({ week_start: null, week_end: null, entries: [], me: null }))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex min-h-dvh flex-col items-center bg-[#0a0a0a] px-4 py-12 sm:py-16">
      <div className="flex w-full max-w-lg flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-2">
          <h1 className="font-mono text-2xl font-black tracking-[0.12em] sm:text-3xl">
            LEADERBOARD
          </h1>
          {data?.week_start && (
            <p className="font-mono text-xs tracking-[0.2em] text-neutral-500">
              {formatWeekRange(data.week_start, data.week_end)}
            </p>
          )}
          <p className="font-mono text-[10px] tracking-[0.2em] text-neutral-600 uppercase">
            Resets every Monday
          </p>
        </div>

        {loading ? (
          <p className="font-mono text-sm text-neutral-500 animate-pulse">Loading...</p>
        ) : data?.entries.length === 0 && !data?.me ? (
          <p className="py-16 font-mono text-sm text-neutral-500">
            No ranked matches this week yet.
          </p>
        ) : (
          <div className="w-full flex flex-col gap-1">
            <div className="grid grid-cols-[2rem_2.5rem_1fr_3rem_3.5rem_4rem] items-center gap-3 px-3 py-2 font-mono text-[10px] tracking-[0.15em] text-neutral-600 uppercase">
              <span>#</span>
              <span />
              <span>Player</span>
              <span className="text-right">ELO</span>
              <span className="text-right">W-L</span>
              <span className="text-right">Win %</span>
            </div>

            {data?.entries.map((entry, i) => (
              <EntryRow key={entry.player_id} entry={entry} position={i + 1} />
            ))}

            {data?.me && (
              <>
                <div className="flex items-center gap-2 px-3 py-2">
                  <div className="h-px flex-1 bg-white/10" />
                  <span className="font-mono text-[10px] text-neutral-600">YOU</span>
                  <div className="h-px flex-1 bg-white/10" />
                </div>
                <EntryRow
                  entry={data.me}
                  position={data.me.position}
                  highlight
                />
              </>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-4">
          <a
            href="/lobby"
            className="flex h-12 w-36 items-center justify-center rounded-sm border border-white/40 bg-black font-mono text-xs font-bold tracking-[0.28em] text-white transition-colors hover:bg-white hover:text-black"
          >
            LOBBY
          </a>
          <Link
            href="/"
            className="flex h-12 w-36 items-center justify-center rounded-sm border border-white/40 bg-black font-mono text-xs font-bold tracking-[0.28em] text-white transition-colors hover:bg-white hover:text-black"
          >
            HOME
          </Link>
          {data?.me && (
            <button
              type="button"
              onClick={() => {
                const me = data!.me!;
                const text = `Ranked #${me.position} on the blokk.gg Pong leaderboard this week! 🏓\n\n${me.elo} ELO · ${me.wins}W - ${me.losses}L (${(me.win_rate * 100).toFixed(0)}% win rate)\n\nhttps://blokk.gg/leaderboard`;
                shareOnX(text);
              }}
              className="flex h-12 w-36 items-center justify-center rounded-sm border border-white/40 bg-black font-mono text-xs font-bold tracking-[0.28em] text-white transition-colors hover:bg-white hover:text-black"
            >
              SHARE ON X
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
