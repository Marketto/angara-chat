import { createServer } from 'node:http';
import { app } from './app.js';
import { config } from './config.js';
import { db } from './db.js';
import { attachSocket } from './socket.js';
import { startImageRetention } from './image-retention.js';

const server = createServer(app);
attachSocket(server);
const stopImageRetention = startImageRetention();
server.listen(config.PORT, () => console.log(`Angara server listening on :${config.PORT}`));

async function shutdown() {
  stopImageRetention();
  server.close();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
