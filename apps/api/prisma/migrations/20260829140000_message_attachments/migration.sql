CREATE TYPE "MessageKind" AS ENUM ('TEXT', 'IMAGE', 'DOCUMENT', 'LOCATION');

ALTER TABLE "Message"
  ADD COLUMN "kind" "MessageKind" NOT NULL DEFAULT 'TEXT',
  ADD COLUMN "locationLatitude" DOUBLE PRECISION,
  ADD COLUMN "locationLongitude" DOUBLE PRECISION,
  ADD COLUMN "locationAccuracy" DOUBLE PRECISION;

CREATE TABLE "MessageAttachment" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mediaType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageAttachment_messageId_key" ON "MessageAttachment"("messageId");

ALTER TABLE "MessageAttachment"
  ADD CONSTRAINT "MessageAttachment_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
