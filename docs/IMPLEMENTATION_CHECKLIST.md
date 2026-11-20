# ToolAiMe Implementation Checklist

This checklist follows the attached ChatGPT project script. A task is marked `DONE` only after its implementation and verification are recorded in `docs/IMPLEMENTATION_STATUS.md`.

## Phase 1 — Foundation and verified vertical slice

- [x] Preserve the working repository and document the current architecture.
- [x] Define Prisma PostgreSQL models, migration, and development seed.
- [x] Add protected registration, login, and ownership-scoped API routes.
- [x] Add dashboard layout, responsive navigation, and explicit planned-feature states.
- [x] Add secure local media storage and file validation.
- [x] Add a reproducible PostgreSQL Docker Compose service.
- [x] Implement the local vertical slice: project → Khmer script → media → FFmpeg MP4 → preview/download.
- [x] Verify the generated MP4 with FFprobe.
- [ ] Migrate bounded web behavior to Next.js App Router with TypeScript.
- [ ] Migrate bounded API behavior to NestJS with TypeScript.
- [ ] Add refresh-token rotation and workspace/RBAC isolation.

**Gate:** Do not begin Phase 2 feature work until the migration work is either verified or explicitly accepted as a temporary compatibility decision.

## Phase 2 — AI script and Khmer voice

- [ ] Define server-side AI provider interfaces.
- [ ] Keep Gemini credentials server-only and expose honest configuration states.
- [ ] Add script generation, translation, and version history.
- [ ] Add Khmer TTS only for voices the configured provider actually supports.
- [ ] Keep recorded-audio upload as the fallback.
- [ ] Add voice preview, speed controls, paragraph regeneration, and download.
- [ ] Add mocked provider tests and optional credential-gated live tests.

## Phase 3 — Video generator

- [ ] Add media import metadata and rights confirmation.
- [ ] Add scene/timeline JSON metadata separate from rendered files.
- [ ] Add subtitle tracks with SRT/ASS export and Khmer line-break tests.
- [ ] Add FFmpeg worker-backed render progress and cancellation.
- [ ] Verify preview/export with FFprobe.

## Phase 4 — Chinese story recap

- [ ] Require source-media reuse permission before export or publishing.
- [ ] Add transcription, timestamps, scene detection, translation, and character consistency.
- [ ] Generate an original Khmer recap without unsupported invented events.
- [ ] Add script review, narration, subtitles, and final render.

## Phase 5 — Social connections

- [ ] Add secure OAuth state/PKCE handling where applicable.
- [ ] Add official YouTube channel connection and confirmed upload status.
- [ ] Add official Facebook Page connection and confirmed Page publishing status.
- [ ] Store credentials encrypted and handle expiry, scopes, quotas, and errors.

## Phase 6 — Automated publishing

- [ ] Add approval gate and rights verification.
- [ ] Add Redis/BullMQ queues, idempotency, retries, cancellation, and reconciliation.
- [ ] Add timezone-aware scheduling using `Asia/Phnom_Penh` by default.

## Phase 7 — Advanced tools and management

- [ ] Add editor operations, thumbnails, batch processing, calendar, analytics, and cost reporting.
- [ ] Add genuine empty states where an external source is not connected.
- [ ] Add end-to-end regression coverage for all completed modules.
