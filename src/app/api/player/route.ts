import { NextResponse } from "next/server";
import { createIdentityResponsePayload } from "@/lib/player-identity";

export async function GET() {
  const payload = await createIdentityResponsePayload();
  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(payload);
}
