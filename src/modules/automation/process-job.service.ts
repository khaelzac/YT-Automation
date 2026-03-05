import { AutomationJob, JobStatus } from '@prisma/client';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { prisma } from '../../db/prisma';
import { generateMetadata } from '../metadata/metadata.service';
import { emitJobUpdate } from '../realtime/socket';
import { generateScript, validateGeneratedScript } from '../script/script.service';
import { uploadToYouTube } from '../youtube/youtube.service';
import { generateVideoFromScript } from '../video/video.service';

const CLAIMABLE_STATUSES: JobStatus[] = ['PENDING', 'DELAYED'];

type ProcessOutcome = {
  jobId: string;
  status: 'completed' | 'failed' | 'delayed' | 'skipped';
  reason?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  const claimed = await prisma.automationJob.updateMany({
    where: {
      id: candidate.id,
      status: { in: CLAIMABLE_STATUSES }
    },
    data: {
      status: 'PROCESSING',
      errorMessage: null
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

  emitJobUpdate(job.userId, {
    jobId: job.id,
    status: 'FAILED',
    message: reason,
    updatedAt: new Date().toISOString()
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

  emitJobUpdate(job.userId, {
    jobId: job.id,
    status: 'DELAYED',
    message: reason,
    updatedAt: new Date().toISOString()
  });

  return { jobId: job.id, status: 'delayed', reason };
}

async function generateScriptWithRetries(
  job: AutomationJob,
  previousTitles: string[],
  deadlineAtMs: number
): Promise<{ script: string } | { delayed: true; reason: string; delaySeconds: number } | { failed: true; reason: string }> {
  let lastReason = 'Script generation failed.';

  for (let attempt = 1; attempt <= env.SCRIPT_RETRY_MAX; attempt += 1) {
    if (Date.now() >= deadlineAtMs) {
      return { failed: true, reason: 'Time budget exceeded before script generation completed.' };
    }

    try {
      const script = await generateScript(job.niche, previousTitles);
      const validation = validateGeneratedScript(script, previousTitles);

      if (validation.valid) {
        return { script };
      }

      lastReason = `Generated script failed validation: ${validation.issues.join(' | ')}`;
    } catch (error) {
      const reason = getErrorMessage(error);
      if (isRateLimitError(error)) {
        return {
          delayed: true,
          reason,
          delaySeconds: parseRateLimitDelaySeconds(reason)
        };
      }

      lastReason = reason;
    }

    if (attempt >= env.SCRIPT_RETRY_MAX) break;

    const backoffMs = env.SCRIPT_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
    if (Date.now() + backoffMs >= deadlineAtMs) {
      return {
        failed: true,
        reason: `${lastReason} Not enough execution time left for another retry.`
      };
    }

    await sleep(backoffMs);
  }

  return { failed: true, reason: lastReason };
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

  const scriptResult = await generateScriptWithRetries(job, previousTitles, deadlineAtMs);
  if ('delayed' in scriptResult) {
    return delayJob(job, scriptResult.reason, scriptResult.delaySeconds);
  }

  if ('failed' in scriptResult) {
    return failJob(job, scriptResult.reason);
  }

  const script = scriptResult.script;
  await prisma.automationJob.update({
    where: { id: job.id },
    data: {
      scriptText: script
    }
  });

  let videoAssetUrl = '';
  try {
    videoAssetUrl = await generateVideoFromScript(script, job.niche);
  } catch (error) {
    return failJob(job, `Video generation failed: ${getErrorMessage(error)}`);
  }

  const metadata = generateMetadata(script, job.niche);

  let uploaded: { youtubeVideoId: string; publishedAt: Date };
  try {
    uploaded = await uploadToYouTube({
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags,
      videoUrl: videoAssetUrl,
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
      scriptText: script,
      videoAssetUrl,
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags,
      youtubeVideoId: uploaded.youtubeVideoId,
      publishedAt: uploaded.publishedAt
    }
  });

  emitJobUpdate(job.userId, {
    jobId: job.id,
    status: 'COMPLETED',
    updatedAt: new Date().toISOString()
  });

  return { jobId: job.id, status: 'completed' };
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
