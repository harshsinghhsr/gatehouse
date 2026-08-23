-- DropIndex
DROP INDEX "Budget_userId_teamId_key";

-- DropIndex
DROP INDEX "ModelAccess_userId_teamId_providerModelId_key";

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "Budget_teamId_idx" ON "Budget"("teamId");

-- CreateIndex
CREATE INDEX "GatewayKeyReference_userId_idx" ON "GatewayKeyReference"("userId");

-- CreateIndex
CREATE INDEX "GatewayKeyReference_teamId_idx" ON "GatewayKeyReference"("teamId");

-- CreateIndex
CREATE INDEX "ModelAccess_teamId_idx" ON "ModelAccess"("teamId");

-- CreateIndex
CREATE INDEX "ModelAccess_providerModelId_idx" ON "ModelAccess"("providerModelId");

-- ---------------------------------------------------------------------------
-- Everything below is hand-written: Prisma can express neither NULLS NOT
-- DISTINCT nor CHECK, so the two invariants the schema only documented
-- ("exactly one of userId / teamId", "one grant per subject+model", "one budget
-- per subject") are declared here directly.
--
-- Existing data may violate all of them, so each constraint is preceded by the
-- collapse that makes it satisfiable.
-- ---------------------------------------------------------------------------

-- A row with no subject belongs to nobody and is unreachable from every query; a row with both
-- subjects would be counted by the per-user AND the per-team query, so the gateway would honour a
-- grant the UI cannot show. Both are deleted rather than guessed at. Losing one costs a re-grant
-- or a re-entered budget, and nothing else.
DELETE FROM "ModelAccess" WHERE ("userId" IS NULL) = ("teamId" IS NULL);
DELETE FROM "Budget" WHERE ("userId" IS NULL) = ("teamId" IS NULL);

-- A GatewayKeyReference is NOT deleted the same way. The row is our only handle on a live LiteLLM
-- key: revocation goes through key_alias, so dropping the row leaves a working credential in the
-- gateway that nothing here can ever revoke or even name. Refuse to migrate instead, and let an
-- operator revoke the key deliberately.
DO $$
DECLARE orphaned int;
BEGIN
  SELECT count(*) INTO orphaned FROM "GatewayKeyReference"
  WHERE ("userId" IS NULL) = ("teamId" IS NULL);
  IF orphaned > 0 THEN
    RAISE EXCEPTION
      'Refusing to migrate: % GatewayKeyReference row(s) have no subject or two subjects. '
      'Each is a live gateway key; deleting the row would orphan a working credential. '
      'Revoke them through the API (revocation is by key_alias), or assign each row a single '
      'userId or teamId, then re-run this migration.', orphaned;
  END IF;
END $$;

-- Duplicate grants: keep one row per subject+model. They are interchangeable (a grant carries no
-- state beyond its existence), so the oldest is kept and the rest dropped.
DELETE FROM "ModelAccess" a
USING "ModelAccess" b
WHERE a."providerModelId" = b."providerModelId"
  AND a."userId" IS NOT DISTINCT FROM b."userId"
  AND a."teamId" IS NOT DISTINCT FROM b."teamId"
  AND (a."createdAt", a."id") > (b."createdAt", b."id");

-- Duplicate budgets are NOT interchangeable — a stale duplicate with a higher ceiling can be the
-- one findFirst happens to return. Keep the most recently updated row, which is the limit the
-- operator last intended, and drop the rest.
DELETE FROM "Budget" a
USING "Budget" b
WHERE a."userId" IS NOT DISTINCT FROM b."userId"
  AND a."teamId" IS NOT DISTINCT FROM b."teamId"
  AND (a."updatedAt", a."id") < (b."updatedAt", b."id");

-- NULLS NOT DISTINCT is what makes these fire at all: exactly one subject column is always NULL,
-- and under the default NULLS DISTINCT every row is unique to Postgres.
CREATE UNIQUE INDEX "Budget_subject_key" ON "Budget" ("userId", "teamId") NULLS NOT DISTINCT;
CREATE UNIQUE INDEX "ModelAccess_subject_key" ON "ModelAccess" ("userId", "teamId", "providerModelId") NULLS NOT DISTINCT;

-- Exactly one subject, enforced instead of merely commented.
ALTER TABLE "ModelAccess" ADD CONSTRAINT "ModelAccess_one_subject"
  CHECK (("userId" IS NULL) != ("teamId" IS NULL));
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_one_subject"
  CHECK (("userId" IS NULL) != ("teamId" IS NULL));
ALTER TABLE "GatewayKeyReference" ADD CONSTRAINT "GatewayKeyReference_one_subject"
  CHECK (("userId" IS NULL) != ("teamId" IS NULL));
