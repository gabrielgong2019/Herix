import pool from '../db';

/**
 * 原子生成下一个发票号，FOR UPDATE 保证高并发下无间隙连续。
 *
 * DEPOSIT  → DEP-YYYYMMDD-0001（按天计数）
 * MONTHLY  → INV-YYYYMM-0001（按月计数）
 */
export async function nextInvoiceNo(
  type: 'DEPOSIT' | 'MONTHLY',
  date: Date = new Date(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client?: any,
): Promise<string> {
  const exec: typeof pool = client ?? pool;
  const jst = toJST(date);

  let prefix: string;
  if (type === 'DEPOSIT') {
    const ymd = `${jst.getFullYear()}${pad2(jst.getMonth() + 1)}${pad2(jst.getDate())}`;
    prefix = `DEP-${ymd}`;
  } else {
    const ym = `${jst.getFullYear()}${pad2(jst.getMonth() + 1)}`;
    prefix = `INV-${ym}`;
  }

  // INSERT or no-op、then lock and increment
  await exec.query(
    `INSERT INTO invoice_sequences(prefix, last_no) VALUES($1, 0) ON CONFLICT(prefix) DO NOTHING`,
    [prefix],
  );
  const { rows } = await exec.query(
    `UPDATE invoice_sequences SET last_no = last_no + 1 WHERE prefix = $1 RETURNING last_no`,
    [prefix],
  );
  const seq = rows[0].last_no as number;
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

function pad2(n: number) { return String(n).padStart(2, '0'); }

// JST = UTC+9
function toJST(d: Date): Date {
  return new Date(d.getTime() + 9 * 3600 * 1000);
}
