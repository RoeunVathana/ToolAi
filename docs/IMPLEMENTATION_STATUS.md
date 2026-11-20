# Implementation Status

Updated: 2026-11-21 (Asia/Bangkok)

## Phase 1

| Area | Status | Implemented files | Verification | Known limitations |
| --- | --- | --- | --- | --- |
| Repository preservation | DONE | `src/main.jsx`, `server/index.js`, existing generation/publishing modules | Existing server routes preserved; production build passes | Phase 1 uses Vite/Express JS foundation instead of the planned Next/Nest split |
| Authentication | DONE | `server/phase1.js`, `src/main.jsx` | Register, login, `/me`, JWT checks, password hashing tested | Access-token-only session; refresh-token rotation is deferred |
| PostgreSQL + Prisma | DONE | `prisma/schema.prisma`, `prisma/migrations/`, `prisma/seed.js` | `prisma validate`, migration, reset, seed verified locally; Railway PostgreSQL service provisioned and production migration/seed startup verified | Local PostgreSQL still needs a valid `DATABASE_URL` password |
| Project manager | DONE | `server/phase1.js`, `src/main.jsx` | Create/list/open/update/delete routes are ownership-scoped | Delete confirmation UI is deferred |
| Gemini Khmer script | DONE | `server/phase1.js` | Provider call is real; remote admin workflow reached Gemini and the API returned its actual provider response | Railway Gemini credential currently returns Google `401 API key not valid`; manual editing remains available |
| Manual script editing | DONE | `src/main.jsx` | Save route and wizard state verified | None known for Phase 1 scope |
| Media upload/preview | DONE | `server/phase1.js`, `src/main.jsx` | JPG/PNG/WebP + MP3/WAV upload, validation, preview URLs, reorder/delete tested locally and remotely | Local/Railway volume storage only |
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
- Live Gemini connectivity — BLOCKED by the configured Railway key being rejected with Google `401 API key not valid`; the API does not fabricate a script and manual editing remains available.
- Railway deployment — PASS: PostgreSQL service attached, JWT/database variables configured, migrations and optional admin seed run at startup.

## Phase 2 gate

Phase 2 has not started. It should begin only after the user supplies a valid database URL for normal local use and, if live AI generation is required, a newly created/revoked-safe Gemini key in `.env`.
