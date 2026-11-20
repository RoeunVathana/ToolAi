-- Auto Publisher approval and scheduling drafts. External publication remains
-- blocked until the corresponding provider connection is configured and verified.
CREATE TABLE "PublishJob" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tags" TEXT,
    "privacyStatus" TEXT NOT NULL DEFAULT 'private',
    "scheduledAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Phnom_Penh',
    "rightsVerified" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "publishedUrl" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PublishJob_userId_status_updatedAt_idx" ON "PublishJob"("userId", "status", "updatedAt");
CREATE INDEX "PublishJob_projectId_platform_createdAt_idx" ON "PublishJob"("projectId", "platform", "createdAt");

ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
