# Slideshow Generator

AI-powered tool for creating and auto-posting TikTok/Instagram slideshows from book quotes and excerpts. Generate slides from text prompts, preview them, and post manually or on an automated schedule.

## Features

- **Manual posting** — Generate slides from text/prompts, preview, and post to TikTok
- **Automated posting** — Cron-driven scheduler posts slideshows within configured time windows
- **Top-N lists** — Generate ranked book lists as video slideshows
- **Instagram support** — Cross-post slideshows to Instagram
- **Book management** — Store and organize books, excerpts, and slideshows

## Tech Stack

- Next.js 14 (App Router) / React 18 / TypeScript
- Tailwind CSS 4 / Framer Motion
- Upstash Redis (sole database)
- Google Gemini for AI text generation
- `@resvg/resvg-js` + `sharp` for image rendering, `ffmpeg-static` for video
- PostBridge API for TikTok/Instagram publishing
- Deployed on Vercel

## Getting Started

**Prerequisites:** Node.js 20+

```bash
npm install
cp .env.local.example .env.local   # fill in your values
npm run dev                         # http://localhost:3000
```

### Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `APP_PASSWORD` | Yes | Single-user password authentication |
| `CRON_SECRET` | Yes | Bearer token for cron and admin routes |
| `KV_REST_API_URL` | Yes | Upstash Redis REST URL |
| `KV_REST_API_TOKEN` | Yes | Upstash Redis REST token |
| `POSTBRIDGE_API_KEY` | Yes | PostBridge API key for TikTok/IG posting |
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `ANTHROPIC_API_KEY` | No | Enables AI chat feature |

## Project Structure

```
app/                        # Next.js App Router pages and API routes
├── page.tsx                # Home — login, automation config, manual post
├── books/                  # Book library
├── create/                 # Slideshow editor
├── excerpts/               # Book excerpts
├── instagram/              # Instagram automation
├── top-books/              # Top-N book lists
└── api/
    ├── cron/post/          # Automated posting (TikTok, IG, Top-N)
    ├── generate/           # Slide image generation
    ├── post-tiktok/        # Manual TikTok posting
    └── ...                 # books, settings, admin, etc.

components/                 # React components
hooks/                      # Custom React hooks (auth, accounts, books, config)
lib/                        # Server-side logic
├── kv.ts                   # Redis operations and config types
├── post-bridge.ts          # PostBridge API client
├── gemini.ts               # Gemini AI client
├── render-slide.ts         # SVG → PNG rendering
├── render-video.ts         # ffmpeg video assembly
└── cron/                   # Cron scheduling, locks, time windows
types/                      # Shared TypeScript interfaces
```

## Deployment

Hosted on Vercel. Pushes to `main` trigger automatic deployments.

The `next.config.mjs` includes `outputFileTracingIncludes` for font files and `ffmpeg-static` binaries — these are required for serverless functions to work correctly on Vercel.

## Build

```bash
npm run build               # production build
npm start                   # serve production build locally
```
