import pino from 'pino';
import { env } from './env';

const isServerlessRuntime =
  process.env.VERCEL === '1' ||
  Boolean(process.env.VERCEL_ENV) ||
  Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
const usePrettyTransport = env.NODE_ENV !== 'production' && !isServerlessRuntime;

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: usePrettyTransport
    ? {
        target: 'pino-pretty',
        options: {
          translateTime: 'SYS:standard'
        }
      }
    : undefined
});
