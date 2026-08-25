import express from 'express';
import helmet from 'helmet';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './routes.js';
import { verifyOrigin } from './session.js';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/style'],
      imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com'],
      connectSrc: ["'self'", 'wss:', 'https://accounts.google.com/gsi/'],
      frameSrc: ['https://accounts.google.com/gsi/'],
      objectSrc: ["'none'"],
    },
  },
  // Google Identity needs its popup to retain an opener on browsers without FedCM.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(express.json({ limit: '64kb' }));
app.use(verifyOrigin);
app.use('/api', api);

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
app.use(express.static(webRoot, { index: false, maxAge: '1d' }));
app.get('/{*path}', (_request, response) => response.sendFile('index.html', { root: webRoot }));
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  response.status(500).json({ error: 'INTERNAL_ERROR' });
});
