<h1 align="center">BLOKK.GG</h1>

<p align="center">
  Competitive 1v1 Power-Up Pong &mdash; play ranked matches or jump in as a guest.
</p>

---

## About

**BLOKK.GG** is a high-contrast, black-and-white 1v1 Pong game with real-time multiplayer and a weekly ranked leaderboard. Sign in with X (Twitter) for ranked play or start instantly as a guest against the CPU or another player online.

## Features

- **Real-time multiplayer** — server-authoritative 60 Hz match simulation over WebSockets (PartyServer on Cloudflare Durable Objects)
- **Ranked play** — ELO-based rating with a weekly leaderboard (auth-vs-auth matches only)
- **Guest access** — no sign-up required; jump straight into a match
- **Sudden death** — at 9-9, the next point wins
- **CPU mode** — practice offline against AI
- **Mobile & desktop** — touch controls and keyboard support

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend + API | Next.js 16 (App Router, React 19) |
| Real-time multiplayer | PartyServer on Cloudflare Durable Objects |
| Authentication | Auth.js v5 + X/Twitter OAuth 2.0 |
| Database | Supabase (players, matches, leaderboard RPCs) |
| Game engine | Pure TypeScript (framework-agnostic) |

## Getting Started

```bash
# Install dependencies
npm install

# Run the Next.js dev server
npm run dev

# Run the PartyServer dev server (separate terminal)
npm run party:dev
```

### Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Production build |
| `npm run start` | Start the production server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run party:dev` | Start the PartyServer dev server |
| `npm run party:deploy` | Deploy the PartyServer worker |

## How It Works

1. **Sign in with X** for ranked play, or **play as a guest** instantly.
2. Queue up for a match — the matchmaker pairs you with another player.
3. The server runs the authoritative Pong simulation; clients send paddle inputs only.
4. First to 10 points wins. At 9-9, it's sudden death.
6. Ranked results update your ELO and appear on the weekly leaderboard.

## Project Structure

```
blokk.gg/
├── src/
│   ├── app/          # Next.js pages and API routes
│   ├── auth/         # Auth.js v5 configuration
│   ├── components/   # React components (GameView, GameControls, etc.)
│   ├── engine/       # Pure TypeScript Pong engine
│   ├── lib/          # Security helpers (match tokens, player identity)
│   └── multiplayer/  # Client/server message types
├── party/            # PartyServer (matchmaker, game rooms, match loop)
├── supabase/         # Database migrations
└── public/           # Static assets
```

## Support

BLOKK.GG is a non-profit project. If you enjoy it, consider supporting development:

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20BLOKK.GG-black?style=flat&logo=ko-fi)](https://ko-fi.com/blokkgg)

## License

This project is open source under the [MIT License](LICENSE).

---

<p align="center">
  <sub>Built with the help of <a href="https://claude.ai/claude-code">Claude Code</a> and <a href="https://openai.com/index/codex/">Codex</a>.</sub>
</p>
