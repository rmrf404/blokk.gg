import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BLOKK.GG — Competitive Pong",
  description: "Fast 1v1 Pong with verified multiplayer matchmaking and instant guest play.",
  metadataBase: new URL("https://blokk.gg"),
  openGraph: {
    title: "BLOKK.GG — Competitive Pong",
    description: "Fast 1v1 Pong with verified multiplayer matchmaking and instant guest play.",
    url: "https://blokk.gg",
    siteName: "BLOKK.GG",
    type: "website",
    images: [{ url: "/banner.png", width: 1200, height: 630, alt: "BLOKK.GG — Competitive Pong" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "BLOKK.GG — Competitive Pong",
    description: "Fast 1v1 Pong with verified multiplayer matchmaking and instant guest play.",
    images: ["/banner.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-[#0a0a0a] text-white font-sans antialiased">
        <Providers>{children}</Providers>
        <footer className="fixed bottom-0 left-0 right-0 z-50 flex justify-center items-center gap-4 py-3 pointer-events-none">
          <a
            href="https://ko-fi.com/blokkgg"
            target="_blank"
            rel="noopener noreferrer"
            className="pointer-events-auto px-4 py-2 font-mono text-xs tracking-[0.2em] text-neutral-500 transition-colors hover:text-white"
            style={{ mixBlendMode: "difference" }}
          >
            DONATE
          </a>
          <a
            href="https://x.com/rmrf_404"
            target="_blank"
            rel="noopener noreferrer"
            className="pointer-events-auto px-4 py-2 font-mono text-xs tracking-[0.2em] text-neutral-500 transition-colors hover:text-white"
            style={{ mixBlendMode: "difference" }}
          >
            X
          </a>
          <a
            href="https://github.com/rmrf404/blokk.gg"
            target="_blank"
            rel="noopener noreferrer"
            className="pointer-events-auto px-4 py-2 font-mono text-xs tracking-[0.2em] text-neutral-500 transition-colors hover:text-white"
            style={{ mixBlendMode: "difference" }}
          >
            GITHUB
          </a>
        </footer>
      </body>
    </html>
  );
}
