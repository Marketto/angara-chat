export const attachmentMetadataSelection = {
  id: true, fileName: true, mediaType: true, byteSize: true, sha256: true,
  createdAt: true, expiresAt: true, purgedAt: true,
} as const;

export const messageSelection = {
  id: true,
  clientId: true,
  conversationId: true,
  senderId: true,
  kind: true,
  body: true,
  locationLatitude: true,
  locationLongitude: true,
  locationAccuracy: true,
  createdAt: true,
  attachment: { select: attachmentMetadataSelection },
} as const;
