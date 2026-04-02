"use client";

import { useEffect, useState } from "react";
import { ARENA_HEIGHT, ARENA_WIDTH } from "@/engine/pong";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function useResponsiveGameLayout() {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const updateViewport = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);
    return () => {
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
    };
  }, []);

  const width = viewport.width || 1440;
  const height = viewport.height || 900;
  const isCompact = width < 1100;
  const isMobile = width < 768;
  const targetAspectRatio = ARENA_HEIGHT / ARENA_WIDTH;
  const maxArenaWidth = isMobile ? Math.min(width - 36, 300) : isCompact ? Math.min(width - 260, 420) : Math.min(width * 0.3, 460);
  const maxArenaHeight = isMobile ? height * 0.56 : isCompact ? height * 0.74 : height * 0.82;
  const fittedArenaWidth = Math.min(maxArenaWidth, maxArenaHeight * targetAspectRatio);
  const fittedArenaHeight = fittedArenaWidth / targetAspectRatio;
  const arenaWidth = clamp(fittedArenaWidth, 180, 460);
  const arenaHeight = clamp(fittedArenaHeight, 260, 760);

  return {
    arenaWidth,
    arenaHeight,
    isCompact,
    isMobile,
  };
}
