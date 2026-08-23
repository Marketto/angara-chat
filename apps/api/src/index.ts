import { createServer } from 'node:http';
import { app } from './app.js';
import { config } from './config.js';
import { db } from './db.js';
import { attachSocket } from './socket.js';

const server = createServer(app);
attachSocket(server);
server.listen(config.PORT, () => console.log(`Angara server listening on :${config.PORT}`));

async function shutdown() {
  server.close();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
