import { prisma } from '../../db/prisma';
import { createAutomationJob } from './automation.service';

function getZonedParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
  const parts = formatter.formatToParts(date);
  const values: Record<string, string> = {};
  parts.forEach((part) => {
    values[part.type] = part.value;
  });

  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };

  return {
    dayOfWeek: dayMap[values.weekday],
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

export async function runScheduleScan() {
  const users = await prisma.user.findMany({
    include: {
      settings: true,
      schedules: {
        where: { isActive: true }
      },
      channels: {
        where: { isActive: true }
      }
    }
  });

  let createdCount = 0;

  for (const user of users) {
    if (!user.settings?.autoEnabled || !user.settings.niche) continue;
    if (!user.channels.length || !user.schedules.length) continue;

    const now = new Date();
    const due = user.schedules.some((schedule) => {
      const zoned = getZonedParts(now, schedule.timezone);
      return (
        zoned.dayOfWeek === schedule.dayOfWeek &&
        zoned.hour === schedule.hour &&
        zoned.minute === schedule.minute
      );
    });

    if (!due) continue;

    const recentlyCreated = await prisma.automationJob.findFirst({
      where: {
        userId: user.id,
        createdAt: {
          gte: new Date(Date.now() - 50 * 60 * 1000)
        }
      }
    });

    if (!recentlyCreated) {
      await createAutomationJob(user.id, now);
      createdCount += 1;
    }
  }

  return { createdCount };
}

