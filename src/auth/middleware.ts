import { Request, Response, NextFunction } from 'express';
import { validateToken } from './auth';

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = validateToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Add userId to request object for downstream use
    (req as any).userId = payload.userId;
    next();
  } catch (error) {
    console.error(error);
    return res.status(401).json({ error: 'Unauthorized' });
  }
};