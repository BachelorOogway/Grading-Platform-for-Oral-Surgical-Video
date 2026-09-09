-- graderSlot was added with DEFAULT 1, so every assignment created before the
-- three-grader migration collapsed onto slot 1. With no slot 3 there is no
-- tiebreaker, which silently disables the side-by-side consensus view and
-- discrepancy solve. Renumber by claim order, but only for videos whose slots
-- actually collide, so correctly numbered videos keep their existing order.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "aiOutputId"
      ORDER BY "assignedAt", "id"
    ) AS rn
  FROM "TaskAssignment"
),
broken AS (
  SELECT "aiOutputId"
  FROM "TaskAssignment"
  GROUP BY "aiOutputId"
  HAVING COUNT(*) > COUNT(DISTINCT "graderSlot")
)
UPDATE "TaskAssignment" t
SET "graderSlot" = r.rn
FROM ranked r
WHERE t."id" = r."id"
  AND t."aiOutputId" IN (SELECT "aiOutputId" FROM broken)
  AND t."graderSlot" <> r.rn;
