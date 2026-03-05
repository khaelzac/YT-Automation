import { Express } from 'express';

export function registerHealthRoutes(app: Express) {
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'youtube-automation-api' });
  });
}
