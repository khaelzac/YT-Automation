import { Express, Request, Response } from 'express';
import { env } from '../../config/env';
import { asyncHandler, HttpError } from '../../lib/http';
import { processDueJobs } from './process-job.service';
import { runScheduleScan } from './scheduler.service';

function isAuthorized(headers: Record<string, string | string[] | undefined>) {
  if (!env.CRON_SECRET) return true;

  const auth = typeof headers.authorization === 'string' ? headers.authorization : '';
  const bearerToken = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const cronSecretHeader = typeof headers['x-cron-secret'] === 'string' ? headers['x-cron-secret'] : '';

  return bearerToken === env.CRON_SECRET || cronSecretHeader === env.CRON_SECRET;
}

function parseLimit(rawLimit: unknown) {
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed)) return env.CRON_MAX_JOBS_PER_RUN;
  return Math.min(2, Math.max(1, Math.floor(parsed)));
}

async function handleProcessJob(req: Request, res: Response) {
  if (!isAuthorized(req.headers as Record<string, string | string[] | undefined>)) {
    throw new HttpError(401, 'Unauthorized cron request');
  }

  const bodyLimit =
    req.body && typeof req.body === 'object' && req.body !== null
      ? (req.body as { limit?: number }).limit
      : undefined;
  const limit = parseLimit(req.query.limit ?? bodyLimit ?? env.CRON_MAX_JOBS_PER_RUN);
  const cappedTimeBudgetMs = Math.min(env.CRON_TIME_BUDGET_MS, 25_000);

  const result = await processDueJobs({
    maxJobs: limit,
    timeBudgetMs: cappedTimeBudgetMs
  });

  res.json({
    ok: true,
    ...result
  });
}

export function registerProcessJobRoutes(app: Express) {
  app.post('/api/process-job', asyncHandler(handleProcessJob));
  app.get('/api/process-job', asyncHandler(handleProcessJob));

  app.post(
    '/api/schedule-scan',
    asyncHandler(async (req, res) => {
      if (!isAuthorized(req.headers as Record<string, string | string[] | undefined>)) {
        throw new HttpError(401, 'Unauthorized cron request');
      }

      const result = await runScheduleScan();
      res.json({ ok: true, ...result });
    })
  );

  app.get(
    '/api/schedule-scan',
    asyncHandler(async (req, res) => {
      if (!isAuthorized(req.headers as Record<string, string | string[] | undefined>)) {
        throw new HttpError(401, 'Unauthorized cron request');
      }

      const result = await runScheduleScan();
      res.json({ ok: true, ...result });
    })
  );
}
