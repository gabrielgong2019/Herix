import { Router, Request, Response } from 'express';
import { COMMUNITIES, getCommunitiesBySite } from '../constants/communities';

export const communitiesRouter = Router();

/** GET /api/communities?site=jp — 公开，返回社群列表；传 site 则只返回该站点的社群 */
communitiesRouter.get('/', (req: Request, res: Response) => {
  const site = req.query.site as string | undefined;
  if (site) {
    res.json(getCommunitiesBySite(site));
  } else {
    res.json(COMMUNITIES);
  }
});
