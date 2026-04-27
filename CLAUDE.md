# CLAUDE.md

## What This App Does

Slideshow Generator is a personal AI-powered tool for creating and auto-posting TikTok/Instagram slideshows from book quotes and excerpts. It supports:

- **Manual posting**: Generate slides from text/prompts, preview, and post to TikTok
- **Automated posting**: Cron-driven scheduler posts slideshows within configured time windows
- **Top-N lists**: Generate ranked book lists as video slideshows
- **Instagram support**: Cross-post slideshows to Instagram
- **Book management**: Store and organize books, excerpts, and slideshows

Deployed at: `slideshow-generator-nine.vercel.app`
GitHub: `ccas77/slideshow-generator`

## Tech Stack

- **Framework**: Next.js 14 (App Router), React 18, TypeScript
- **Styling**: Tailwind CSS 4, Framer Motion
- **Database**: Upstash Redis (sole database — all config, books, slideshows stored here)
- **AI**: Google Gemini (`@google/genai`) for text generation
- **Image rendering**: `@resvg/resvg-js` (SVG to PNG), `sharp` (image processing)
- **Video**: `ffmpeg-static` (image sequences to MP4)
- **Publishing**: PostBridge API (TikTok/Instagram posting)
- **Hosting**: Vercel

## Folder Structure

```
app/
├── page.tsx                    # Home — login, automation config, manual post (thin shell)
├── layout.tsx                  # Root layout
├── books/page.tsx              # Book library management
├── chat/page.tsx               # AI chat interface
├── create/page.tsx             # Slideshow creation editor
├── excerpts/page.tsx           # Book excerpts browser
├── instagram/page.tsx          # Instagram automation
├── posts/page.tsx              # Post history
├── settings/page.tsx           # App settings
├── top-books/page.tsx          # Top-N book lists
└── api/
    ├── cron/post/route.ts      # Automated posting cron (TikTok, IG, Top-N)
    ├── post-tiktok/route.ts    # Manual TikTok post
    ├── post-results/route.ts   # Fetch posting results from PostBridge
    ├── generate/route.ts       # Generate slideshow images
    ├── generate-slides/route.ts # Slide generation pipeline
    ├── top-n-generate/route.ts # Top-N video generation
    ├── top-n-preview/route.ts  # Top-N preview
    ├── books/route.ts          # Books CRUD
    ├── excerpts/route.ts       # Excerpts CRUD
    ├── account-data/route.ts   # Per-account config read/write
    ├── settings/route.ts       # App settings
    ├── ig-automation/route.ts  # Instagram automation config
    ├── topn-automation/route.ts # Top-N automation config
    ├── admin/
    │   ├── diagnose-configs/   # Raw Redis diagnostic
    │   └── migrate-configs/    # Config migration to canonical shape
    └── ...                     # chat, health, music-tracks, etc.

components/
├── home/
│   ├── LoginScreen.tsx         # Password login form
│   ├── AutomationTab.tsx       # TikTok automation settings
│   └── PostNowTab.tsx          # Manual slide generation & posting
├── AppHeader.tsx               # Navigation header
├── SlidePreview.tsx            # Slide image preview
└── ui/                         # Shared UI components

hooks/
├── useAuth.ts                  # Password auth state
├── useAccounts.ts              # TikTok account fetching
├── useBooks.ts                 # Book CRUD operations
└── useAccountData.ts           # Per-account config & drafts

lib/
├── kv.ts                       # Redis operations, config migration, types
├── post-bridge.ts              # PostBridge API client (retry-safe)
├── gemini.ts                   # Gemini AI client
├── render-slide.ts             # SVG to PNG slide rendering
├── render-topn-slide.ts        # Top-N slide rendering
├── render-video.ts             # ffmpeg video assembly
├── font-data.ts                # Embedded font data (large, server-only)
├── slide-utils.ts              # Canvas rendering helpers
├── publisher-champ.ts          # Publishing orchestration
├── topn-publisher.ts           # Top-N publishing
├── utils.ts                    # General utilities
└── cron/
    ├── tiktok.ts               # TikTok cron logic
    ├── instagram.ts            # Instagram cron logic
    ├── topn.ts                 # Top-N cron logic
    ├── window.ts               # Time window evaluation (midnight-crossing aware)
    ├── scheduled-today.ts      # Dedup: track what's posted today
    ├── lock.ts                 # Distributed Redis lock
    └── types.ts                # Shared cron types

types/
└── index.ts                    # Shared TypeScript interfaces
```

## Environment Variables

**Required:**
| Variable | Purpose |
|---|---|
| `APP_PASSWORD` | Single-user password authentication |
| `CRON_SECRET` | Bearer token for cron routes and admin routes |
| `KV_REST_API_URL` | Upstash Redis REST URL |
| `KV_REST_API_TOKEN` | Upstash Redis REST token |
| `POSTBRIDGE_API_KEY` | PostBridge API key for TikTok/IG posting |
| `GEMINI_API_KEY` | Google Gemini API key for AI text generation |

**Optional:**
| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | For AI chat feature |

## Running Locally

```bash
npm install
cp .env.local.example .env.local   # Fill in env vars
npm run dev                         # http://localhost:3000
npm run build                       # Production build
```

## Key Architecture Notes

- **Single-user app** — uses a shared password (`APP_PASSWORD`), not per-user auth. This is different from the multi-user Creator app (bookpulls.com).
- **Redis is the only database** — all books, slideshows, configs, and state live in Upstash Redis via `lib/kv.ts`.
- **Config migration** — `migrateAutomationConfig()` in `lib/kv.ts` normalizes legacy config shapes on read. Canonical shape: `{ enabled, intervals: TimeWindow[], selections: Array<{bookId, slideshowId}>, pointer }`.
- **POST retry safety** — `lib/post-bridge.ts` does NOT retry non-GET requests on 429 to prevent duplicate posts.
- **Cron posting** — `app/api/cron/post/route.ts` handles TikTok, Instagram, and Top-N in one invocation. Uses Redis-based distributed lock and `scheduledToday` dedup.
- **Midnight-crossing windows** — Time windows like 22:00→00:30 are supported (`endMin += 1440` when end <= start).
- **`font-data.ts` is ~548KB** — contains embedded font binaries. Has `import "server-only"` guard to prevent client bundling.
- **`next.config.mjs`** — explicit `outputFileTracingIncludes` for fonts and ffmpeg binaries (required for Vercel serverless).

## Git Workflow

Commit and push to GitHub after every set of changes. No branch workflow required — push directly to main.
