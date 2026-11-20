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

## Ownership and storage

- Every project query is scoped by `userId` from the verified JWT.
- Uploaded files are stored with generated UUID filenames and a whitelisted extension.
- Preview and download endpoints verify ownership before serving a file.
- FFmpeg is invoked with `execFile`, never with a shell-built command string.

## Deliberate Phase 1 compatibility choices

The requested long-term stack names Next.js App Router, NestJS, and TypeScript. The repository already contained a functioning Vite/Express JavaScript application with Gemini, FFmpeg, YouTube, and Meta code. Replacing it would risk breaking existing working integrations, so Phase 1 adds the real workflow to that foundation. A later migration can split the web and API into `apps/web` and `apps/api` after the workflow is stable.
