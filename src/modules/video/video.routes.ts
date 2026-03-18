import { Express } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { asyncHandler, HttpError } from '../../lib/http';
import { resolveUser } from '../../lib/user-context';
import { getVideoGenerationStatus, startVideoGeneration } from './video.service';

const generateSchema = z.object({
  script: z.string().min(1),
  niche: z.string().optional()
});

export function registerVideoRoutes(app: Express) {
  app.post(
    '/api/generate',
    asyncHandler(async (req, res) => {
      const user = await resolveUser(req);
      const { script, niche } = generateSchema.parse(req.body ?? {});

      const job = await prisma.videoJob.create({
        data: {
          userId: user.id,
          scriptText: script,
          niche: niche ?? null,
          status: 'GENERATING'
        }
      });

      try {
        const start = await startVideoGeneration(script, niche ?? 'general');
        if ('placeholderUrl' in start) {
          const updated = await prisma.videoJob.update({
            where: { id: job.id },
            data: {
              status: 'COMPLETED',
              videoUrl: start.placeholderUrl
            }
          });

          return res.status(200).json({
            jobId: updated.id,
            status: updated.status,
            videoUrl: updated.videoUrl
          });
        }

        await prisma.videoJob.update({
          where: { id: job.id },
          data: {
            status: 'GENERATING',
            requestId: start.requestId
          }
        });

        return res.status(202).json({ jobId: job.id, status: 'GENERATING' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.videoJob.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            errorMessage: message
          }
        });

        throw new HttpError(500, 'Video generation failed', { jobId: job.id });
      }
    })
  );

  app.get(
    '/api/status',
    asyncHandler(async (req, res) => {
      const user = await resolveUser(req);
      const id = typeof req.query.id === 'string' ? req.query.id : '';
      if (!id) {
        throw new HttpError(400, 'Missing id query parameter');
      }

      const job = await prisma.videoJob.findFirst({
        where: { id, userId: user.id }
      });

      if (!job) {
        throw new HttpError(404, 'Video job not found');
      }

      if (job.status === 'GENERATING' && job.requestId) {
        try {
          const status = await getVideoGenerationStatus(job.requestId);
          if (status.status === 'done' && status.url) {
            const updated = await prisma.videoJob.update({
              where: { id: job.id },
              data: {
                status: 'COMPLETED',
                videoUrl: status.url
              }
            });

            return res.json({
              jobId: updated.id,
              status: updated.status,
              videoUrl: updated.videoUrl
            });
          }

          if (status.status === 'expired') {
            const updated = await prisma.videoJob.update({
              where: { id: job.id },
              data: {
                status: 'FAILED',
                errorMessage: 'Video generation expired'
              }
            });

            return res.json({
              jobId: updated.id,
              status: updated.status,
              errorMessage: updated.errorMessage
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await prisma.videoJob.update({
            where: { id: job.id },
            data: {
              status: 'FAILED',
              errorMessage: message
            }
          });

          throw new HttpError(500, 'Video status check failed', { jobId: job.id });
        }
      }

      return res.json({
        jobId: job.id,
        status: job.status,
        videoUrl: job.videoUrl,
        errorMessage: job.errorMessage ?? null
      });
    })
  );
}
