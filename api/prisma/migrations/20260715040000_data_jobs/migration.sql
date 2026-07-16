CREATE TYPE "DataJobType" AS ENUM ('QA_EXPORT', 'VEHICLE_IMPORT');
CREATE TYPE "DataJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "data_jobs" (
    "id" SERIAL NOT NULL,
    "type" "DataJobType" NOT NULL,
    "status" "DataJobStatus" NOT NULL DEFAULT 'QUEUED',
    "requestedById" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "originalFileName" TEXT,
    "inputPath" TEXT,
    "artifactPath" TEXT,
    "artifactName" TEXT,
    "artifactSize" BIGINT,
    "result" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "data_jobs_progress_check" CHECK ("progress" BETWEEN 0 AND 100)
);

CREATE INDEX "data_jobs_requestedById_type_createdAt_idx"
    ON "data_jobs"("requestedById", "type", "createdAt" DESC);
CREATE INDEX "data_jobs_status_createdAt_idx"
    ON "data_jobs"("status", "createdAt");
CREATE INDEX "data_jobs_expiresAt_idx" ON "data_jobs"("expiresAt");
CREATE UNIQUE INDEX "data_jobs_one_active_per_owner_type"
    ON "data_jobs"("requestedById", "type")
    WHERE "status" IN ('QUEUED', 'PROCESSING');
