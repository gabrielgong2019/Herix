import { Router, Request, Response } from 'express';
import { COMMUNITIES } from '../constants/communities';

export const communitiesRouter = Router();

/** GET /api/communities — 公开，返回社群列表 */
communitiesRouter.get('/', (_req: Request, res: Response) => {
  res.json(COMMUNITIES);
});
