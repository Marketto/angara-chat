CREATE TABLE "User" (
  "id" TEXT NOT NULL, "googleSub" TEXT NOT NULL, "email" TEXT NOT NULL,
  "name" TEXT NOT NULL, "avatarUrl" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Session" (
  "id" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Device" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "publicKey" JSONB NOT NULL,
  "fingerprint" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Conversation" (
  "id" TEXT NOT NULL, "directKey" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ConversationMember" (
  "conversationId" TEXT NOT NULL, "userId" TEXT NOT NULL, "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationMember_pkey" PRIMARY KEY ("conversationId", "userId")
);
CREATE TABLE "Message" (
  "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "conversationId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL, "senderDeviceId" TEXT NOT NULL, "recipientDeviceId" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL, "iv" VARCHAR(32) NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PushSubscription" (
  "id" TEXT NOT NULL, "endpoint" TEXT NOT NULL, "p256dh" TEXT NOT NULL, "auth" TEXT NOT NULL,
  "userId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE UNIQUE INDEX "Device_userId_key" ON "Device"("userId");
CREATE INDEX "ConversationMember_userId_idx" ON "ConversationMember"("userId");
CREATE UNIQUE INDEX "Conversation_directKey_key" ON "Conversation"("directKey");
CREATE UNIQUE INDEX "Message_conversationId_clientId_key" ON "Message"("conversationId", "clientId");
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE INDEX "Message_senderDeviceId_idx" ON "Message"("senderDeviceId");
CREATE INDEX "Message_recipientDeviceId_idx" ON "Message"("recipientDeviceId");
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationMember" ADD CONSTRAINT "ConversationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderDeviceId_fkey" FOREIGN KEY ("senderDeviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_recipientDeviceId_fkey" FOREIGN KEY ("recipientDeviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
