import { Router, Request, Response } from 'express';
import db from '../db';
import { findOne, findMany, insert, update, remove, genId } from '../utils/db';
import { requireAuth } from '../middleware/auth';

export const walletRouter = Router();

// 所有钱包接口都需要登录
walletRouter.use(requireAuth);

/** GET /api/wallet/balance */
walletRouter.get('/balance', (req: Request, res: Response) => {
  const userId = req.user!.userId;

  // 累计收入：ESCROW_RELEASE + 推广结算
  const income = findOne<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE user_id = ? AND type IN ('ESCROW_RELEASE') AND status = 'COMPLETED'`,
    [userId]
  );

  // 已提现
  const withdrawn = findOne<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE user_id = ? AND type = 'WITHDRAWAL' AND status = 'COMPLETED'`,
    [userId]
  );

  // 待结算：PENDING 状态的收入 + 推广码收益
  const pending = findOne<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE user_id = ? AND type IN ('ESCROW_RELEASE') AND status = 'PENDING'`,
    [userId]
  );

  const totalIncome = income?.total || 0;
  const totalWithdrawn = withdrawn?.total || 0;
  const pendingAmount = pending?.total || 0;

  // 推广码累计收益（从 referrals 表统计 qualified 数量）
  const codeEarnings = findOne<{ total: number }>(
    `SELECT COALESCE(SUM(r.qualified * t.commission), 0) as total
     FROM ambassador_tasks at
     JOIN tasks t ON t.id = at.task_id
     JOIN referrals r ON r.ambassador_task_id = at.id
     WHERE at.herald_id = ? AND r.qualified = 1`,
    [userId]
  );

  // 当月收入（本月1号至今）
  const monthlyIncome = findOne<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE user_id = ? AND type IN ('ESCROW_RELEASE') AND status = 'COMPLETED'
     AND created_at >= date('now', 'start of month')`,
    [userId]
  );

  const available = totalIncome + (codeEarnings?.total || 0) - totalWithdrawn;
  const totalEarned = totalIncome + (codeEarnings?.total || 0);

  res.json({
    totalIncome: totalEarned,
    monthlyIncome: monthlyIncome?.total || 0,
    totalWithdrawn,
    pendingAmount,
    available,
    codeEarnings: codeEarnings?.total || 0,
  });
});

/** GET /api/wallet/transactions */
walletRouter.get('/transactions', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { type, page = '1', limit = '20' } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  let where = 't.user_id = ?';
  const params: any[] = [userId];

  if (type && type !== 'all') {
    where += ' AND t.type = ?';
    params.push(type);
  }

  const rows = findMany(
    `SELECT t.id, t.type, t.amount, t.platform_fee, t.status, t.note, t.created_at, t.completed_at,
            tk.title as task_title
     FROM transactions t
     LEFT JOIN tasks tk ON tk.id = t.task_id
     WHERE ${where}
     ORDER BY t.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, Number(limit), skip]
  );

  const count = findOne<{ total: number }>(
    `SELECT COUNT(*) as total FROM transactions t WHERE ${where}`,
    params
  );

  res.json({
    transactions: rows,
    total: count?.total || 0,
    page: Number(page),
    limit: Number(limit),
  });
});

/** GET /api/wallet/methods */
walletRouter.get('/methods', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const methods = findMany(
    'SELECT * FROM withdrawal_methods WHERE user_id = ? ORDER BY is_default DESC, created_at DESC',
    [userId]
  );

  // 解析 account_details JSON
  const parsed = methods.map((m: any) => ({
    ...m,
    account_details: typeof m.account_details === 'string'
      ? JSON.parse(m.account_details) : m.account_details,
  }));

  res.json(parsed);
});

/** POST /api/wallet/methods */
walletRouter.post('/methods', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { type, country, label, account_details, is_default } = req.body;

  if (!type || !['BANK', 'PAYPAL', 'WECHAT', 'ALIPAY', 'CASH'].includes(type)) {
    return res.status(400).json({ error: '请选择有效的收款方式类型' });
  }
  if (!label) {
    return res.status(400).json({ error: '请填写标签' });
  }

  // 如果设为默认，先取消其他默认
  if (is_default) {
    db.prepare('UPDATE withdrawal_methods SET is_default = 0 WHERE user_id = ?').run(userId);
  }

  const id = insert('withdrawal_methods', {
    user_id: userId,
    type,
    country: country || '',
    label,
    account_details: JSON.stringify(account_details || {}),
    is_default: is_default ? 1 : 0,
  });

  res.json({ id, message: '收款方式已添加' });
});

/** PUT /api/wallet/methods/:id */
walletRouter.put('/methods/:id', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const methodId = req.params.id;
  const { type, country, label, account_details, is_default } = req.body;

  const method = findOne<any>(
    'SELECT * FROM withdrawal_methods WHERE id = ? AND user_id = ?',
    [methodId, userId]
  );
  if (!method) return res.status(404).json({ error: '收款方式不存在' });

  if (is_default) {
    db.prepare('UPDATE withdrawal_methods SET is_default = 0 WHERE user_id = ?').run(userId);
  }

  const data: any = { updated_at: new Date().toISOString() };
  if (type) data.type = type;
  if (country !== undefined) data.country = country;
  if (label) data.label = label;
  if (account_details) data.account_details = JSON.stringify(account_details);
  if (is_default !== undefined) data.is_default = is_default ? 1 : 0;

  update('withdrawal_methods', data, 'id = ? AND user_id = ?', [methodId, userId]);

  res.json({ message: '收款方式已更新' });
});

/** DELETE /api/wallet/methods/:id */
walletRouter.delete('/methods/:id', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const methodId = req.params.id;

  const method = findOne<any>(
    'SELECT * FROM withdrawal_methods WHERE id = ? AND user_id = ?',
    [methodId, userId]
  );
  if (!method) return res.status(404).json({ error: '收款方式不存在' });

  remove('withdrawal_methods', 'id = ? AND user_id = ?', [methodId, userId]);
  res.json({ message: '收款方式已删除' });
});

/** POST /api/wallet/withdraw */
walletRouter.post('/withdraw', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { method_id, amount } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: '请输入有效金额' });
  }
  if (!method_id) {
    return res.status(400).json({ error: '请选择收款方式' });
  }

  // 验证收款方式
  const method = findOne<any>(
    'SELECT * FROM withdrawal_methods WHERE id = ? AND user_id = ?',
    [method_id, userId]
  );
  if (!method) return res.status(400).json({ error: '收款方式不存在' });

  // 计算可用余额（同上）
  const income = findOne<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE user_id = ? AND type = 'ESCROW_RELEASE' AND status = 'COMPLETED'`,
    [userId]
  );
  const withdrawn = findOne<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
     WHERE user_id = ? AND type = 'WITHDRAWAL' AND (status = 'COMPLETED' OR status = 'PENDING')`,
    [userId]
  );
  const codeEarnings = findOne<{ total: number }>(
    `SELECT COALESCE(SUM(r.qualified * t.commission), 0) as total
     FROM ambassador_tasks at
     JOIN tasks t ON t.id = at.task_id
     JOIN referrals r ON r.ambassador_task_id = at.id
     WHERE at.herald_id = ? AND r.qualified = 1`,
    [userId]
  );

  const available = (income?.total || 0) + (codeEarnings?.total || 0) - (withdrawn?.total || 0);

  if (amount > available) {
    return res.status(400).json({ error: `余额不足，可用 ¥${available.toLocaleString()}` });
  }

  // 计算手续费（5%）
  const fee = Math.round(amount * 0.05 * 100) / 100;
  const netAmount = amount - fee;

  // 创建提现交易
  const txId = insert('transactions', {
    user_id: userId,
    withdrawal_method_id: method_id,
    type: 'WITHDRAWAL',
    amount: -netAmount, // 负数表示支出
    platform_fee: fee,
    status: 'PENDING',
    note: `提现至 ${method.type} - ${method.label}`,
  });

  res.json({
    id: txId,
    amount,
    fee,
    netAmount,
    method: { type: method.type, label: method.label },
    message: '提现申请已提交，审核通过后到账',
  });
});
