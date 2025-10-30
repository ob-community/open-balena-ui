import type { RequestHandler } from 'express';
import { jwtVerify } from 'jose';

const authorize: RequestHandler = async (req, res, next) => {
  try {
    const authorizationHeader = req.headers.authorization;
    const secret = process.env.OPEN_BALENA_JWT_SECRET;

    if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ') || !secret) {
      res.status(401).json({ success: false, message: 'Invalid token' });
      return;
    }

    const token = authorizationHeader.split('Bearer ')[1];
    await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
    });
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

export default authorize;
