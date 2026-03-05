import { Express } from 'express';
import { asyncHandler, HttpError } from '../../lib/http';
import { resolveUser } from '../../lib/user-context';
import { prisma } from '../../db/prisma';
import { createAutomationJob } from './automation.service';

export function registerAutomationRoutes(app: Express) {
  app.post(
    '/api/automation/start',
    asyncHandler(async (req, res) => {
      const user = await resolveUser(req);
      const job = await createAutomationJob(user.id);
      res.status(201).json({ job });
    })
  );

  app.get(
    '/api/automation/jobs',
    asyncHandler(async (req, res) => {
      const user = await resolveUser(req);
      const jobs = await prisma.automationJob.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 50
      });
      res.json({ jobs });
    })
  );

  app.get(
    '/api/automation/jobs/:id',
    asyncHandler(async (req, res) => {
      const user = await resolveUser(req);
      const job = await prisma.automationJob.findFirst({
        where: { id: req.params.id, userId: user.id }
      });
      if (!job) throw new HttpError(404, 'Job not found');
      res.json({ job });
    })
  );
}
