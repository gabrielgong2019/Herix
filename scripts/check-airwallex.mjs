#!/usr/bin/env node
/**
 * Airwallex 账户权限检查脚本
 * 用法：
 *   本地：AIRWALLEX_CLIENT_ID=xxx AIRWALLEX_API_KEY=yyy node scripts/check-airwallex.mjs
 *   ECS： ssh root@8.210.73.0 "AIRWALLEX_CLIENT_ID=xxx AIRWALLEX_API_KEY=yyy node /home/herix/Herix/scripts/check-airwallex.mjs"
 */

import * as readline from 'readline';

const BASE = 'https://api.airwallex.com';

function prompt(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
}

const CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID || await prompt('Client ID : ');
const API_KEY   = process.env.AIRWALLEX_API_KEY   || await prompt('API Key   : ');

if (!CLIENT_ID || !API_KEY) {
  console.error('❌ Client ID 和 API Key 不能为空');
  process.exit(1);
}

async function login() {
  const res = await fetch(`${BASE}/api/v1/authentication/login`, {
    method: 'POST',
    headers: { 'x-client-id': CLIENT_ID, 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`登录失败 ${res.status}: ${await res.text()}`);
  const { token } = await res.json();
  return token;
}

async function get(token, path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  try { return { status: res.status, ok: res.ok, body: JSON.parse(text) }; }
  catch { return { status: res.status, ok: res.ok, body: text }; }
}

async function main() {
  console.log('🔑 登录 Airwallex...');
  const token = await login();
  console.log('✅ 登录成功\n');

  // 账户基本信息
  const acct = await get(token, '/api/v1/account');
  if (acct.ok) {
    const a = acct.body;
    console.log('📋 账户信息');
    console.log('   主体名：', a.business_name || a.account_name || '—');
    console.log('   账户ID：', a.id || '—');
    console.log('   状态：  ', a.status || '—');
    console.log('   国家：  ', a.country_code || '—');
    console.log('   币种：  ', (a.primary_currency) || '—');
    console.log();
  } else {
    console.log('⚠️  账户信息获取失败:', acct.status, JSON.stringify(acct.body).slice(0, 200));
    console.log();
  }

  // 检查 Transfers 能力
  const transfers = await get(token, '/api/v1/transfers?page_num=0&page_size=1');
  console.log('💸 Transfers（打款）');
  if (transfers.ok) {
    console.log('   ✅ 已开通，可创建转账');
  } else if (transfers.status === 403) {
    console.log('   ❌ 未开通或无权限（需联系 Airwallex 开通 Transfers 功能）');
  } else {
    console.log('   ⚠️ ', transfers.status, JSON.stringify(transfers.body).slice(0, 200));
  }
  console.log();

  // 检查 Beneficiaries 能力
  const benes = await get(token, '/api/v1/beneficiaries?page_num=0&page_size=1');
  console.log('👤 Beneficiaries（收款人管理）');
  if (benes.ok) {
    console.log('   ✅ 已开通，可注册收款人');
    if (benes.body.items?.length > 0) {
      console.log('   已有收款人数：', benes.body.items.length, '(showing 1)');
    }
  } else if (benes.status === 403) {
    console.log('   ❌ 未开通或无权限');
  } else {
    console.log('   ⚠️ ', benes.status, JSON.stringify(benes.body).slice(0, 200));
  }
  console.log();

  // 检查账户余额
  const balances = await get(token, '/api/v1/balances');
  console.log('💴 账户余额');
  if (balances.ok) {
    const items = Array.isArray(balances.body) ? balances.body : (balances.body.items || []);
    if (items.length === 0) {
      console.log('   （暂无余额记录）');
    } else {
      items.forEach(b => console.log(`   ${b.currency}: ${b.available_amount ?? b.balance ?? '—'}`));
    }
  } else {
    console.log('   ⚠️ ', balances.status, JSON.stringify(balances.body).slice(0, 200));
  }
  console.log();

  // 检查 JPY 本地转账支持
  const schema = await get(token, '/api/v1/bank_transfer/payment_methods?country_code=JP&currency=JPY');
  console.log('🏦 日本本地转账（JPY）');
  if (schema.ok) {
    const methods = schema.body.items || schema.body || [];
    const local = Array.isArray(methods) ? methods.find(m => m.payment_method === 'LOCAL' || m.method === 'LOCAL') : null;
    if (local || (Array.isArray(methods) && methods.length > 0)) {
      console.log('   ✅ 支持 JPY 本地转账');
      if (Array.isArray(methods)) methods.forEach(m => console.log('   方式：', JSON.stringify(m).slice(0, 120)));
    } else {
      console.log('   ℹ️  返回：', JSON.stringify(methods).slice(0, 300));
    }
  } else {
    console.log('   ⚠️ ', schema.status, JSON.stringify(schema.body).slice(0, 200));
  }
}

main().catch(e => { console.error('❌ 错误：', e.message); process.exit(1); });
