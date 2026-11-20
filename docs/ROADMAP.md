# ToolAiMe Roadmap

## Phase 1 — Local video MVP

Status: `DONE` (live Gemini configuration remains optional and unverified).

Acceptance: register/login, create a project, write or generate a Khmer script, upload images and narration, render a real H.264/AAC MP4 with FFmpeg, preview it, and download it with ownership checks.

## Phase 2 — Khmer AI Voice

Status: `TODO`.

Dependency: Phase 1 workflow and provider configuration.

Acceptance: provider-backed TTS abstraction, only real supported Khmer voices, preview/download, speed controls, paragraph regeneration, narration history, and recorded-audio fallback.

## Phase 3 — Chinese Story Recap

Status: `TODO`.

Dependency: Phase 2 plus authorized source-media workflow.

Acceptance: source permission tracking, transcription, scene analysis, natural Khmer recap, review/edit, subtitles, and final render without inventing unsupported events.

## Phase 4 — Editor and additional AI tools

Status: `TODO`.

Dependency: stable media/render model.

Acceptance: timeline operations, subtitles, audio mixing, thumbnail/metadata tools, converter/compressor, and batch processing.

## Phase 5 — YouTube channel manager

Status: `TODO`.

Dependency: approved render artifacts and secure credential storage.

Acceptance: OAuth, token refresh, confirmed private upload, metadata, thumbnail, status tracking, published URL, quotas, and analytics.

## Phase 6 — Facebook Page manager

Status: `TODO`.

Dependency: Meta app configuration and Page permissions.

Acceptance: Page OAuth, Page selection, confirmed Page video/Reel publishing, permission errors, and supported analytics.

## Phase 7 — Auto publishing

Status: `TODO`.

Dependency: Phases 5 and 6.

Acceptance: approval gate, timezone-aware scheduling, Redis/BullMQ retries, duplicate prevention, logs, cancel/retry, and publication verification.

## Phase 8 — Analytics and management

Status: `TODO`.

Dependency: real platform connections.

Acceptance: genuine project, processing, publishing, AI usage, and supported social metrics with honest empty states.
