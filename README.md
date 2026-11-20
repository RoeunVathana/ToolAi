# ToolAiMe — AI Video Automation Studio

ToolAiMe is a local-first AI video workspace. Phase 1 implements:

`Register/Login → Create Project → Generate or edit Khmer script → Upload images and narration → FFmpeg MP4 render → Preview → Download`

The existing Gemini scene-generation and social-publishing code remains available, while the new `/api/v1` routes and dashboard focus on the verified local workflow. Khmer AI Voice is now an active narration studio, and Auto Publisher is now an active approval center for completed local renders. External publication remains configuration-gated and is never reported as successful without provider confirmation.

## Requirements

- Node.js 20+
- PostgreSQL 14+
- FFmpeg and FFprobe (bundled through `ffmpeg-static` and `ffprobe-static` by default)
- A Gemini API key for live script and Khmer TTS generation (recorded MP3/WAV upload works without it)

## Local setup

The development order follows [the ChatGPT script alignment](docs/CHATGPT_SCRIPT_ALIGNMENT.md). The current root app is the verified baseline while the Next.js/NestJS split is migrated in bounded, tested steps.

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

If Docker Desktop is available, PostgreSQL can be started with:

```powershell
docker compose up -d postgres
```

```bash
docker compose up -d postgres
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

Open [http://localhost:5173](http://localhost:5173). Vite serves the dashboard and Express serves the API on `PORT` (default `8787`). `npm start` applies production Prisma migrations, runs the configured seed, then serves the built dashboard from `dist` and the API from Express. Use `npm run start:app` when the database is already migrated and you only want to start the server.

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

## Automatic Railway deployment

The GitHub Actions workflow at `.github/workflows/ci-cd.yml` validates every pull request and push to `main`. A push to `main` deploys to Railway after validation when the repository has these GitHub Actions settings:

- Secret `RAILWAY_TOKEN`: a Railway project or workspace token stored only in GitHub Actions secrets.
- Secret `RAILWAY_PROJECT_ID`: `297d4868-15b5-43cc-9a51-6b559bb1d3f6`.
- Variable `RAILWAY_ENVIRONMENT`: `production` (optional; this is the default).
- Variable `RAILWAY_SERVICE_ID`: `76aba715-5c7e-4612-95ae-004fecc4b8c0` (optional; this is the default).

The workflow also supports `workflow_dispatch` for a manual deployment from GitHub. Never commit a Railway token or paste it into source files. Railway's native GitHub auto-deploy toggle additionally requires the Railway GitHub App to be installed with access to `RoeunVathana/ToolAi`; the current Railway account reports `NO_INSTALLATION`, so the Actions workflow is the deterministic deployment path once the secret is added.

The Phase 1 test uses a running API and PostgreSQL:

```powershell
$env:TEST_BASE_URL = "http://localhost:8787"
npm run test:phase1
```

## Environment

See [.env.example](.env.example). Phase 1 uses `DATABASE_URL`, `JWT_ACCESS_SECRET`, `STORAGE_PATH`, FFmpeg overrides, and `GEMINI_API_KEY`/`GEMINI_MODEL` for real Gemini scripts. Set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` to create or update an optional deployment admin test account during startup. This is an account seed, not a separate role system; role-based authorization remains a later phase. `JWT_REFRESH_SECRET` is reserved for the refresh-token phase.

Without Gemini credentials, users can still register, create projects, write/edit Khmer scripts manually, upload media, and render real MP4 files. The API does not fabricate a Gemini response.

## Phase 1 API

- Auth: `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `GET /api/v1/auth/me`
- Projects: `GET/POST /api/v1/projects`, `GET/PATCH/DELETE /api/v1/projects/:id`
- Gemini: `POST /api/v1/gemini/generate-script`
- Similar voice narration: `POST /api/v1/projects/:id/voice/generate`; requires a 10–30 second MP3/WAV reference sample, a 2–30 second consent recording, and explicit ownership confirmation. It uses a one-off Gemini replicated voice profile and saves the generated WAV as the project narration asset.
- Khmer AI Voice: `GET /api/v1/voice/catalog`, `GET /api/v1/voice/narrations`, `POST /api/v1/voice/narrations`, `POST /api/v1/voice/narrations/:id/regenerate-paragraph`, and `POST /api/v1/voice/upload`. The studio supports Khmer script input, supported Gemini voices, 0.75×–1.50× speed, preview, WAV download, paragraph regeneration, narration history, optional project attachment, and recorded-audio fallback.
- Voice files: `GET /api/v1/voice/narrations/:id/preview` and `GET /api/v1/voice/narrations/:id/download`; all voice routes are JWT-protected and user-scoped.
- Story recap timeline: `GET /api/v1/voice/timelines`, `POST /api/v1/voice/timelines`, and protected video/audio/SRT preview/download routes. Upload an authorized MP4, paste/upload SRT, generate Khmer narration or supply MP3/WAV, preview the exported MP4, download the SRT, and optionally attach the exported video to a project.
- Auto Publisher: `GET /api/v1/publishing/config`, `GET /api/v1/publishing/jobs`, `POST /api/v1/publishing/jobs`, and protected `approve`, `cancel`, and `publish` actions. Completed rendered MP4s can be queued with metadata, rights confirmation, an approval gate, and a timezone-aware schedule draft. The `publish` action refuses to run until official provider credentials are configured and the provider adapter is verified; it does not fake publication.
- Media: `POST /api/v1/projects/:id/media`, `GET /api/v1/projects/:id/media`, `PATCH/DELETE /api/v1/media/:id`, `GET /api/v1/media/:id/preview`; accepts JPG, PNG, WebP, MP4, MP3, and WAV. MP4 files are stored and previewable as source assets; Phase 1 rendering still uses image assets plus narration.
- Rendering: `POST /api/v1/projects/:id/render`, `GET /api/v1/render-jobs/:id`, `GET /api/v1/render-jobs/:id/download`

All relevant routes require a Bearer JWT and enforce project ownership.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Database](docs/DATABASE.md)
- [Implementation checklist](docs/IMPLEMENTATION_CHECKLIST.md)
- [ChatGPT script alignment](docs/CHATGPT_SCRIPT_ALIGNMENT.md)
- [Implementation status](docs/IMPLEMENTATION_STATUS.md)
- [Roadmap](docs/ROADMAP.md)

## External integrations

YouTube, Facebook, Gemini video, and other provider settings from the original repository remain optional and are not claimed as connected until the official provider confirms access. The Auto Publisher page is available now for local approval and scheduling drafts; actual YouTube/Facebook publication still requires the related OAuth/Page credentials and a verified adapter. Similar voice generation requires a Gemini paid-tier project, two authentic recordings from the same adult speaker, and the required consent statement; without those inputs, recorded narration upload remains the fallback.
