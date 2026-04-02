"use client";

import { GameView } from "./GameView";

interface RankedGameViewProps {
  roomId: string;
  joinToken: string;
  opponentName?: string;
}

export function RankedGameView(props: RankedGameViewProps) {
  return (
    <GameView
      seed={1}
      mode="pvp"
      roomId={props.roomId}
      joinToken={props.joinToken}
      opponentName={props.opponentName}
    />
  );
}
