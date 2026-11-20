# ChatGPT Script Alignment

The attached document `AI Video Automation Studio — Complete Codex Project Script` is now the implementation process reference for ToolAiMe. It describes the target architecture and the order in which capabilities should be delivered; it is not evidence that an external integration is already configured.

## Delivery order

1. **Phase 1 — Foundation**: repository structure, dashboard foundation, PostgreSQL/Prisma, authentication, local storage, Docker Compose, and basic tests.
2. **Phase 2 — AI Script and Khmer Voice**: provider interfaces, script generation, translation, Khmer TTS when a provider genuinely supports it, and recorded-audio fallback.
3. **Phase 3 — Video Generator**: media imports, scene/timeline metadata, subtitles, FFmpeg rendering, preview, and export.
4. **Phase 4 — Chinese Story Recap**: licensed-source checks, transcription, translation, recap script review, narration, subtitles, and final render.
5. **Phase 5 — Social Connections**: official YouTube and Meta authorization and confirmed publishing operations.
6. **Phase 6 — Automated Publishing**: approval gate, scheduling, BullMQ workers, retries, idempotency, and publication verification.
7. **Phase 7 — Advanced Tools**: thumbnails, batch generation, calendar, analytics, cost reporting, and additional processors.

## Current repository position

The preserved application has already completed the original Phase 1 vertical slice:

`Login → Create Project → Khmer script generation or editing → upload permitted images/audio/video → FFmpeg MP4 → preview → download`

It also has the PostgreSQL/Prisma schema, auth routes, ownership checks, local storage, test coverage, and a verified Railway deployment. That working slice remains the baseline while the target architecture is migrated incrementally.

## Architecture gap being tracked

The attached script calls for a Next.js App Router frontend, NestJS API, TypeScript, Redis/BullMQ, and a Python processing service. The current production baseline is Vite + React + Express JavaScript with Prisma and an in-process render runner. This is an explicit migration gap, not a hidden limitation.

The migration must be incremental:

- Keep the existing root application buildable and deployable.
- Introduce real `apps/web` and `apps/api` services only when each has working behavior and tests.
- Move one bounded capability at a time behind the existing `/api/v1` contract.
- Do not create empty placeholder services or start Phase 2 feature work before the foundation migration decision is verified.

## Rights and integration rules

- Uploaded source media requires the user to have reuse permission; an URL alone never authorizes downloading.
- YouTube and Meta publishing are not considered working until the official API confirms the operation.
- AI/TTS features use provider abstractions and must show a configuration state when no supported provider is available.
- Publishing, deletion, and connected-account changes require explicit user approval.
