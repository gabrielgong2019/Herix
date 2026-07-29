import { Router } from 'express';
import { findOne } from '../utils/db';

export const shortLinksRouter = Router();

shortLinksRouter.get('/:code', async (req, res) => {
  const link = await findOne<{ task_id: string }>(
    'SELECT task_id FROM short_links WHERE code = ?', [req.params.code]
  );
  if (!link) return res.status(404).send('链接无效');
  res.redirect(301, `/app/#/pages/landing/index?task=${link.task_id}`);
});
