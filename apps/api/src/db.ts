import { PrismaClient } from '../generated/client/index.js';

export const db = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
