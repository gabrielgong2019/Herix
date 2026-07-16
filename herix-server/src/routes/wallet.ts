import { Router, Request, Response } from 'express';
import db from '../db';
import { findOne, findMany, insert, update, remove, genId } from '../utils/db';
import { requireAuth } from '../middleware/auth';
import { getBalance, freezeWithdrawal, ENTRY_DIRECTION, ENTRY_TYPE_LABELS, WalletType } from '../utils/wallet';
import { calcWithdrawalFee, getSetting, getBrandCreditInfo } from '../utils/settings';

export const walletRouter = Router();

walletRouter.use(requireAuth);

/** 解析期间过滤参数，默认本月初至今 */
function getPeriodRange(query: any): { from: string; to: string } {
  const now = new Date();
  const from = query.from ? new Date(String(query.from)) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to   = query.to  ? new Date(String(query.to))   : now;
  return { from: from.toISOString(), to: to.toISOString() };
}

/** GET /api/wallet/balance — 赫使余额 + 本期流入流出 */
walletRouter.get('/balance', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const bal = await getBalance(userId, 'herald');
  const { from, to } = getPeriodRange(req.query);

  const flow = await db.query(
    `SELECT we.type, we.amount FROM wallet_entries we
     JOIN wallets w ON w.id = we.wallet_id
     WHERE w.user_id = $1 AND w.wallet_type = 'herald' AND we.created_at >= $2 AND we.created_at <= $3`,
    [userId, from, to]
  );

  let periodInflow = 0, periodOutflow = 0;
  for (const row of flow.rows) {
    const dir = ENTRY_DIRECTION[row.type as keyof typeof ENTRY_DIRECTION];
    if (dir === 'transfer') continue;
    const amt = Number(row.amount);
    if (dir === 'in' || (dir === 'adjustment' && amt >= 0)) periodInflow += Math.abs(amt);
    else periodOutflow += Math.abs(amt);
  }

  res.json({
    available: bal.available,
    frozen: bal.frozen,
    pendingAmount: bal.frozen,
    periodFrom: from,
    periodTo: to,
    periodInflow,
    periodOutflow,
  });
});

/** GET /api/wallet/transactions — 钱包流水（分页 + 期间过滤） */
walletRouter.get('/transactions', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { type, page = '1', limit = '20', walletType = 'herald' } = req.query;
  const wt = (walletType as WalletType) || 'herald';
  const skip = (Number(page) - 1) * Number(limit);
  const { from, to } = getPeriodRange(req.query);

  const typeFilter = type && type !== 'all';
  const baseParams: any[] = [userId, wt, from, to];
  let where = 'w.user_id = ? AND w.wallet_type = ? AND we.created_at >= ? AND we.created_at <= ?';
  if (typeFilter) { where += ' AND we.type = ?'; baseParams.push(type); }

  const rows = await findMany<any>(
    `SELECT we.id, we.type, we.amount, we.currency, we.available_after, we.frozen_after,
            we.note, we.created_at, we.reference_type, we.reference_id, we.source_entity, we.tax_withheld
     FROM wallet_entries we
     JOIN wallets w ON w.id = we.wallet_id
     WHERE ${where}
     ORDER BY we.created_at DESC
     LIMIT ? OFFSET ?`,
    [...baseParams, Number(limit), skip]
  );

  const count = await findOne<{ total: number }>(
    `SELECT COUNT(*) as total FROM wallet_entries we
     JOIN wallets w ON w.id = we.wallet_id
     WHERE ${where}`,
    baseParams
  );

  res.json({
    transactions: rows.map((r: any) => {
      const dir = ENTRY_DIRECTION[r.type as keyof typeof ENTRY_DIRECTION];
      return {
        ...r,
        label: ENTRY_TYPE_LABELS[r.type as keyof typeof ENTRY_TYPE_LABELS] || r.type,
        direction: dir === 'adjustment' ? (Number(r.amount) >= 0 ? 'in' : 'out') : dir,
      };
    }),
    total: count?.total || 0,
    page: Number(page),
    limit: Number(limit),
    periodFrom: from,
    periodTo: to,
  });
});

/** GET /api/wallet/methods */
walletRouter.get('/methods', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const methods = await findMany(
    'SELECT * FROM withdrawal_methods WHERE user_id = ? ORDER BY is_default DESC, created_at DESC',
    [userId]
  );
  const parsed = methods.map((m: any) => ({
    ...m,
    account_details: typeof m.account_details === 'string'
      ? JSON.parse(m.account_details) : m.account_details,
  }));
  res.json(parsed);
});

/** POST /api/wallet/methods */
walletRouter.post('/methods', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { type, country, label, account_details, is_default } = req.body;

  if (!type || !['BANK', 'PAYPAL', 'WECHAT', 'ALIPAY', 'CASH'].includes(type)) {
    return res.status(400).json({ error: '请选择有效的收款方式类型' });
  }
  if (!label) return res.status(400).json({ error: '请填写标签' });

  if (is_default) {
    await db.query('UPDATE withdrawal_methods SET is_default = 0 WHERE user_id = $1', [userId]);
  }

  const id = await insert('withdrawal_methods', {
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
walletRouter.put('/methods/:id', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const methodId = req.params.id;
  const { type, country, label, account_details, is_default } = req.body;

  const method = await findOne<any>(
    'SELECT * FROM withdrawal_methods WHERE id = ? AND user_id = ?',
    [methodId, userId]
  );
  if (!method) return res.status(404).json({ error: '收款方式不存在' });

  if (is_default) {
    await db.query('UPDATE withdrawal_methods SET is_default = 0 WHERE user_id = $1', [userId]);
  }

  const data: any = { updated_at: new Date().toISOString() };
  if (type) data.type = type;
  if (country !== undefined) data.country = country;
  if (label) data.label = label;
  if (account_details) data.account_details = JSON.stringify(account_details);
  if (is_default !== undefined) data.is_default = is_default ? 1 : 0;

  await update('withdrawal_methods', data, 'id = ? AND user_id = ?', [methodId, userId]);
  res.json({ message: '收款方式已更新' });
});

/** DELETE /api/wallet/methods/:id */
walletRouter.delete('/methods/:id', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const methodId = req.params.id;

  const method = await findOne<any>(
    'SELECT * FROM withdrawal_methods WHERE id = ? AND user_id = ?',
    [methodId, userId]
  );
  if (!method) return res.status(404).json({ error: '收款方式不存在' });

  await remove('withdrawal_methods', 'id = ? AND user_id = ?', [methodId, userId]);
  res.json({ message: '收款方式已删除' });
});

/** GET /api/wallet/brand-balance — 品牌余额 + 信用额度状态 */
walletRouter.get('/brand-balance', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { from, to } = getPeriodRange(req.query);

  const [creditInfo, bal, flow] = await Promise.all([
    getBrandCreditInfo(userId),
    getBalance(userId, 'brand'),
    db.query(
      `SELECT we.type, we.amount FROM wallet_entries we
       JOIN wallets w ON w.id = we.wallet_id
       WHERE w.user_id = $1 AND w.wallet_type = 'brand' AND we.created_at >= $2 AND we.created_at <= $3`,
      [userId, from, to]
    ),
  ]);

  let periodInflow = 0, periodOutflow = 0;
  for (const row of flow.rows) {
    const dir = ENTRY_DIRECTION[row.type as keyof typeof ENTRY_DIRECTION];
    if (dir === 'transfer') continue;
    const amt = Number(row.amount);
    if (dir === 'in' || (dir === 'adjustment' && amt >= 0)) periodInflow += Math.abs(amt);
    else periodOutflow += Math.abs(amt);
  }

  const fpThreshold       = Number(await getSetting('fast_payout_threshold')) || 100000;
  const fastPayoutEligible = bal.available >= fpThreshold;

  res.json({
    currency: 'JPY',
    available:  bal.available,
    frozen:     bal.frozen,
    periodFrom: from,
    periodTo:   to,
    periodInflow,
    periodOutflow,
    credit: {
      hasToppedUp:      creditInfo.hasToppedUp,
      initialCredit:    creditInfo.initialCredit,
      creditUsed:       creditInfo.creditUsed,
      creditRemaining:  creditInfo.creditRemaining,
      totalCapacity:    creditInfo.totalCapacity,
      fastPayoutEligible,
      fastPayoutThreshold: fpThreshold,
    },
  });
});

/** POST /api/wallet/topup — 品牌提交充值申请 */
walletRouter.post('/topup', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { amount, note } = req.body;

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: '请输入有效金额' });
  }

  const id = await insert('topup_requests', {
    brand_id: userId,
    amount: Number(amount),
    currency: 'JPY',
    note: note || null,
    status: 'pending',
  });

  res.status(201).json({ id, amount, currency: 'JPY', message: '充值申请已提交，运营确认到账后余额增加' });
});

/** GET /api/wallet/topup-history — 品牌充值记录 */
walletRouter.get('/topup-history', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const rows = await findMany(
    `SELECT * FROM topup_requests WHERE brand_id = ? ORDER BY created_at DESC LIMIT 20`,
    [userId]
  );
  res.json(rows);
});

/** GET /api/wallet/withdrawal-info — 提现前费用预览（赫使） */
walletRouter.get('/withdrawal-info', async (req: Request, res: Response) => {
  const { amount } = req.query;
  const requestAmount = Number(amount);
  if (!requestAmount || requestAmount <= 0) {
    return res.status(400).json({ error: '请传入有效的提现金额' });
  }
  try {
    const { fee, netAmount, payoutDate } = await calcWithdrawalFee(requestAmount);
    const mode = await getSetting('withdrawal_schedule_mode');
    res.json({
      requestAmount,
      fee,
      netAmount,
      scheduleMode: mode,
      ...(mode === 'FIXED_DATES'
        ? { nextPayoutDate: payoutDate, note: '平台每月15日和月末集中打款' }
        : {}),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message, code: err.code });
  }
});

/** POST /api/wallet/withdraw-request — 赫使提交提现申请
 *
 * 原子性设计：pending 查重 + 申请落库 + 余额冻结包在同一事务里——
 * 1) 先对钱包行 FOR UPDATE，同一用户的提现请求串行化（堵死并发穿过查重的窗口）；
 * 2) 冻结失败（如余额竞态不足）时 ROLLBACK 连申请行一起回滚，
 *    不会留下卡死后续提现的僵尸 pending（旧实现三步无事务，两个都会发生）。
 */
walletRouter.post('/withdraw-request', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { amount, method, accountDetails } = req.body;

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: '提现金额无效' });
  }
  if (!method || !accountDetails) {
    return res.status(400).json({ error: '请填写收款方式和账号信息' });
  }

  let feeInfo: { fee: number; netAmount: number; payoutDate: string };
  try {
    feeInfo = await calcWithdrawalFee(amt);
  } catch (err: any) {
    return res.status(400).json({ error: err.message, code: err.code });
  }

  // 预检仅为友好报错；最终裁决在事务内的 freezeWithdrawal（余额守卫）
  const bal = await getBalance(userId, 'herald');
  if (amt > bal.available) {
    return res.status(400).json({ error: `可提现余额不足，当前可提 ¥${bal.available.toFixed(0)}` });
  }

  const client = await db.connect();
  const id = genId();
  try {
    await client.query('BEGIN');

    // 锁定该用户 herald 钱包行：串行化同一用户的并发提现（钱包不存在时锁空集，
    // 此时余额必为 0，后面冻结必然失败回滚，无害）
    await client.query(
      `SELECT id FROM wallets WHERE user_id = $1 AND wallet_type = 'herald' AND currency = 'JPY' FOR UPDATE`,
      [userId]
    );

    const pending = await client.query(
      `SELECT id FROM withdrawal_requests WHERE herald_id = $1 AND status IN ('pending','processing')`,
      [userId]
    );
    if (pending.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: '已有待处理的提现申请' });
    }

    await client.query(
      `INSERT INTO withdrawal_requests
         (id, herald_id, amount, currency, method, account_details, status, fee, net_amount, payout_date)
       VALUES ($1, $2, $3, 'JPY', $4, $5, 'pending', $6, $7, $8)`,
      [
        id, userId, amt, method, JSON.stringify(accountDetails),
        feeInfo.fee, feeInfo.netAmount,
        feeInfo.payoutDate === 'immediate' ? null : feeInfo.payoutDate,
      ]
    );

    await freezeWithdrawal({
      userId,
      amount: amt,
      idempotencyKey: `WITHDRAWAL_FREEZE:${id}`,
      referenceType:  'withdrawal_request',
      referenceId:    id,
    }, client);

    await client.query('COMMIT');
  } catch (err: any) {
    await client.query('ROLLBACK');
    return res.status(400).json({ error: err.message, code: err.code });
  } finally {
    client.release();
  }

  const message = feeInfo.payoutDate === 'immediate'
    ? `提现申请已提交，手续费 ¥${feeInfo.fee}，到账 ¥${feeInfo.netAmount}`
    : `提现申请已提交，预计 ${feeInfo.payoutDate} 打款，手续费 ¥${feeInfo.fee}，到账 ¥${feeInfo.netAmount}`;

  res.status(201).json({
    id,
    amount,
    fee: feeInfo.fee,
    netAmount: feeInfo.netAmount,
    payoutDate: feeInfo.payoutDate === 'immediate' ? null : feeInfo.payoutDate,
    currency: 'JPY',
    message,
  });
});
