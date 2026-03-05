import { Express } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../../lib/http';
import { resolveUser } from '../../lib/user-context';
import { encryptText } from '../../lib/crypto';
import { prisma } from '../../db/prisma';
import { env } from '../../config/env';

const callbackSchema = z.object({
  channelId: z.string().min(3),
  title: z.string().min(2),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1)
});

export function registerAuthRoutes(app: Express) {
  app.get(
    '/api/auth/google/start',
    asyncHandler(async (_req, res) => {
      if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_REDIRECT_URI) {
        throw new HttpError(400, 'Google OAuth is not configured');
      }

      const scope = encodeURIComponent('openid email https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/yt-analytics.readonly');
      const redirect = encodeURIComponent(env.YOUTUBE_REDIRECT_URI);
      const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${env.YOUTUBE_CLIENT_ID}&redirect_uri=${redirect}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;
      res.json({ url });
    })
  );

  app.post(
    '/api/auth/google/callback/mock',
    asyncHandler(async (req, res) => {
      const user = await resolveUser(req);
      const body = callbackSchema.parse(req.body);

      await prisma.youTubeChannel.updateMany({
        where: { userId: user.id, isActive: true },
        data: { isActive: false }
      });

      const channel = await prisma.youTubeChannel.upsert({
        where: {
          userId_googleChannelId: {
            userId: user.id,
            googleChannelId: body.channelId
          }
        },
        create: {
          userId: user.id,
          googleChannelId: body.channelId,
          channelTitle: body.title,
          accessTokenEnc: encryptText(body.accessToken),
          refreshTokenEnc: encryptText(body.refreshToken),
          isActive: true
        },
        update: {
          channelTitle: body.title,
          accessTokenEnc: encryptText(body.accessToken),
          refreshTokenEnc: encryptText(body.refreshToken),
          isActive: true
        }
      });

      res.json({ channel });
    })
  );
}
