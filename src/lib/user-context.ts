import { Request } from 'express';
import { prisma } from '../db/prisma';

const FALLBACK_EMAIL = 'owner@youtube-automation.local';

export async function resolveUser(req: Request) {
  const id = req.header('x-user-id');
  if (id) {
    const found = await prisma.user.findUnique({ where: { id } });
    if (found) return found;
  }

  const email = req.header('x-user-email') || FALLBACK_EMAIL;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;

  return prisma.user.create({
    data: {
      email,
      name: 'Automation Owner',
      timezone: 'UTC'
    }
  });
}
