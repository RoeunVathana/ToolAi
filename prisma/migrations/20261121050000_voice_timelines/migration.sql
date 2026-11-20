CREATE TABLE "VoiceTimeline" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "projectId" UUID,
    "title" TEXT NOT NULL,
    "voice" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "audioPath" TEXT,
    "subtitlePath" TEXT,
    "outputPath" TEXT,
    "subtitleText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "durationSeconds" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceTimeline_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VoiceTimeline_userId_createdAt_idx" ON "VoiceTimeline"("userId", "createdAt");
CREATE INDEX "VoiceTimeline_projectId_createdAt_idx" ON "VoiceTimeline"("projectId", "createdAt");

ALTER TABLE "VoiceTimeline" ADD CONSTRAINT "VoiceTimeline_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoiceTimeline" ADD CONSTRAINT "VoiceTimeline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "VideoProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
