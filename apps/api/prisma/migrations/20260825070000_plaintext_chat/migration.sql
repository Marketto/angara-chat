ALTER TABLE "Message" DROP CONSTRAINT "Message_senderDeviceId_fkey";
ALTER TABLE "Message" DROP CONSTRAINT "Message_recipientDeviceId_fkey";
ALTER TABLE "Message" DROP COLUMN "senderDeviceId", DROP COLUMN "recipientDeviceId", DROP COLUMN "ciphertext", DROP COLUMN "iv", DROP COLUMN "version";
ALTER TABLE "Message" ADD COLUMN "body" TEXT NOT NULL DEFAULT '';
DROP INDEX "Device_userId_key";
