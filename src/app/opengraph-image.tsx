import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "BLOKK.GG — Competitive Pong";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage() {
  const [jetbrainsMonoBold, interRegular] = await Promise.all([
    fetch("https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8SKtjPQ.ttf").then((r) => r.arrayBuffer()),
    fetch("https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg.ttf").then((r) => r.arrayBuffer()),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a0a0a",
          gap: 24,
        }}
      >
        {/* Title */}
        <div style={{ display: "flex", alignItems: "baseline" }}>
          <span
            style={{
              fontSize: 120,
              fontFamily: "JetBrains Mono",
              fontWeight: 900,
              color: "#ffffff",
              letterSpacing: "-0.06em",
            }}
          >
            BLOKK
          </span>
          <span
            style={{
              fontSize: 120,
              fontFamily: "JetBrains Mono",
              fontWeight: 900,
              color: "#666666",
              letterSpacing: "-0.06em",
            }}
          >
            .GG
          </span>
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: 20,
            fontFamily: "JetBrains Mono",
            letterSpacing: "0.45em",
            color: "#666666",
            textTransform: "uppercase",
          }}
        >
          Competitive Pong
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 18,
            fontFamily: "Inter",
            color: "#666666",
            marginTop: 16,
          }}
        >
          Fast-paced 1v1 Pong. First to 10 wins. Play ranked or jump in as a guest.
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "JetBrains Mono", data: jetbrainsMonoBold, weight: 900, style: "normal" },
        { name: "Inter", data: interRegular, weight: 400, style: "normal" },
      ],
    },
  );
}
