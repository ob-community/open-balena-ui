import type { JWTPayload } from 'jose';
import type { Request, RequestHandler } from 'express';
import { jwtVerify } from 'jose';

export interface AuthorizedLocals {
  auth: JWTPayload;
}

export const verifyAuthorization = async (
  req: Pick<Request, 'headers'>,
  secret: string | undefined,
): Promise<JWTPayload> => {
  if (!secret) {
    throw new Error('Invalid token');
  }

  const token = /^Bearer ([^\s]+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ['HS256'],
  });
  return payload;
};

const authorize: RequestHandler = async (req, res, next) => {
  try {
    res.locals.auth = await verifyAuthorization(req, process.env.OPEN_BALENA_JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

export default authorize;
