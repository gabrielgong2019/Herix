import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'herix-dev-secret-change-in-production';

export interface AuthPayload {
  userId: string;
  role: string;       // 主角色（向后兼容）
  roles: string[];    // 全部角色数组，如 ['HERALD', 'BRAND']
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function signToken(payload: { userId: string; role: string; roles: string[] }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as any;
    // 兼容旧 token（无 roles 字段）
    if (!payload.roles) payload.roles = [payload.role];
    req.user = payload as AuthPayload;
    next();
  } catch {
    return res.status(401).json({ error: 'Token 无效或已过期' });
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const token = header.slice(7);
      const payload = jwt.verify(token, JWT_SECRET) as any;
      if (!payload.roles) payload.roles = [payload.role];
      req.user = payload as AuthPayload;
    } catch { /* 静默忽略 */ }
  }
  next();
}

/** 角色校验：用户拥有其中任一角色即通过 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: '未登录' });
    const userRoles = req.user.roles || [req.user.role];
    if (!roles.some(r => userRoles.includes(r))) {
      return res.status(403).json({ error: '无权限' });
    }
    next();
  };
}
