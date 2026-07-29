/**
 * KYB 自动核验（2026-07-29）
 *
 * 分层：
 *  1. 法人番号校验位 —— 离线算法（国税厅公开规格），零依赖恒可用，挡住输错/乱填
 *  2. 国税厅法人番号 Web-API 名称比对 —— 需要アプリケーションID（免费，利用届出申请），
 *     环境变量 HOUJIN_API_ID 配置后启用；未配置优雅降级为"仅校验位"
 *  3. 全自动通过 —— 仅当 校验位过 && 官方名称一致 && platform_settings.kyb_auto_approve='1'
 *     （默认关）。没有官方名称比对时永不自动通过——只凭校验位太弱（任何真实法人番号都能过）
 */

/** 法人番号校验位（第1位）：9 − (Σ Pn×Qn mod 9)，Pn=基础12位自右起第n位，Qn=n奇1偶2 */
export function validateCorporateNumberChecksum(num: string): boolean {
  if (!/^\d{13}$/.test(num)) return false;
  const check = Number(num[0]);
  const base = num.slice(1);
  let sum = 0;
  for (let n = 1; n <= 12; n++) {
    const p = Number(base[12 - n]);
    sum += p * (n % 2 === 1 ? 1 : 2);
  }
  return check === 9 - (sum % 9);
}

/** 公司名归一化比较：NFKC 全半角统一 + 去空白 + 株式会社前后缀容差 */
function normalizeName(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '').replace(/[（(].*?[)）]/g, '');
}
export function companyNamesMatch(a: string, b: string): boolean {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // 容差：一方带「株式会社/(株)」一方没带
  const strip = (x: string) => x.replace(/^(株式会社|合同会社|有限会社|\(株\)|㈱)/, '').replace(/(株式会社|合同会社|有限会社|\(株\)|㈱)$/, '');
  return strip(na) === strip(nb) && strip(na).length > 0;
}

export interface KybAutoChecks {
  corporateNumber: string | null;
  checksumValid: boolean | null;   // null = 未提供番号（非日本公司等）
  apiAvailable: boolean;           // HOUJIN_API_ID 是否配置且调用成功
  officialName: string | null;     // 国税厅登记名称
  nameMatch: boolean | null;       // 提交名 vs 官方名（api 不可用时 null）
  checkedAt: string;
}

/** 国税厅法人番号 Web-API v4 名称查询。失败/未配置返回 null（不阻塞提交） */
async function lookupOfficialName(corporateNumber: string): Promise<string | null> {
  const appId = process.env.HOUJIN_API_ID;
  if (!appId) return null;
  try {
    const url = `https://api.houjin-bangou.nta.go.jp/4/num?id=${appId}&number=${corporateNumber}&type=12&history=0`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const csv = await resp.text();
    // type=12 = Unicode CSV：第2行起为数据行，法人名在第7列（0起第6）
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return null;
    const fields = lines[1].split(',').map((f) => f.replace(/^"|"$/g, ''));
    return fields[6] || null;
  } catch (e) {
    console.error('[kyb] 法人番号API查询失败（降级为仅校验位）:', e);
    return null;
  }
}

/** 跑全部自动核验。country 非 jp 或未填番号时只记录"未核验"，不判失败 */
export async function runKybAutoChecks(args: {
  corporateNumber?: string | null;
  companyName: string;
  country?: string | null;
}): Promise<KybAutoChecks> {
  const num = (args.corporateNumber || '').replace(/[^\d]/g, '');
  const result: KybAutoChecks = {
    corporateNumber: num || null,
    checksumValid: null,
    apiAvailable: false,
    officialName: null,
    nameMatch: null,
    checkedAt: new Date().toISOString(),
  };
  if (!num) return result;

  result.checksumValid = validateCorporateNumberChecksum(num);
  if (!result.checksumValid) return result; // 号码本身不合法，不必再查 API

  const official = await lookupOfficialName(num);
  if (official !== null) {
    result.apiAvailable = true;
    result.officialName = official;
    result.nameMatch = companyNamesMatch(args.companyName, official);
  }
  return result;
}

/** 是否满足全自动通过条件（开关由调用方查 platform_settings 后传入） */
export function qualifiesForAutoApprove(checks: KybAutoChecks): boolean {
  return checks.checksumValid === true && checks.nameMatch === true;
}
