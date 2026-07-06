import { Router, Request, Response } from 'express';
import db from '../db';
import { findOne, findMany, insert, update, remove, genId } from '../utils/db';
import { requireAuth } from '../middleware/auth';
import { getBalance, getAllBalances, getAggregateBalance, getPeriodFlow, freezeWithdrawal, ENTRY_DIRECTION, ENTRY_TYPE_LABELS, WalletType } from '../utils/wallet';
import { getRate } from '../utils/exchangeRate';

export const walletRouter = Router();

// 所有钱包接口都需要登录
walletRouter.use(requireAuth);

/** 解析期间过滤参数，默认本月初至今 */
function getPeriodRange(query: any): { from: string; to: string } {
  const now = new Date();
  let from: Date, to: Date;
  if (query.from) {
    from = new Date(String(query.from));
  } else {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  to = query.to ? new Date(String(query.to)) : now;
  return { from: from.toISOString(), to: to.toISOString() };
}

/** 该用户在某钱包类型下的展示币种（herald: 赫使设置；brand/platform: 品牌业务市场币种） */
async function getDisplayCurrency(userId: string, walletType: WalletType): Promise<string> {
  if (walletType === 'brand') {
    const brand = await findOne<{ currency: string }>('SELECT currency FROM brand_profiles WHERE user_id = ?', [userId]);
    return brand?.currency || 'JPY';
  }
  const profile = await findOne<{ display_currency: string | null }>(
    'SELECT display_currency FROM herald_profiles WHERE user_id = ?', [userId]
  );
  return profile?.display_currency || 'JPY';
}

/** GET /api/wallet/balance — 赫使余额（多币种汇总 + 各币种明细 + 期间流入流出）*/
walletRouter.get('/balance', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const displayCurrency = await getDisplayCurrency(userId, 'herald');

  // 各币种明细（真实余额，不换算）
  const balances = await getAllBalances(userId, 'herald');
  // 汇总（按汇率换算为 displayCurrency，仅用于展示）
  const aggregate = await getAggregateBalance(userId, 'herald', displayCurrency);

  const { from, to } = getPeriodRange(req.query);
  const flow = await getPeriodFlow(userId, 'herald', displayCurrency, from, to);

  res.json({
    displayCurrency,
    balances,                          // [{currency, available, frozen, total}, ...] 真实余额
    aggregate,                         // 换算到 displayCurrency 后的汇总
    available: aggregate.available,
    frozen: aggregate.frozen,
    pendingAmount: aggregate.frozen,
    periodFrom: from,
    periodTo: to,
    periodInflow: flow.inflow,
    periodOutflow: flow.outflow,
  });
});

/** GET /api/wallet/exchange-rate — 当前 CNY/JPY 汇率（展示用） */
walletRouter.get('/exchange-rate', async (req: Request, res: Response) => {
  const { from = 'CNY', to = 'JPY' } = req.query as { from?: string; to?: string };
  const rate = await getRate(String(from), String(to));
  res.json({ from, to, rate });
});

/** GET /api/wallet/transactions — 钱包流水（按期间过滤 + 期间流入流出 + 分类型明细分页）*/
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
            we.note, we.created_at, we.reference_type, we.reference_id
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

  const displayCurrency = await getDisplayCurrency(userId, wt);
  const flow = await getPeriodFlow(userId, wt, displayCurrency, from, to);

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
    periodInflow: flow.inflow,
    periodOutflow: flow.outflow,
    displayCurrency,
  });
});

/** GET /api/wallet/methods */
walletRouter.get('/methods', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const methods = await findMany(
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
walletRouter.post('/methods', async (req: Request, res: Response) => {
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

/** GET /api/wallet/brand-balance — 品牌余额（单一币种，取自 brand_profiles.currency + 期间流入流出）*/
walletRouter.get('/brand-balance', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const currency = await getDisplayCurrency(userId, 'brand');
  const bal = await getBalance(userId, 'brand', currency);
  const { from, to } = getPeriodRange(req.query);
  const flow = await getPeriodFlow(userId, 'brand', currency, from, to);

  res.json({
    currency,
    available: bal.available,
    frozen: bal.frozen,
    periodFrom: from,
    periodTo: to,
    periodInflow: flow.inflow,
    periodOutflow: flow.outflow,
  });
});

/** POST /api/wallet/topup — 品牌提交充值申请（币种固定为该品牌的业务市场币种） */
walletRouter.post('/topup', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { amount, note } = req.body;

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: '请输入有效金额' });
  }

  const brand = await findOne<{ currency: string }>('SELECT currency FROM brand_profiles WHERE user_id = ?', [userId]);
  const currency = brand?.currency || 'JPY';

  const id = await insert('topup_requests', {
    brand_id: userId,
    amount: Number(amount),
    currency,
    note: note || null,
    status: 'pending',
  });

  res.status(201).json({ id, amount, currency, message: '充值申请已提交，运营确认到账后余额增加' });
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

/** POST /api/wallet/withdraw-request — 赫使提交提现申请（按指定币种钱包扣减） */
walletRouter.post('/withdraw-request', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { amount, currency = 'JPY', method, accountDetails } = req.body;

  if (!['JPY', 'CNY'].includes(currency)) {
    return res.status(400).json({ error: '不支持的币种' });
  }
  if (!amount || Number(amount) < 100) {
    return res.status(400).json({ error: '最低提现金额 100' });
  }
  if (!method || !accountDetails) {
    return res.status(400).json({ error: '请填写收款方式和账号信息' });
  }

  // 从钱包表读可用余额（O(1)，指定币种）
  const bal = await getBalance(userId, 'herald', currency);
  if (Number(amount) > bal.available) {
    return res.status(400).json({ error: `可提现余额不足，当前可提 ${currency} ${bal.available.toFixed(0)}` });
  }

  // 检查是否有待处理申请
  const pending = await findOne(
    `SELECT id FROM withdrawal_requests WHERE herald_id = ? AND status IN ('pending','processing')`,
    [userId]
  );
  if (pending) return res.status(409).json({ error: '已有待处理的提现申请' });

  const id = await insert('withdrawal_requests', {
    herald_id: userId,
    amount: Number(amount),
    currency,
    method,
    account_details: JSON.stringify(accountDetails),
    status: 'pending',
  });

  // 赫使钱包：可用→冻结（原子操作，指定币种）
  await freezeWithdrawal({
    userId,
    amount: Number(amount),
    currency,
    idempotencyKey: `WITHDRAWAL_FREEZE:${id}`,
    referenceType: 'withdrawal_request',
    referenceId: id,
  });

  res.status(201).json({ id, amount, currency, message: '提现申请已提交，预计1-3个工作日内打款' });
});

// /withdraw 已废弃，统一走 /withdraw-request
