import { Express } from 'express';
import { asyncHandler, HttpError } from '../../lib/http';
import { resolveUser } from '../../lib/user-context';
import { prisma } from '../../db/prisma';
import { getLatestAnalytics } from './analytics.service';

export function registerAnalyticsRoutes(app: Express) {
  app.get(
    '/api/analytics/:jobId',
    asyncHandler(async (req, res) => {
      const user = await resolveUser(req);
      const job = await prisma.automationJob.findFirst({
        where: { id: req.params.jobId, userId: user.id }
      });
      if (!job) throw new HttpError(404, 'Job not found');

      const snapshot = await getLatestAnalytics(job.id);
      res.json({
        analytics: {
          viewCount: snapshot?.viewCount ?? 0,
          impressionRate: snapshot?.impressionRate ?? 0
        }
      });
    })
  );
}
