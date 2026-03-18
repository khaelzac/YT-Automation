import { prisma } from '../../db/prisma';
import { JobStatus } from '@prisma/client';
import { HttpError } from '../../lib/http';
import { getPreflight } from '../settings/settings.service';

const STATUS_PENDING = 'PENDING' as JobStatus;
const STATUS_FAILED = 'FAILED' as JobStatus;

export async function createAutomationJob(userId: string, scheduledFor?: Date) {
  const preflight = await getPreflight(userId);
  if (!preflight.ready) {
    throw new HttpError(400, 'Automation prerequisites not met', preflight);
  }

  const [settings, activeChannel] = await Promise.all([
    prisma.userSettings.findUnique({ where: { userId } }),
    prisma.youTubeChannel.findFirst({ where: { userId, isActive: true } })
  ]);

  if (!settings?.niche || !activeChannel) {
    throw new HttpError(400, 'Missing active channel or niche');
  }

  const job = await prisma.automationJob.create({
    data: {
      userId,
      channelId: activeChannel.id,
      niche: settings.niche,
      scheduledFor: scheduledFor ?? null,
      status: STATUS_PENDING
    }
  });

  return job;
}

export async function markJobState(
  userId: string,
  jobId: string,
  status: JobStatus,
  message?: string
) {
  const job = await prisma.automationJob.update({
    where: { id: jobId },
    data: {
      status,
      errorMessage: status === STATUS_FAILED ? message ?? 'Job failed' : null
    }
  });

  return job;
}
