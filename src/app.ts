import cors from 'cors';
import express from 'express';
import { env } from './config/env';
import { errorHandler } from './middleware/error-handler';
import { registerAuthRoutes } from './modules/auth/auth.routes';
import { registerChannelsRoutes } from './modules/channels/channels.routes';
import { registerSettingsRoutes } from './modules/settings/settings.routes';
import { registerAutomationRoutes } from './modules/automation/automation.routes';
import { registerProcessJobRoutes } from './modules/automation/process-job.routes';
import { registerAnalyticsRoutes } from './modules/analytics/analytics.routes';
import { registerHealthRoutes } from './modules/health/health.routes';
import { registerVideoRoutes } from './modules/video/video.routes';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.CLIENT_ORIGIN === '*' ? true : env.CLIENT_ORIGIN,
      credentials: true
    })
  );
  app.use(express.json());

  app.get(['/favicon.ico', '/favicon.png'], (_req, res) => {
    res.status(204).end();
  });

  app.get('/', (_req, res) => {
    res.json({
      service: 'youtube-automation-api',
      status: 'ok'
    });
  });

  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerChannelsRoutes(app);
  registerSettingsRoutes(app);
  registerAutomationRoutes(app);
  registerProcessJobRoutes(app);
  registerAnalyticsRoutes(app);
  registerVideoRoutes(app);

  app.use(errorHandler);
  return app;
}

export const app = createApp();
export default app;
