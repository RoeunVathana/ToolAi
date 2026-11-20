# ToolAiMe Roadmap

The delivery order follows the attached ChatGPT project script. The existing verified video MVP is preserved while the repository is moved toward the requested Next.js/NestJS architecture incrementally. See [ChatGPT script alignment](CHATGPT_SCRIPT_ALIGNMENT.md) for the mapping and non-negotiable rights/integration rules.

## Phase 1 — Foundation and verified vertical slice

Status: `DONE` for the working baseline; `IN_PROGRESS` for target-architecture alignment.

Completed baseline: register/login, create a project, write or generate a Khmer script, upload images, narration, and permitted MP4 source media, render a real H.264/AAC MP4 with FFmpeg, preview it, and download it with ownership checks. Verified remotely with the seeded admin account and FFprobe.

Foundation checklist from the script:

- DONE — architecture, database, API, auth, dashboard, local storage, basic tests, and working vertical slice.
- DONE — reproducible PostgreSQL Docker Compose service added at `docker-compose.yml`.
- IN_PROGRESS — migrate bounded frontend/API capabilities to the requested Next.js App Router and NestJS TypeScript services without breaking the baseline.
- TODO — add refresh-token rotation, workspace/RBAC isolation, durable queues, and Python processing only when their phase begins.

## Phase 2 — AI Script and Khmer Voice

Status: `IN_PROGRESS` (Khmer AI Voice Studio is active; provider-gated verification remains).

Dependency: Phase 1 foundation and provider configuration.

Acceptance: provider-backed script/translation/TTS abstractions, active Khmer narration studio, only real supported Gemini voices, preview/download, speed controls, paragraph regeneration, narration history, optional project attachment, recorded-audio fallback, and similar voice generation only after ownership consent. Timeline voice now accepts authorized MP4 + SRT/audio and exports a previewable MP4.

## Phase 3 — Video Generator

Status: `TODO`.

Dependency: Phase 2 media and narration contracts.

Acceptance: scene/timeline metadata, permitted media imports, subtitle support, FFmpeg rendering, preview, and export.

## Phase 4 — Chinese Story Recap

Status: `TODO`.

Dependency: Phases 2 and 3 plus authorized source-media workflow.

Acceptance: source permission tracking, transcription, scene analysis, natural Khmer recap, review/edit, subtitles, and final render without inventing unsupported events.

## Phase 5 — Social connections

Status: `TODO`.

Dependency: approved render artifacts, secure credential storage, and official provider configuration.

Acceptance: official YouTube OAuth/channel management and official Meta Page authorization/management are implemented independently, with confirmed operations and honest permission/error states.

### YouTube channel manager

Dependency: Google OAuth configuration and required YouTube scopes.

Acceptance: OAuth, token refresh, confirmed private upload, metadata, thumbnail, status tracking, published URL, quotas, and analytics.

### Facebook Page manager

Dependency: Meta app configuration and Page permissions.

Acceptance: Page OAuth, Page selection, confirmed Page video/Reel publishing, permission errors, and supported analytics.

## Phase 6 — Auto publishing

Status: `IN_PROGRESS` — the Auto Publisher approval center is available now.

Dependency: approved render artifacts and future YouTube/Facebook connections.

Available now: completed-render selection, platform metadata drafts, rights confirmation, approval gate, cancellation, timezone-aware schedule drafts, and truthful “not configured” provider states.

Remaining acceptance: official YouTube and Meta Page connections, Redis/BullMQ retries, duplicate prevention, job logs, manual retry, cancel scheduled jobs, provider-confirmed publication URLs, and verified publication status.

## Phase 7 — Advanced tools and management

Status: `TODO`.

Dependency: stable media/render model and the social/publishing phases.

Acceptance: timeline operations, subtitles, audio mixing, thumbnail/metadata tools, converter/compressor, batch processing, content calendar, and genuine analytics/cost reporting with honest empty states.
