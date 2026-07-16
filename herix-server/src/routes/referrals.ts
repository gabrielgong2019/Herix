import { Router, Request, Response } from 'express';
import { findOne, findMany, insert, update } from '../utils/db';
import { requireAuth, requireRole } from '../middleware/auth';
import crypto from 'crypto';

export const referralsRouter = Router();

/** 生成唯一推广码 */
function genCode(taskId: string, heraldId: string): string {
  const hash = crypto.createHash('md5').update(taskId + heraldId + Date.now()).digest('hex').substring(0, 8);
  return 'HERIX-' + hash.toUpperCase();
}

/** POST /api/referrals/assign/:taskId — 赫使领取推广码任务（类型A专属） */
referralsRouter.post('/assign/:taskId', requireAuth, requireRole('HERALD'), async (req: Request, res: Response) => {
  const task = await findOne<{ id: string; mode: string }>(
    "SELECT id, mode FROM tasks WHERE id = ? AND mode = 'PERFORMANCE' AND status = 'OPEN'",
    [req.params.taskId]
  );
  if (!task) return res.status(404).json({ error: '任务不存在或不支持推广码模式' });

  // 检查居住地合规
  const profile = await findOne<any>(
    'SELECT residence, kyc_status, declaration_status FROM herald_profiles WHERE user_id = ?',
    [req.user!.userId]
  );
  if (!profile?.residence) return res.status(403).json({ error: '请先设置居住地', code: 'RESIDENCE_REQUIRED' });
  if (profile.kyc_status !== 'approved') return res.status(403).json({ error: '请先完成 KYC', code: 'KYC_REQUIRED' });

  // 检查是否已领取
  const existing = await findOne<{ id: string }>(
    'SELECT id FROM ambassador_tasks WHERE task_id = ? AND herald_id = ?',
    [req.params.taskId, req.user!.userId]
  );
  if (existing) {
    return res.status(409).json({ error: '已领取过该任务' });
  }

  // 检查名额
  const taskCount = await findOne<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM ambassador_tasks WHERE task_id = ? AND status = 'active'",
    [req.params.taskId]
  );
  const taskInfo = await findOne<{ max_heralds: number }>(
    'SELECT max_heralds FROM tasks WHERE id = ?', [req.params.taskId]
  );
  if (taskInfo && taskCount && taskCount.cnt >= taskInfo.max_heralds) {
    return res.status(403).json({ error: '名额已满' });
  }

  const code = genCode(req.params.taskId as string, req.user!.userId);
  const id = await insert('ambassador_tasks', {
    task_id: req.params.taskId,
    herald_id: req.user!.userId,
    unique_code: code,
  });

  const result = await findOne('SELECT * FROM ambassador_tasks WHERE id = ?', [id]);
  res.status(201).json(result);
});

/** GET /api/referrals/my-codes — 我的推广码列表 */
referralsRouter.get('/my-codes', requireAuth, requireRole('HERALD'), async (req: Request, res: Response) => {
  // 计数直读 ambassador_tasks 聚合列（CSV 上传的唯一写入点）；收入按 task_transactions 实际入账。
  // 旧版从 referrals 明细表统计——那张表 CSV 上传从不写，赫使端永远显示 0（2026-07-17 修复）
  const codes = await findMany<any>(
    `SELECT at.id, at.task_id, at.unique_code, at.status, at.joined_at,
            t.title as task_title, t.payout_per_herald, t.mode,
            at.registered_count, at.used_count, at.paid_conversions,
            COALESCE((SELECT SUM(tt.amount) FROM task_transactions tt
              WHERE tt.task_id = at.task_id AND tt.to_user_id = at.herald_id
                AND tt.type = 'TASK_RELEASE' AND tt.status = 'completed'), 0) as earned_amount
     FROM ambassador_tasks at
     JOIN tasks t ON t.id = at.task_id
     WHERE at.herald_id = ?
     ORDER BY at.joined_at DESC`, [req.user!.userId]
  );
  res.json(codes);
});

// legacy POST /csv-import 端点已删除（2026-07-17）：写 referrals 明细表的老路径，无任何调用方，
// 真实数据回传统一走 POST /api/tasks/:id/csv（写 ambassador_tasks 聚合列 + 钱包结算）


/** GET /api/referrals/stats/:taskId — 推广数据统计（品牌方） */
referralsRouter.get('/stats/:taskId', requireAuth, requireRole('BRAND', 'ADMIN'), async (req: Request, res: Response) => {
  // 同 my-codes：直读 ambassador_tasks 聚合列，不再从 referrals 死表统计（2026-07-17）
  const stats = await findMany<any>(
    `SELECT at.unique_code, u.nickname as herald_name,
            at.registered_count as total_referred,
            at.used_count as qualified_count
     FROM ambassador_tasks at
     JOIN users u ON u.id = at.herald_id
     WHERE at.task_id = ?
     ORDER BY qualified_count DESC`, [req.params.taskId]
  );
  res.json(stats);
});
