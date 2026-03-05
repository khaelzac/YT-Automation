import { Express } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../../lib/http';
import { resolveUser } from '../../lib/user-context';
import { prisma } from '../../db/prisma';

const selectSchema = z.object({ channelId: z.string().min(1) });

export function registerChannelsRoutes(app: Express) {
  app.get(
    '/api/channels',
    asyncHandler(async (req, res) => {
      const user = await resolveUser(req);
      const channels = await prisma.youTubeChannel.findMany({ where: { userId: user.id } });
      res.json({ channels });
    })
  );

  app.post(
    '/api/channels/select',
    asyncHandler(async (req, res) => {
      const user = await resolveUser(req);
      const { channelId } = selectSchema.parse(req.body);

      const channel = await prisma.youTubeChannel.findFirst({
        where: { id: channelId, userId: user.id }
      });
      if (!channel) throw new HttpError(404, 'Channel not found');

      await prisma.$transaction([
        prisma.youTubeChannel.updateMany({ where: { userId: user.id }, data: { isActive: false } }),
        prisma.youTubeChannel.update({ where: { id: channel.id }, data: { isActive: true } })
      ]);

      res.json({ ok: true });
    })
  );
}
