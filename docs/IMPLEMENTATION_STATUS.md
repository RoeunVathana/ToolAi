# Implementation Status

Updated: 2026-11-21 (Asia/Bangkok)

## Process alignment

The attached ChatGPT project script is the process reference for future work. The current repository has a verified Phase 1 vertical slice, but its production baseline is still Vite/React + Express/JavaScript. The requested Next.js App Router + NestJS/TypeScript split is tracked as an incremental foundation migration and is not being claimed as complete.

- `DONE` — architecture, Prisma schema/migrations, authentication, dashboard, local storage, CRUD, tests, and working render vertical slice.
- `DONE` — reproducible PostgreSQL Docker Compose setup in `docker-compose.yml`.
- `IN_PROGRESS` — bounded migration toward `apps/web` and `apps/api`; the root app remains the deployable baseline until replacement behavior is verified.
- `TODO` — refresh tokens, workspace/RBAC isolation, Redis/BullMQ, Python processing, and later AI/social phases.

The detailed mapping is in [docs/CHATGPT_SCRIPT_ALIGNMENT.md](CHATGPT_SCRIPT_ALIGNMENT.md).

## Phase 1

| Area | Status | Implemented files | Verification | Known limitations |
| --- | --- | --- | --- | --- |
| Repository preservation | DONE | `src/main.jsx`, `server/index.js`, existing generation/publishing modules | Existing server routes preserved; production build passes | Phase 1 uses Vite/Express JS foundation instead of the planned Next/Nest split |
| Authentication | DONE | `server/phase1.js`, `src/main.jsx` | Register, login, `/me`, JWT checks, password hashing tested | Access-token-only session; refresh-token rotation is deferred |
| PostgreSQL + Prisma | DONE | `prisma/schema.prisma`, `prisma/migrations/`, `prisma/seed.js` | `prisma validate`, migration, reset, seed verified locally; Railway PostgreSQL service provisioned and production migration/seed startup verified | Local PostgreSQL still needs a valid `DATABASE_URL` password |
| Project manager | DONE | `server/phase1.js`, `src/main.jsx` | Create/list/open/update/delete routes are ownership-scoped | Delete confirmation UI is deferred |
| Gemini Khmer script | DONE | `server/phase1.js` | New Google AI Studio key verified remotely with real Khmer output using `gemini-3.5-flash-lite` | Free-tier quota/model availability can vary; manual editing remains available |
| Manual script editing | DONE | `src/main.jsx` | Save route and wizard state verified | None known for Phase 1 scope |
| Media upload/preview | DONE | `server/phase1.js`, `src/main.jsx` | JPG/PNG/WebP + MP4 + MP3/WAV upload, FFprobe validation, preview URLs, reorder/delete tested locally and remotely | MP4 source assets are stored/previewable; Phase 1 rendering still uses image assets plus narration |
| FFmpeg rendering | DONE | `server/phase1.js` | Generated sample PNG + WAV rendered remotely to MP4; FFprobe confirmed `mov,mp4,m4a,3gp,3g2,mj2` and 2 seconds | In-process job runner; no durable queue yet |
| Final preview/download | DONE | `server/phase1.js`, `src/main.jsx` | Authorized inline preview and download tested | Rendered video is not published in Phase 1 |
| Dashboard UX | DONE | `src/main.jsx`, `src/styles.css`, `index.html` | `npm run build` passes; responsive CSS and dark/light controls are implemented | Browser screenshot QA should be run in the connected desktop when available |

## Test results

- `npm run build` — PASS.
- `node --check server/phase1.js` — PASS.
- `node --check server/index.js` — PASS.
- `npx prisma validate` with `DATABASE_URL` — PASS.
- Prisma migration + seed on isolated PostgreSQL 18 — PASS.
- `npm run test:phase1` — PASS: auth, ownership, missing Gemini configuration, upload validation, FFmpeg render, preview, download, and FFprobe verification.
- Remote Railway smoke test — PASS: admin login, `/me`, project create/edit, image upload, audio upload, render, inline MP4 preview, download, and FFprobe verification. The temporary project was deleted after the test.
- Remote MP4 upload — PASS: generated one-second MP4 accepted as `VIDEO`, stored on Railway volume, and returned as an authorized `video/mp4` preview; temporary project deleted.
- Live Gemini connectivity — PASS: new Free-tier key generated in Google AI Studio, configured only in Railway secrets, and verified through the live Khmer script endpoint.
- Railway deployment — PASS: PostgreSQL service attached, JWT/database variables configured, migrations and optional admin seed run at startup.

## Phase 2 start — similar Khmer voice

| Area | Status | Implemented files | Verification | Known limitations |
| --- | --- | --- | --- | --- |
| Similar voice narration | IN_PROGRESS | `server/phase1.js`, `src/main.jsx`, `src/styles.css` | Build and syntax checks pass; missing-input API validation is covered in `tests/phase1.test.js` | Live generation requires Gemini 3.8 Flash TTS voice replication access, an authentic 10–30 second sample, a 2–30 second same-speaker consent recording, and a supported paid-tier Gemini project; no voice was fabricated for testing |

The implementation uses Gemini's stateless voice replication mode (`store: false`) and does not persist a voice profile. Generated WAV narration is saved as the project's newest audio asset so the existing FFmpeg render workflow can use it.

## Phase 2 gate

Phase 2 has not started. It should begin only after the user supplies a valid database URL for normal local use and, if live AI generation is required, a newly created/revoked-safe Gemini key in `.env`.
