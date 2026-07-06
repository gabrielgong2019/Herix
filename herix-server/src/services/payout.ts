export interface PayoutRequest {
  withdrawalId: string;
  heraldId: string;
  amount: number;
  currency: string;       // 'JPY' | 'CNY' | 'USD' | ...
  method: string;         // 'bank' | 'alipay' | 'wechat' | 'wise'
  accountDetails: Record<string, any>;
}

export interface PayoutResult {
  success: boolean;
  referenceId?: string;  // provider's transaction ID
  error?: string;
}

export interface PayoutProvider {
  readonly name: string;
  send(req: PayoutRequest): Promise<PayoutResult>;
}

// ── Manual（现阶段）──────────────────────────────────────
// 管理员在后台确认打款，此处只记录意图，不做真实转账
class ManualPayout implements PayoutProvider {
  readonly name = 'manual';

  async send(_req: PayoutRequest): Promise<PayoutResult> {
    return { success: true, referenceId: 'MANUAL' };
  }
}

// ── Airwallex（预留）────────────────────────────────────
// 接入时：npm install airwallex-payment-elements 或调用 REST API
// 文档：https://www.airwallex.com/docs/payouts
class AirwallexPayout implements PayoutProvider {
  readonly name = 'airwallex';

  async send(req: PayoutRequest): Promise<PayoutResult> {
    // TODO: 配置 AIRWALLEX_CLIENT_ID + AIRWALLEX_API_KEY 后实现
    // const token = await this.getToken();
    // const res = await fetch('https://api.airwallex.com/api/v1/transfers/create', {
    //   method: 'POST',
    //   headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     request_id: req.withdrawalId,
    //     amount: req.amount,
    //     currency: req.currency,
    //     beneficiary: { ... req.accountDetails },
    //   }),
    // });
    // const data = await res.json();
    // return { success: data.status === 'SUCCESS', referenceId: data.transfer_id };
    throw new Error('Airwallex payout not configured — set PAYOUT_PROVIDER=airwallex and provide credentials');
  }
}

// ── 工厂：通过环境变量切换 ────────────────────────────────
function createProvider(): PayoutProvider {
  const name = process.env.PAYOUT_PROVIDER || 'manual';
  if (name === 'airwallex') return new AirwallexPayout();
  return new ManualPayout();
}

export const payoutProvider = createProvider();
