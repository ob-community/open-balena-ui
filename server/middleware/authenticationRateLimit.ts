import type { RequestHandler } from 'express';
import { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { JWTPayload } from 'jose';
import { verifyAuthorization } from './authorize';

interface AuthenticationLocals {
  auth?: JWTPayload;
  invalidAuthentication?: boolean;
}

export const createAuthenticationRateKey =
  (secret: () => string | undefined = () => process.env.OPEN_BALENA_JWT_SECRET): NonNullable<Options['keyGenerator']> =>
  async (req, res) => {
    const locals = res.locals as AuthenticationLocals;
    delete locals.auth;
    locals.invalidAuthentication = false;
    try {
      locals.auth = await verifyAuthorization(req, secret());
    } catch {
      // Missing credentials stay anonymous; supplied invalid credentials are rejected downstream.
      locals.invalidAuthentication = req.get('Authorization') !== undefined;
    }

    const auth = locals.auth;
    if (auth) {
      const id = auth.id ?? auth.sub;
      if (typeof id === 'string' || typeof id === 'number') return `authenticated:${id}`;
      return `authenticated-unidentified:${ipKeyGenerator(req.ip ?? 'unknown')}`;
    }
    return `unauthenticated:${ipKeyGenerator(req.ip ?? 'unknown')}`;
  };

export const authenticatedRequestSucceeded: NonNullable<Options['requestWasSuccessful']> = (_req, res) =>
  Boolean((res.locals as AuthenticationLocals).auth) && res.statusCode < 400;

export const rejectInvalidAuthentication: RequestHandler = (_req, res, next) => {
  if ((res.locals as AuthenticationLocals).invalidAuthentication) {
    res.status(401).json({ success: false, message: 'Invalid token' });
    return;
  }
  next();
};
