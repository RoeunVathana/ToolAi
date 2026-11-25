# ToolAiMe Phase 1 Architecture

Phase 1 reuses the existing repository's Vite + React + Express foundation so the working Gemini/media features remain intact. The Phase 1 domain API is isolated under `/api/v1` and is backed by Prisma/PostgreSQL.

## Runtime flow

```text
React dashboard
  -> JWT-authenticated REST API (/api/v1)
  -> Prisma Client
  -> PostgreSQL

Media upload -> storage/phase1/<project-id>/
Render request -> controlled in-process job runner -> FFmpeg/FFprobe -> MP4
```

The render job is deliberately a simple in-process runner for Phase 1. Redis/BullMQ is deferred until the core workflow is verified. Long-running jobs update `RenderJob` progress and are polled by the wizard.

## Incremental typed boundary

The repository now contains a verified first slice of the target split:

- `apps/api` is a NestJS + TypeScript service exposing `GET /api/v1/health` on port `8788` by default.
- `apps/web` is a Next.js App Router + TypeScript surface that reads that health contract and reports the typed API state.
- The existing Express service exposes the same `/api/v1/health` contract and remains the production baseline on port `8787`.

This is intentionally a real, tested boundary rather than an empty placeholder. Future capabilities can move behind the same contract after their behavior and ownership checks are covered.

## Ownership and storage

- Every project query is scoped by `userId` from the verified JWT.
- Uploaded files are stored with generated UUID filenames and a whitelisted extension.
- Preview and download endpoints verify ownership before serving a file.
- FFmpeg is invoked with `execFile`, never with a shell-built command string.

## Deliberate Phase 1 compatibility choices

The requested long-term stack names Next.js App Router, NestJS, and TypeScript. The repository already contained a functioning Vite/Express JavaScript application with Gemini, FFmpeg, YouTube, and Meta code. Replacing it would risk breaking existing working integrations, so Phase 1 adds the real workflow to that foundation. A later migration can split the web and API into `apps/web` and `apps/api` after the workflow is stable.
