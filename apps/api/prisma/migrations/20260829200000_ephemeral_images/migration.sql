ALTER TABLE "MessageAttachment"
  ALTER COLUMN "data" DROP NOT NULL,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "purgedAt" TIMESTAMP(3);

UPDATE "MessageAttachment" AS attachment
SET "createdAt" = message."createdAt"
FROM "Message" AS message
WHERE attachment."messageId" = message."id";

UPDATE "MessageAttachment" AS attachment
SET "expiresAt" = message."createdAt" + INTERVAL '47 hours 59 minutes'
FROM "Message" AS message
WHERE attachment."messageId" = message."id"
  AND message."kind" = 'IMAGE'::"MessageKind";

CREATE INDEX "MessageAttachment_expiresAt_idx" ON "MessageAttachment"("expiresAt");
