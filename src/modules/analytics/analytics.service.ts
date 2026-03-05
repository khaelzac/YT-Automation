import { prisma } from '../../db/prisma';

export async function recordAnalytics(jobId: string, viewCount: number, impressionRate: number) {
  return prisma.analyticsSnapshot.create({
    data: {
      jobId,
      viewCount,
      impressionRate
    }
  });
}

export async function getLatestAnalytics(jobId: string) {
  return prisma.analyticsSnapshot.findFirst({
    where: { jobId },
    orderBy: { capturedAt: 'desc' }
  });
}
