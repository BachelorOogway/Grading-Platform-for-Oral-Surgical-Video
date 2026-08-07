-- AlterTable
ALTER TABLE "TaskAssignment" ADD COLUMN IF NOT EXISTS "graderSlot" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TaskAssignment_aiOutputId_graderSlot_idx" ON "TaskAssignment"("aiOutputId", "graderSlot");

-- CreateTable
CREATE TABLE IF NOT EXISTS "DiscrepancyItem" (
    "id" TEXT NOT NULL,
    "aiOutputId" TEXT NOT NULL,
    "fieldPath" TEXT NOT NULL,
    "fieldLabel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedValue" TEXT,
    "createdByExpert" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscrepancyItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DiscrepancyVote" (
    "id" TEXT NOT NULL,
    "discrepancyItemId" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "choice" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscrepancyVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DiscrepancyItem_aiOutputId_fieldPath_key" ON "DiscrepancyItem"("aiOutputId", "fieldPath");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DiscrepancyItem_status_idx" ON "DiscrepancyItem"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DiscrepancyVote_discrepancyItemId_expertId_key" ON "DiscrepancyVote"("discrepancyItemId", "expertId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DiscrepancyItem" ADD CONSTRAINT "DiscrepancyItem_aiOutputId_fkey" FOREIGN KEY ("aiOutputId") REFERENCES "AiOutput"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DiscrepancyVote" ADD CONSTRAINT "DiscrepancyVote_discrepancyItemId_fkey" FOREIGN KEY ("discrepancyItemId") REFERENCES "DiscrepancyItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
