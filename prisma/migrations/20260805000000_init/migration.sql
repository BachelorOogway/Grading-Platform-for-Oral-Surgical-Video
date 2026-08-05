-- CreateSchema
CREATE TABLE "AssignmentConfig" (
    "id" TEXT NOT NULL,
    "exclusiveRanges" TEXT NOT NULL,
    "sharedRanges" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expert" (
    "id" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiOutput" (
    "id" TEXT NOT NULL,
    "videoOutputId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "parsedData" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignment" (
    "id" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "aiOutputId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'EXCLUSIVE',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "regradeNote" TEXT,
    "regradeRequestedAt" TIMESTAMP(3),

    CONSTRAINT "TaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradingResult" (
    "id" TEXT NOT NULL,
    "taskAssignmentId" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "aiOutputId" TEXT NOT NULL,
    "gradingData" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradingResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Expert_name_idx" ON "Expert"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Expert_expertId_key" ON "Expert"("expertId");

-- CreateIndex
CREATE INDEX "AiOutput_createdAt_idx" ON "AiOutput"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiOutput_videoOutputId_key" ON "AiOutput"("videoOutputId");

-- CreateIndex
CREATE INDEX "TaskAssignment_status_idx" ON "TaskAssignment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignment_expertId_aiOutputId_key" ON "TaskAssignment"("expertId", "aiOutputId");

-- CreateIndex
CREATE INDEX "GradingResult_submittedAt_idx" ON "GradingResult"("submittedAt");

-- CreateIndex
CREATE INDEX "GradingResult_expertId_idx" ON "GradingResult"("expertId");

-- CreateIndex
CREATE INDEX "GradingResult_aiOutputId_idx" ON "GradingResult"("aiOutputId");

-- CreateIndex
CREATE UNIQUE INDEX "GradingResult_taskAssignmentId_key" ON "GradingResult"("taskAssignmentId");

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "Expert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_aiOutputId_fkey" FOREIGN KEY ("aiOutputId") REFERENCES "AiOutput"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingResult" ADD CONSTRAINT "GradingResult_taskAssignmentId_fkey" FOREIGN KEY ("taskAssignmentId") REFERENCES "TaskAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingResult" ADD CONSTRAINT "GradingResult_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "Expert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingResult" ADD CONSTRAINT "GradingResult_aiOutputId_fkey" FOREIGN KEY ("aiOutputId") REFERENCES "AiOutput"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
