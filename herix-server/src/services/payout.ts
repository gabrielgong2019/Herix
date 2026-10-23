import db from '../db';

export interface PayoutRequest {
  withdrawalId: string;
  heraldId: string;
  amount: number;
  currency: string;
  method: string;
  accountDetails: Record<string, any>;
  bankAccountId?: string;
}

export interface PayoutResult {
  success: boolean;
  referenceId?: string;
  error?: string;
}

export interface PayoutProvider {
  readonly name: string;
  send(req: PayoutRequest): Promise<PayoutResult>;
}

// ── Manual（手工确认打款）──────────────────────────────────
class ManualPayout implements PayoutProvider {
  readonly name = 'manual';

  async send(_req: PayoutRequest): Promise<PayoutResult> {
    return { success: true, referenceId: 'MANUAL' };
  }
}

// ── Airwallex（日本本地打款）──────────────────────────────
const AW_BASE = 'https://api.airwallex.com';

export class AirwallexPayout implements PayoutProvider {
  readonly name = 'airwallex';

  private tokenCache: { token: string; expiresAt: number } | null = null;

  async getToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.token;
    }
    const clientId = process.env.AIRWALLEX_CLIENT_ID;
    const apiKey = process.env.AIRWALLEX_API_KEY;
    if (!clientId || !apiKey) throw new Error('AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY must be set');

    const res = await fetch(`${AW_BASE}/api/v1/authentication/login`, {
      method: 'POST',
      headers: { 'x-client-id': clientId, 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`Airwallex auth failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as any;
    this.tokenCache = {
      token: data.token,
      expiresAt: data.expires_at
        ? new Date(data.expires_at).getTime() - 60_000
        : Date.now() + 25 * 60 * 1000,
    };
    return data.token;
  }

  /** 向 Airwallex 注册受益人，成功后更新 herald_bank_accounts.airwallex_beneficiary_id */
  async registerBeneficiary(bankAccountId: string): Promise<string> {
    const { rows } = await db.query(
      `SELECT * FROM herald_bank_accounts WHERE id = $1`, [bankAccountId]
    );
    const acct = rows[0];
    if (!acct) throw new Error(`Bank account ${bankAccountId} not found`);

    const token = await this.getToken();
    const country = acct.address_country || 'JP';
    const isCN = country === 'CN';
    const isJP = country === 'JP';
    const currency = acct.account_currency || (isCN ? 'CNY' : isJP ? 'JPY' : 'USD');

    const bankDetails: Record<string, any> = {
      account_currency: currency,
      account_name: acct.account_name,
      account_number: acct.account_number,
      bank_country_code: country,
    };
    const transferMethod = (isJP || isCN) ? 'LOCAL' : 'SWIFT';
    if (isCN) {
      bankDetails.account_routing_type1 = 'cnaps_code';
      bankDetails.account_routing_value1 = acct.bank_code;
    } else if (isJP) {
      bankDetails.account_routing_type1 = 'bank_code';
      bankDetails.account_routing_value1 = acct.bank_code;
      bankDetails.account_routing_type2 = 'branch_code';
      bankDetails.account_routing_value2 = acct.branch_code;
      bankDetails.bank_account_category = acct.account_category || 'Savings';
    } else {
      // 海外：SWIFT/BIC 存在 bank_code 字段
      bankDetails.account_routing_type1 = 'swift_code';
      bankDetails.account_routing_value1 = acct.bank_code;
    }

    const body = {
      transfer_methods: [transferMethod],
      beneficiary: {
        nickname: acct.nickname || `Herald-${acct.user_id.slice(-6)}`,
        entity_type: acct.entity_type || 'PERSONAL',
        personal_details: {
          first_name: acct.first_name,
          last_name: acct.last_name,
        },
        address: {
          country_code: country,
          city: acct.address_city,
          street_address: acct.address_street,
          postcode: acct.address_postcode,
        },
        bank_details: bankDetails,
      },
    };

    const res = await fetch(`${AW_BASE}/api/v1/beneficiaries/create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json() as any;
    if (!res.ok || !data.id) {
      const msg = data.message || data.error_message || JSON.stringify(data);
      throw new Error(msg);
    }

    await db.query(
      `UPDATE herald_bank_accounts
         SET airwallex_beneficiary_id = $1, is_verified = 1, updated_at = NOW()::text
       WHERE id = $2`,
      [data.id, bankAccountId]
    );
    return data.id;
  }

  async send(req: PayoutRequest): Promise<PayoutResult> {
    if (!req.bankAccountId) {
      throw new Error('bankAccountId is required for Airwallex payout');
    }

    const { rows } = await db.query(
      `SELECT airwallex_beneficiary_id, address_country FROM herald_bank_accounts WHERE id = $1`,
      [req.bankAccountId]
    );
    const acctRow = rows[0];
    let beneficiaryId: string = acctRow?.airwallex_beneficiary_id;
    const acctCountry = acctRow?.address_country || 'JP';
    const paymentMethod = (acctCountry === 'JP' || acctCountry === 'CN') ? 'LOCAL' : 'SWIFT';
    if (!beneficiaryId) {
      beneficiaryId = await this.registerBeneficiary(req.bankAccountId);
    }

    // DRY_RUN: 验证 token 和 beneficiary 注册，但跳过实际转账
    if (process.env.AIRWALLEX_DRY_RUN === 'true') {
      console.log(`[Airwallex DRY_RUN] would transfer ${req.amount} ${req.currency} to beneficiary ${beneficiaryId}`);
      return { success: true, referenceId: `DRY_RUN_${req.withdrawalId}` };
    }

    const token = await this.getToken();
    const res = await fetch(`${AW_BASE}/api/v1/transfers/create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: `HERIX_${req.withdrawalId}`,
        beneficiary_id: beneficiaryId,
        amount: req.amount,
        currency: req.currency,
        payment_method: paymentMethod,
      }),
    });
    const data = await res.json() as any;
    if (!res.ok) {
      throw new Error(`Airwallex transfer failed: ${JSON.stringify(data)}`);
    }
    return { success: true, referenceId: data.id || data.transfer_id };
  }
}

// ── 工厂 ────────────────────────────────────────────────────
function createProvider(): PayoutProvider {
  const name = process.env.PAYOUT_PROVIDER || 'manual';
  if (name === 'airwallex') return new AirwallexPayout();
  return new ManualPayout();
}

export const payoutProvider = createProvider();
