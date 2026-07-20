import { Router, Request, Response } from 'express';
import { SITES } from '../constants/sites';

export const sitesRouter = Router();

/** GET /api/sites — 公开，返回所有运营站点 */
sitesRouter.get('/', (_req: Request, res: Response) => {
  res.json(SITES);
});
