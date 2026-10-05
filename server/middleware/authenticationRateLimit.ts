import type { RequestHandler } from 'express';
import { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { JWTPayload } from 'jose';
import { verifyAuthorization } from './authorize';

interface AuthenticationLocals {
  auth?: JWTPayload;
  invalidAuthentication?: boolean;
}

export const inspectAuthentication =
  (secret: () => string | undefined = () => process.env.OPEN_BALENA_JWT_SECRET): RequestHandler =>
  async (req, res, next) => {
    const locals = res.locals as AuthenticationLocals;
    delete locals.auth;
    locals.invalidAuthentication = false;
    if (req.get('Authorization') !== undefined) {
      try {
        locals.auth = await verifyAuthorization(req, secret());
      } catch {
        locals.invalidAuthentication = true;
      }
    }
    next();
  };

export const authenticationRateKey: NonNullable<Options['keyGenerator']> = (req, res) => {
  const auth = (res.locals as AuthenticationLocals).auth;
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
