/**
 * Wallet utility — atomic balance operations
 *
 * 设计原则（取自支付宝/微信/PayPal 经验）：
 * 1. 幂等性：每次操作必须传 idempotency_key，重复调用返回相同结果
 * 2. 原子性：余额更新和流水写入在同一 DB transaction 中
 * 3. 不可变：wallet_entries 只追加，绝不修改
 * 4. 余额快照：每条 entry 存 available_after / frozen_after，无需重算历史
 * 5. 单币种：现阶段全部 JPY，source_entity 追踪来源法人实体
 */

import pool from '../db';
import { genId } from './db';

export type WalletType = 'brand' | 'herald' | 'platform';
export type SourceEntity = 'JP' | 'HK' | 'CN';

export type WalletEntryType =
  | 'TOPUP'               // 品牌充值
  | 'TASK_FREEZE'         // 任务发布：可用→冻结
  | 'TASK_UNFREEZE'       // 任务退款：冻结→可用
  | 'TASK_SETTLE'         // 任务结算：冻结清零（对应赫使收款）
  | 'TASK_CREDIT'         // 赫使收入
  | 'PLATFORM_FEE'        // 平台服务费
  | 'WITHDRAWAL_FREEZE'   // 提现申请：可用→冻结
  | 'WITHDRAWAL_DEBIT'    // 提现完成：冻结清零
  | 'WITHDRAWAL_UNFREEZE' // 提现取消：冻结→可用
  | 'ADJUSTMENT';         // 人工调整

/** 流水方向：用于钱包流水的"流入/流出/内部转移"分类（相对于 available+frozen 总额）*/
export type EntryDirection = 'in' | 'out' | 'transfer' | 'adjustment';

export const ENTRY_DIRECTION: Record<WalletEntryType, EntryDirection> = {
  TOPUP: 'in',
  TASK_FREEZE: 'transfer',
  TASK_UNFREEZE: 'transfer',
  TASK_SETTLE: 'out',
  TASK_CREDIT: 'in',
  PLATFORM_FEE: 'in',
  WITHDRAWAL_FREEZE: 'transfer',
  WITHDRAWAL_DEBIT: 'out',
  WITHDRAWAL_UNFREEZE: 'transfer',
  ADJUSTMENT: 'adjustment',
};

export const ENTRY_TYPE_LABELS: Record<WalletEntryType, string> = {
  TOPUP: '充值到账',
  TASK_FREEZE: '任务发布（冻结）',
  TASK_UNFREEZE: '任务取消（解冻）',
  TASK_SETTLE: '任务结算支出',
  TASK_CREDIT: '任务收入',
  PLATFORM_FEE: '平台服务费',
  WITHDRAWAL_FREEZE: '提现申请（冻结）',
  WITHDRAWAL_DEBIT: '提现到账',
  WITHDRAWAL_UNFREEZE: '提现取消（解冻）',
  ADJUSTMENT: '人工调整',
};

export interface WalletBalance {
  available: number;
  frozen: number;
  total: number;
}

export interface WalletOpParams {
  userId: string;
  walletType: WalletType;
  amount: number;
  type: WalletEntryType;
  idempotencyKey: string;
  sourceEntity?: SourceEntity;
  taxWithheld?: number;
  referenceType?: string;
  referenceId?: string;
  parentEntryId?: string;
  note?: string;
  createdBy?: string;
}

const CURRENCY = 'JPY';
const now = () => new Date().toISOString();

export const PLATFORM_USER_ID = 'HERIX_PLATFORM';

/** 查询或创建钱包 */
async function getOrCreateWallet(
  client: any,
  userId: string,
  walletType: WalletType,
): Promise<{ id: string; available_balance: number; frozen_balance: number }> {
  const existing = await client.query(
    'SELECT id, available_balance, frozen_balance FROM wallets WHERE user_id = $1 AND wallet_type = $2 AND currency = $3',
    [userId, walletType, CURRENCY]
  );
  if (existing.rows[0]) return existing.rows[0];

  const id = genId();
  await client.query(
    `INSERT INTO wallets (id, user_id, wallet_type, currency, available_balance, frozen_balance, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 0, 0, $5, $5)`,
    [id, userId, walletType, CURRENCY, now()]
  );
  return { id, available_balance: 0, frozen_balance: 0 };
}

async function applyWalletEntry(
  params: WalletOpParams,
  deltaAvailable: number,
  deltaFrozen: number
): Promise<{ entryId: string; balance: WalletBalance }> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT id, available_after, frozen_after FROM wallet_entries WHERE idempotency_key = $1',
      [params.idempotencyKey]
    );
    if (existing.rows[0]) {
      await client.query('ROLLBACK');
      const r = existing.rows[0];
      return {
        entryId: r.id,
        balance: { available: r.available_after, frozen: r.frozen_after, total: r.available_after + r.frozen_after },
      };
    }

    const wallet = await getOrCreateWallet(client, params.userId, params.walletType);
    const newAvailable = wallet.available_balance + deltaAvailable;
    const newFrozen    = wallet.frozen_balance + deltaFrozen;

    if (newAvailable < 0) throw new Error(`余额不足（可用 ${wallet.available_balance}，需 ${-deltaAvailable}）`);
    if (newFrozen < 0)    throw new Error(`冻结余额不足（冻结 ${wallet.frozen_balance}，需 ${-deltaFrozen}）`);

    await client.query(
      'UPDATE wallets SET available_balance = $1, frozen_balance = $2, updated_at = $3 WHERE id = $4',
      [newAvailable, newFrozen, now(), wallet.id]
    );

    const entryId = genId();
    await client.query(
      `INSERT INTO wallet_entries
         (id, idempotency_key, wallet_id, amount, currency, available_after, frozen_after,
          type, reference_type, reference_id, parent_entry_id, note, created_by, created_at,
          source_entity, tax_withheld)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        entryId, params.idempotencyKey, wallet.id,
        deltaAvailable || deltaFrozen,
        CURRENCY, newAvailable, newFrozen,
        params.type, params.referenceType || null, params.referenceId || null,
        params.parentEntryId || null, params.note || null,
        params.createdBy || 'system', now(),
        params.sourceEntity || 'JP',
        params.taxWithheld || 0,
      ]
    );

    await client.query('COMMIT');
    return { entryId, balance: { available: newAvailable, frozen: newFrozen, total: newAvailable + newFrozen } };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

type CallerParams = Omit<WalletOpParams, 'type' | 'walletType'>;

export const topupBrand        = (p: CallerParams) => applyWalletEntry({ ...p, walletType: 'brand',    type: 'TOPUP'               },  p.amount,  0         );
export const freezeForTask     = (p: CallerParams) => applyWalletEntry({ ...p, walletType: 'brand',    type: 'TASK_FREEZE'         }, -p.amount,  p.amount  );
export const unfreezeTask      = (p: CallerParams) => applyWalletEntry({ ...p, walletType: 'brand',    type: 'TASK_UNFREEZE'       },  p.amount, -p.amount  );
export const settleTask        = (p: CallerParams) => applyWalletEntry({ ...p, walletType: 'brand',    type: 'TASK_SETTLE'         },  0,        -p.amount  );
// 信用托管任务结算：无预冻结，直接从可用余额扣除（商家充值后才能触达此路径）
export const settleCreditTask  = (p: CallerParams) => applyWalletEntry({ ...p, walletType: 'brand',    type: 'TASK_SETTLE'         }, -p.amount,  0         );
export const creditHerald      = (p: CallerParams) => applyWalletEntry({ ...p, walletType: 'herald',   type: 'TASK_CREDIT'         },  p.amount,  0         );
export const creditPlatformFee = (p: CallerParams) => applyWalletEntry({ ...p, walletType: 'platform', type: 'PLATFORM_FEE'        },  p.amount,  0         );
export const freezeWithdrawal  = (p: CallerParams) => applyWalletEntry({ ...p, walletType: 'herald',   type: 'WITHDRAWAL_FREEZE'   }, -p.amount,  p.amount  );
export const debitWithdrawal   = (p: CallerParams) => applyWalletEntry({ ...p, walletType: 'herald',   type: 'WITHDRAWAL_DEBIT'    },  0,        -p.amount  );
export const unfreezeWithdrawal= (p: CallerParams) => applyWalletEntry({ ...p, walletType: 'herald',   type: 'WITHDRAWAL_UNFREEZE' },  p.amount, -p.amount  );

/** 查询余额 */
export async function getBalance(userId: string, walletType: WalletType): Promise<WalletBalance> {
  const r = await pool.query(
    'SELECT available_balance, frozen_balance FROM wallets WHERE user_id = $1 AND wallet_type = $2 AND currency = $3',
    [userId, walletType, CURRENCY]
  );
  const row = r.rows[0];
  if (!row) return { available: 0, frozen: 0, total: 0 };
  return { available: Number(row.available_balance), frozen: Number(row.frozen_balance), total: Number(row.available_balance) + Number(row.frozen_balance) };
}
