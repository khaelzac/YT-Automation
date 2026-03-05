import { Express } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http';
import { resolveUser } from '../../lib/user-context';
import { prisma } from '../../db/prisma';
import { getOrCreateSettings, getPreflight } from './settings.service';

const scheduleSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  timezone: z.string().min(1),
  isActive: z.boolean().default(true)
});

const updateSchema = z.object({
  niche: z.string().min(2),
  autoEnabled: z.boolean().default(true),
  schedules: z.array(scheduleSchema).min(1)
});

export function registerSettingsRoutes(app: Express) {
  app.get(
    '/api/settings',
    asyncHandler(async (req, res) => {
      const user = await resolveUser(req);
      const [settings, schedules, preflight] = await Promise.all([
        getOrCreateSettings(user.id),
        prisma.uploadSchedule.findMany({ where: { userId: user.id }, orderBy: { dayOfWeek: 'asc' } }),
        getPreflight(user.id)
      ]);

      res.json({ settings, schedules, preflight });
    })
  );

  app.put(
    '/api/settings',
    asyncHandler(async (req, res) => {
      const user = await resolveUser(req);
      const payload = updateSchema.parse(req.body);

      await prisma.$transaction([
        prisma.userSettings.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            niche: payload.niche,
            autoEnabled: payload.autoEnabled
          },
          update: {
            niche: payload.niche,
            autoEnabled: payload.autoEnabled
          }
        }),
        prisma.uploadSchedule.deleteMany({ where: { userId: user.id } }),
        prisma.uploadSchedule.createMany({
          data: payload.schedules.map((entry) => ({
            userId: user.id,
            dayOfWeek: entry.dayOfWeek,
            hour: entry.hour,
            minute: entry.minute,
            timezone: entry.timezone,
            isActive: entry.isActive
          }))
        })
      ]);

      const preflight = await getPreflight(user.id);
      res.json({ ok: true, preflight });
    })
  );
}
