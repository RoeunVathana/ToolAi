CREATE TABLE "VoiceNarration" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "projectId" UUID,
    "title" TEXT NOT NULL,
    "script" TEXT NOT NULL,
    "voice" TEXT NOT NULL,
    "speed" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'TTS',
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'audio/wav',
    "size" INTEGER NOT NULL,
    "durationSeconds" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceNarration_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VoiceNarration_userId_createdAt_idx" ON "VoiceNarration"("userId", "createdAt");
CREATE INDEX "VoiceNarration_projectId_createdAt_idx" ON "VoiceNarration"("projectId", "createdAt");

ALTER TABLE "VoiceNarration" ADD CONSTRAINT "VoiceNarration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoiceNarration" ADD CONSTRAINT "VoiceNarration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "VideoProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
