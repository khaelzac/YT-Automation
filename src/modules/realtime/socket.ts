import { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../../config/env';

export type JobUpdateEvent = {
  jobId: string;
  status: string;
  message?: string;
  updatedAt: string;
  analytics?: {
    viewCount: number;
    impressionRate: number;
  };
};

let io: Server | null = null;

export function setupSocket(server: HttpServer) {
  io = new Server(server, {
    cors: {
      origin: env.CLIENT_ORIGIN === '*' ? true : env.CLIENT_ORIGIN,
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    socket.on('jobs:subscribe', (userId?: string) => {
      if (userId) {
        socket.join(`user:${userId}`);
      }
    });

    socket.on('job:subscribe', (jobId: string) => {
      socket.join(`job:${jobId}`);
    });
  });
}

export function emitJobUpdate(userId: string, event: JobUpdateEvent) {
  if (!io) return;
  io.emit('job:update', event);
  io.to(`user:${userId}`).emit('job:update', event);
  io.to(`job:${event.jobId}`).emit('job:update', event);
}
