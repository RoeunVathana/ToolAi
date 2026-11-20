# ToolAiMe Database

Prisma schema: [prisma/schema.prisma](../prisma/schema.prisma)

Models in Phase 1:

- `User` — account identity and password hash.
- `VideoProject` — owned project, script, language, render settings, and status.
- `MediaAsset` — uploaded image/narration metadata and secure local storage path.
- `RenderJob` — queued/running/completed/failed render state and output path.

The first migration is in `prisma/migrations/20261120190759_phase1_initial/migration.sql`.

PowerShell:

```powershell
Copy-Item .env.example .env
# Edit DATABASE_URL to match the local PostgreSQL credentials.
npm run db:generate
npm run db:migrate
npm run db:seed
```

Bash:

```bash
cp .env.example .env
# Edit DATABASE_URL to match the local PostgreSQL credentials.
npm run db:generate
npm run db:migrate
npm run db:seed
```

The development seed creates `demo@toolaime.local` with password `ChangeMe123!`; change or remove it for a shared environment.
