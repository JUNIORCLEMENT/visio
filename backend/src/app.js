import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { pool } from './db.js';
import { errorHandler, forbidden, notFound } from './errors.js';
import { loadIdentity } from './middleware/auth.js';
import { adminRouter } from './routes/admin.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { callsRouter, contactsRouter } from './routes/calls.routes.js';
import { invitationsRouter } from './routes/invitations.routes.js';
import { meetingsRouter } from './routes/meetings.routes.js';
import { notificationsRouter } from './routes/notifications.routes.js';
import { publicRouter } from './routes/public.routes.js';
import { reportsRouter } from './routes/reports.routes.js';
import { webhookRouter } from './routes/webhook.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(helmet());
  // Webhooks LiveKit : corps brut nécessaire à la vérification de signature (avant express.json)
  app.use('/api/livekit/webhook', webhookRouter);
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Protection CSRF complémentaire au cookie SameSite=Strict :
  // une requête qui modifie des données doit venir du site HPO Visio lui-même.
  const allowedOrigin = new URL(config.appUrl).origin;
  app.use((req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin && origin !== allowedOrigin && origin !== `${req.protocol}://${req.get('host')}`) {
      return next(forbidden('Origine de la requête refusée.'));
    }
    next();
  });

  app.use(loadIdentity);

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'database_down' });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/invitations', invitationsRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/meetings', meetingsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/contacts', contactsRouter);
  app.use('/api/calls', callsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/admin', adminRouter);

  app.use('/api', (_req, _res, next) => next(notFound('Adresse d’API inconnue.')));
  app.use(errorHandler);
  return app;
}
