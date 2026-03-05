import { config } from 'dotenv';
import { z } from 'zod';

config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  CLIENT_ORIGIN: z.string().default('*'),
  CRON_SECRET: z.string().default(''),
  CRON_MAX_JOBS_PER_RUN: z.coerce.number().int().positive().default(1),
  CRON_TIME_BUDGET_MS: z.coerce.number().int().positive().default(45000),
  SCRIPT_RETRY_MAX: z.coerce.number().int().positive().default(5),
  SCRIPT_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(800),
  RATE_LIMIT_DELAY_SECONDS: z.coerce.number().int().positive().default(120),
  GROQ_API_KEY: z.string().default(''),
  GROQ_MODEL: z.string().default('llama-3.1-8b-instant'),
  GROQ_MAX_TOKENS: z.coerce.number().int().positive().default(2600),
  VIDEO_PROVIDER_API_KEY: z.string().default(''),
  YOUTUBE_CLIENT_ID: z.string().default(''),
  YOUTUBE_CLIENT_SECRET: z.string().default(''),
  YOUTUBE_REDIRECT_URI: z.string().default(''),
  TOKEN_ENCRYPTION_KEY: z.string().default('')
});

export const env = envSchema.parse(process.env);
