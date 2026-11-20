# ToolAiMe — AI Video Automation Studio

ToolAiMe is a local-first AI video workspace. Phase 1 implements:

`Register/Login → Create Project → Generate or edit Khmer script → Upload images and narration → FFmpeg MP4 render → Preview → Download`

The existing Gemini scene-generation and social-publishing code remains available, while the new `/api/v1` routes and dashboard focus on this MVP. Later modules are shown as explicit planned states.

## Requirements

- Node.js 20+
- PostgreSQL 14+
- FFmpeg and FFprobe (bundled through `ffmpeg-static` and `ffprobe-static` by default)
- A Gemini API key only for live script generation

## Local setup

PowerShell:

```powershell
npm install
Copy-Item .env.example .env
# Edit .env: set DATABASE_URL and JWT_ACCESS_SECRET.
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Bash:

```bash
npm install
cp .env.example .env
# Edit .env: set DATABASE_URL and JWT_ACCESS_SECRET.
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite serves the dashboard and Express serves the API on `PORT` (default `8787`). `npm start` serves the built dashboard from `dist` and the API from Express.

Use the actual credentials for your local PostgreSQL service in `DATABASE_URL`; the example password is a placeholder. Never commit `.env` or provider keys.

## Useful commands

```text
npm run build          # production frontend build
npm run preview        # preview the Vite build
npm run db:generate    # generate Prisma Client
npm run db:migrate     # create/apply a development migration
npm run db:seed        # seed demo data
npm run test:phase1    # API, upload, render, preview/download, and FFprobe test
```

The Phase 1 test uses a running API and PostgreSQL:

```powershell
$env:TEST_BASE_URL = "http://localhost:8787"
npm run test:phase1
```

## Environment

See [.env.example](.env.example). Phase 1 uses `DATABASE_URL`, `JWT_ACCESS_SECRET`, `STORAGE_PATH`, FFmpeg overrides, and `GEMINI_API_KEY`/`GEMINI_MODEL` for real Gemini scripts. `JWT_REFRESH_SECRET` is reserved for the refresh-token phase.

Without Gemini credentials, users can still register, create projects, write/edit Khmer scripts manually, upload media, and render real MP4 files. The API does not fabricate a Gemini response.

## Phase 1 API

- Auth: `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `GET /api/v1/auth/me`
- Projects: `GET/POST /api/v1/projects`, `GET/PATCH/DELETE /api/v1/projects/:id`
- Gemini: `POST /api/v1/gemini/generate-script`
- Media: `POST /api/v1/projects/:id/media`, `GET /api/v1/projects/:id/media`, `PATCH/DELETE /api/v1/media/:id`, `GET /api/v1/media/:id/preview`
- Rendering: `POST /api/v1/projects/:id/render`, `GET /api/v1/render-jobs/:id`, `GET /api/v1/render-jobs/:id/download`

All relevant routes require a Bearer JWT and enforce project ownership.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Database](docs/DATABASE.md)
- [Implementation status](docs/IMPLEMENTATION_STATUS.md)
- [Roadmap](docs/ROADMAP.md)

## External integrations

YouTube, Facebook, Gemini video, and other provider settings from the original repository remain optional and are not claimed as connected by Phase 1. Live Gemini script testing is blocked until a valid key is configured server-side. Publishing remains a later-phase workflow in the ToolAiMe dashboard.
