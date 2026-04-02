import { NextResponse } from "next/server";
import { issueGuestIdentity } from "@/lib/player-identity";

export async function POST() {
  const player = await issueGuestIdentity();
  return NextResponse.json({ player });
}
