import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger';
import { HttpError } from '../lib/http';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.statusCode).json({ message: err.message, details: err.details ?? null });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({ message: 'Validation failed', details: err.issues });
  }

  logger.error({ err }, 'Unhandled server error');
  return res.status(500).json({ message: 'Internal server error' });
}
