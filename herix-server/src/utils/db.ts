import crypto from 'crypto';
import pool from '../db';

/** 生成唯一 ID（32 位 hex） */
export function genId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** 将 SQLite ? 占位符转换为 PG $N 格式 */
function toPgSql(sql: string, params: any[]): { text: string; values: any[] } {
  let idx = 0;
  const text = sql.replace(/\?/g, () => `$${++idx}`);
  return { text, values: params };
}

/** 执行查询并返回单行 */
export async function findOne<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  const { text, values } = toPgSql(sql, params);
  const result = await pool.query(text, values);
  return result.rows[0] as T | undefined;
}

/** 执行查询并返回多行 */
export async function findMany<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const { text, values } = toPgSql(sql, params);
  const result = await pool.query(text, values);
  return result.rows as T[];
}

/** 执行 INSERT，返回插入的 ID */
export async function insert(table: string, data: Record<string, any>): Promise<string> {
  if (!data.id) {
    data.id = genId();
  }

  const keys = Object.keys(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`);
  const values = Object.values(data);

  await pool.query(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders.join(', ')})`,
    values
  );
  return data.id;
}

/** 执行 UPDATE */
export async function update(
  table: string,
  data: Record<string, any>,
  whereClause: string,
  whereParams: any[] = []
) {
  const keys = Object.keys(data);
  // 空对象直接 no-op：PATCH 类接口按需拼 data，一个字段都没带时曾生成
  // `UPDATE x SET WHERE ...` 非法 SQL 打崩请求（2026-07-18 生产日志坐实，
  // 触发点 ambassador.ts /profile）。PATCH 语义下"没有要改的"就是成功
  if (!keys.length) return;
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const allValues = [...Object.values(data), ...whereParams];

  // 将 WHERE 子句中的 ? 转换为 $N（从 SET 部分之后开始编号）
  let idx = keys.length;
  const whereText = whereClause.replace(/\?/g, () => `$${++idx}`);

  await pool.query(
    `UPDATE ${table} SET ${setClause} WHERE ${whereText}`,
    allValues
  );
}

/** 执行 DELETE */
export async function remove(table: string, whereClause: string, params: any[] = []) {
  let idx = 0;
  const whereText = whereClause.replace(/\?/g, () => `$${++idx}`);
  await pool.query(`DELETE FROM ${table} WHERE ${whereText}`, params);
}
