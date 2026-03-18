import { AutomationJob, JobStatus } from '@prisma/client';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { prisma } from '../../db/prisma';
import { generateMetadata } from '../metadata/metadata.service';
import { generateScript, validateGeneratedScript } from '../script/script.service';
import { uploadToYouTube } from '../youtube/youtube.service';
import { getVideoGenerationStatus, startVideoGeneration } from '../video/video.service';

const CLAIMABLE_STATUSES: JobStatus[] = [
  'PENDING',
  'DELAYED',
  'PROCESSING',
  'GENERATING_VIDEO',
  'GENERATING_METADATA',
  'UPLOADING'
];
const VIDEO_STATUS_POLL_DELAY_SECONDS = 60;

type ProcessOutcome = {
  jobId: string;
  status: 'completed' | 'failed' | 'delayed' | 'skipped';
  reason?: string;
};

function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('rate_limit') || message.includes('429');
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseRateLimitDelaySeconds(message: string): number {
  const match = message.match(/try again in\s+([0-9.]+)s/i);
  if (!match) return env.RATE_LIMIT_DELAY_SECONDS;

  const parsed = Number.parseFloat(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return env.RATE_LIMIT_DELAY_SECONDS;
  return Math.ceil(parsed);
}

async function claimNextDueJob(now: Date): Promise<AutomationJob | null> {
  const candidate = await prisma.automationJob.findFirst({
    where: {
      status: { in: CLAIMABLE_STATUSES },
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }]
    },
    orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'asc' }]
  });

  if (!candidate) return null;

  const lockUntil = new Date(Date.now() + Math.min(env.CRON_TIME_BUDGET_MS, 60_000));
  const claimed = await prisma.automationJob.updateMany({
    where: {
      id: candidate.id,
      status: { in: CLAIMABLE_STATUSES }
    },
    data: {
      status: 'PROCESSING',
      errorMessage: null,
      scheduledFor: lockUntil
    }
  });

  if (claimed.count === 0) return null;
  return prisma.automationJob.findUnique({ where: { id: candidate.id } });
}

async function failJob(job: AutomationJob, reason: string): Promise<ProcessOutcome> {
  await prisma.automationJob.update({
    where: { id: job.id },
    data: {
      status: 'FAILED',
      errorMessage: reason,
      retryCount: { increment: 1 }
    }
  });

  return { jobId: job.id, status: 'failed', reason };
}

async function delayJob(job: AutomationJob, reason: string, delaySeconds: number): Promise<ProcessOutcome> {
  const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000);
  await prisma.automationJob.update({
    where: { id: job.id },
    data: {
      status: 'DELAYED',
      errorMessage: reason,
      retryCount: { increment: 1 },
      scheduledFor: nextAttemptAt
    }
  });

  return { jobId: job.id, status: 'delayed', reason };
}

function getScriptRetryDelaySeconds(job: AutomationJob) {
  const attempt = Math.max(1, job.retryCount + 1);
  const backoffMs = env.SCRIPT_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
  return Math.max(1, Math.ceil(backoffMs / 1000));
}

function canRetryScript(job: AutomationJob) {
  return job.retryCount + 1 < env.SCRIPT_RETRY_MAX;
}

async function generateScriptOnce(
  job: AutomationJob,
  previousTitles: string[],
  deadlineAtMs: number
): Promise<{ script: string } | { delayed: true; reason: string; delaySeconds: number } | { failed: true; reason: string }> {
  if (Date.now() >= deadlineAtMs) {
    return { failed: true, reason: 'Time budget exceeded before script generation completed.' };
  }

  try {
    const script = await generateScript(job.niche, previousTitles);
    const validation = validateGeneratedScript(script, previousTitles);

    if (validation.valid) {
      return { script };
    }

    return { failed: true, reason: `Generated script failed validation: ${validation.issues.join(' | ')}` };
  } catch (error) {
    const reason = getErrorMessage(error);
    if (isRateLimitError(error)) {
      return {
        delayed: true,
        reason,
        delaySeconds: parseRateLimitDelaySeconds(reason)
      };
    }

    return { failed: true, reason };
  }
}

async function processClaimedJob(job: AutomationJob, deadlineAtMs: number): Promise<ProcessOutcome> {
  if (job.status !== 'PROCESSING') {
    return { jobId: job.id, status: 'skipped', reason: `Job not in PROCESSING state (${job.status}).` };
  }

  if (job.youtubeVideoId) {
    await prisma.automationJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        errorMessage: null
      }
    });

    return { jobId: job.id, status: 'completed', reason: 'Skipped upload; job already has youtubeVideoId.' };
  }

  const priorTitleRows = await prisma.automationJob.findMany({
    where: {
      userId: job.userId,
      id: { not: job.id },
      title: { not: null }
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { title: true }
  });
  const previousTitles = priorTitleRows
    .map((row) => row.title)
    .filter((title): title is string => Boolean(title?.trim()));

  if (!job.scriptText) {
    const scriptResult = await generateScriptOnce(job, previousTitles, deadlineAtMs);
    if ('delayed' in scriptResult) {
      return delayJob(job, scriptResult.reason, scriptResult.delaySeconds);
    }

    if ('failed' in scriptResult) {
      if (canRetryScript(job)) {
        const delaySeconds = getScriptRetryDelaySeconds(job);
        return delayJob(job, scriptResult.reason, delaySeconds);
      }
      return failJob(job, scriptResult.reason);
    }

    await prisma.automationJob.update({
      where: { id: job.id },
      data: {
        status: 'GENERATING_VIDEO',
        errorMessage: null,
        scriptText: scriptResult.script,
        scheduledFor: null
      }
    });

    return { jobId: job.id, status: 'completed', reason: 'Script generated.' };
  }

  if (!job.videoRequestId && !job.videoAssetUrl) {
    try {
      const start = await startVideoGeneration(job.scriptText, job.niche);
      if ('placeholderUrl' in start) {
        await prisma.automationJob.update({
          where: { id: job.id },
          data: {
            status: 'GENERATING_METADATA',
            errorMessage: null,
            videoAssetUrl: start.placeholderUrl,
            scheduledFor: null
          }
        });

        return { jobId: job.id, status: 'completed', reason: 'Video placeholder generated.' };
      }

      await prisma.automationJob.update({
        where: { id: job.id },
        data: {
          status: 'GENERATING_VIDEO',
          errorMessage: null,
          videoRequestId: start.requestId,
          scheduledFor: new Date(Date.now() + VIDEO_STATUS_POLL_DELAY_SECONDS * 1000)
        }
      });

      return { jobId: job.id, status: 'completed', reason: 'Video generation started.' };
    } catch (error) {
      return failJob(job, `Video generation failed: ${getErrorMessage(error)}`);
    }
  }

  if (job.videoRequestId && !job.videoAssetUrl) {
    try {
      const status = await getVideoGenerationStatus(job.videoRequestId);
      if (status.status === 'done' && status.url) {
        await prisma.automationJob.update({
          where: { id: job.id },
          data: {
            status: 'GENERATING_METADATA',
            errorMessage: null,
            videoAssetUrl: status.url,
            videoRequestId: null,
            scheduledFor: null
          }
        });

        return { jobId: job.id, status: 'completed', reason: 'Video ready.' };
      }

      if (status.status === 'expired') {
        return failJob(job, 'xAI video generation request expired');
      }

      await prisma.automationJob.update({
        where: { id: job.id },
        data: {
          status: 'GENERATING_VIDEO',
          errorMessage: null,
          scheduledFor: new Date(Date.now() + VIDEO_STATUS_POLL_DELAY_SECONDS * 1000)
        }
      });

      return { jobId: job.id, status: 'delayed', reason: 'Video still generating.' };
    } catch (error) {
      return failJob(job, `Video status check failed: ${getErrorMessage(error)}`);
    }
  }

  if (!job.title || !job.description || !job.tags?.length) {
    const metadata = generateMetadata(job.scriptText, job.niche);
    await prisma.automationJob.update({
      where: { id: job.id },
      data: {
        status: 'UPLOADING',
        errorMessage: null,
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        scheduledFor: null
      }
    });

    return { jobId: job.id, status: 'completed', reason: 'Metadata generated.' };
  }

  if (!job.youtubeVideoId) {
    if (!job.videoAssetUrl) {
      return failJob(job, 'Missing video asset URL before upload.');
    }
    let uploaded: { youtubeVideoId: string; publishedAt: Date };
    try {
      uploaded = await uploadToYouTube({
        title: job.title,
        description: job.description,
        tags: job.tags,
        videoUrl: job.videoAssetUrl,
        channelId: job.channelId,
        scheduledFor: job.scheduledFor,
        idempotencyKey: `job-${job.id}`
      });
    } catch (error) {
      return failJob(job, `YouTube upload failed: ${getErrorMessage(error)}`);
    }

    await prisma.automationJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        errorMessage: null,
        youtubeVideoId: uploaded.youtubeVideoId,
        publishedAt: uploaded.publishedAt
      }
    });

    return { jobId: job.id, status: 'completed', reason: 'Video uploaded.' };
  }

  return { jobId: job.id, status: 'completed', reason: 'No work required.' };
}

export async function processDueJobs(input: { maxJobs: number; timeBudgetMs: number }) {
  const maxJobs = Math.min(2, Math.max(1, input.maxJobs));
  const deadlineAtMs = Date.now() + input.timeBudgetMs;
  const results: ProcessOutcome[] = [];

  for (let i = 0; i < maxJobs; i += 1) {
    if (Date.now() >= deadlineAtMs) break;

    const claimedJob = await claimNextDueJob(new Date());
    if (!claimedJob) break;

    try {
      const result = await processClaimedJob(claimedJob, deadlineAtMs);
      results.push(result);
    } catch (error) {
      const reason = `Unexpected processing error: ${getErrorMessage(error)}`;
      logger.error({ err: error, jobId: claimedJob.id }, 'Job processing failed');
      const failed = await failJob(claimedJob, reason);
      results.push(failed);
    }
  }

  return {
    processedCount: results.length,
    results
  };
}
