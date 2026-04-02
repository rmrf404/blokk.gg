import { auth } from "@/auth/auth";
import { createSupabaseServer } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

function getISOWeekBounds(): { weekStart: string; weekEnd: string } {
  const now = new Date();
  const day = now.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diffToMonday),
  );
  const nextMonday = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);

  return {
    weekStart: monday.toISOString(),
    weekEnd: nextMonday.toISOString(),
  };
}

export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.json({ week_start: null, week_end: null, entries: [], me: null });
  }

  const supabase = await createSupabaseServer();
  const { weekStart, weekEnd } = getISOWeekBounds();

  const { data, error } = await supabase.rpc("weekly_leaderboard", {
    result_limit: 100,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const entries = data ?? [];

  // Check if the current user is signed in and fetch their rank
  let me = null;
  const session = await auth();
  if (session?.user?.xId) {
    const isInTop100 = entries.some(
      (e: { x_handle: string }) => e.x_handle === session.user!.xHandle,
    );
    if (!isInTop100) {
      const { data: rankData } = await supabase.rpc("player_weekly_rank", {
        target_x_id: session.user.xId,
      });
      if (rankData && rankData.length > 0) {
        me = rankData[0];
      }
    }
  }

  return NextResponse.json({
    week_start: weekStart,
    week_end: weekEnd,
    entries,
    me,
  });
}
