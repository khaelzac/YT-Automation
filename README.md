# Server

Express + TypeScript orchestration service.

## Environment
- `DATABASE_URL`: Supabase pooled Postgres URL for runtime Prisma client usage.
- `DIRECT_URL`: Supabase direct Postgres URL for Prisma migrations.
- `CRON_SECRET`: Secret for securing `/api/process-job` requests.
- `CRON_MAX_JOBS_PER_RUN`: Max jobs to process per cron request (clamped to 1-2).
- `CRON_TIME_BUDGET_MS`: Per-invocation processing time budget.
- `SCRIPT_RETRY_MAX`: Max script generation retries (recommended: `5`).
- `SCRIPT_RETRY_BASE_DELAY_MS`: Base delay for exponential backoff.
- `RATE_LIMIT_DELAY_SECONDS`: Fallback delay for 429/rate-limit retries.
- `GROQ_REQUEST_TIMEOUT_MS`: Timeout for Groq script generation requests.
- `XAI_API_KEY`: xAI API key for Grok Imagine video generation.
- `XAI_VIDEO_MODEL`: xAI video model name (default: `grok-imagine-video`).
- `XAI_REQUEST_TIMEOUT_MS`: Timeout for xAI video API requests.

## Modules
- `auth`: Google OAuth bootstrap + mock callback for local setup
- `channels`: list/select connected channels
- `settings`: niche + schedule + preflight validation
- `automation`: job creation + cron-safe processor endpoint
- `script`: Groq-based script generation
- `video`: provider adapter for video generation
- `metadata`: title/description/tags creation
- `youtube`: upload/schedule adapter
- `analytics`: published video analytics snapshots
- `realtime`: Socket.IO status events

## Job states
`PENDING -> PROCESSING -> COMPLETED`

Errors are marked as `FAILED`. Groq 429/rate-limit errors are marked as `DELAYED` and retried by next cron run.

## Cron Endpoint
- `GET /api/process-job`
- `POST /api/process-job`

Behavior:
- Atomically claims up to 1-2 due jobs in DB.
- Processes each job once per invocation.
- Uses bounded retries for script generation (no infinite loops).
- Exits quickly after processing.
