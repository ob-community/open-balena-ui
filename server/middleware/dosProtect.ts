import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';

const rateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 100,
  skipSuccessfulRequests: true,
});

const speedLimiter = slowDown({
  windowMs: 5 * 60 * 1000,
  delayAfter: 25,
  delayMs: (hits: number) => (hits - 25) * 100,
  skipSuccessfulRequests: true,
});

const dosProtect: RequestHandler[] = [rateLimiter, speedLimiter];

export default dosProtect;
