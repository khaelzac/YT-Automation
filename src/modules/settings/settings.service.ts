import { prisma } from '../../db/prisma';

export type PreflightResult = {
  ready: boolean;
  channelConnected: boolean;
  nicheSelected: boolean;
  scheduleValid: boolean;
};

export async function getPreflight(userId: string): Promise<PreflightResult> {
  const [activeChannel, settings, activeSchedules] = await Promise.all([
    prisma.youTubeChannel.findFirst({ where: { userId, isActive: true } }),
    prisma.userSettings.findUnique({ where: { userId } }),
    prisma.uploadSchedule.count({ where: { userId, isActive: true } })
  ]);

  const channelConnected = Boolean(activeChannel);
  const nicheSelected = Boolean(settings?.niche);
  const scheduleValid = activeSchedules > 0;

  return {
    ready: channelConnected && nicheSelected && scheduleValid,
    channelConnected,
    nicheSelected,
    scheduleValid
  };
}

export async function getOrCreateSettings(userId: string) {
  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  if (settings) return settings;
  return prisma.userSettings.create({ data: { userId } });
}
