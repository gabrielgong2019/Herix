import crypto from 'crypto';
import db from '../db';

/** 生成唯一 ID */
export function genId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** 执行查询并返回单行 */
export function findOne<T = any>(sql: string, params: any[] = []): T | undefined {
  const stmt = db.prepare(sql);
  return stmt.get(...params) as T | undefined;
}

/** 执行查询并返回多行 */
export function findMany<T = any>(sql: string, params: any[] = []): T[] {
  const stmt = db.prepare(sql);
  return stmt.all(...params) as T[];
}

/** 执行 INSERT，返回插入的 ID */
export function insert(table: string, data: Record<string, any>): string {
  // 自动生成 ID
  if (!data.id) {
    data.id = genId();
  }

  const keys = Object.keys(data);
  const placeholders = keys.map(() => '?');
  const values = Object.values(data);

  const stmt = db.prepare(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders.join(', ')})`
  );
  stmt.run(...values);
  return data.id;
}

/** 执行 UPDATE */
export function update(table: string, data: Record<string, any>, whereClause: string, whereParams: any[] = []) {
  const keys = Object.keys(data);
  const setClause = keys.map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(data), ...whereParams];

  const stmt = db.prepare(`UPDATE ${table} SET ${setClause} WHERE ${whereClause}`);
  return stmt.run(...values);
}

/** 执行 DELETE */
export function remove(table: string, whereClause: string, params: any[] = []) {
  const stmt = db.prepare(`DELETE FROM ${table} WHERE ${whereClause}`);
  return stmt.run(...params);
}
