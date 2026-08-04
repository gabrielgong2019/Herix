/**
 * 法律文档只读接口（2026-08-03）：读取 herix-server/legal/ 下的 Markdown，
 * 转为带内联样式的 HTML 返回，供小程序/H5 用 Taro <RichText> 渲染。
 * 内容是唯一来源（版本控制在仓库），改协议只需服务端 git pull，不用重新发 App。
 *
 * scope: weapp（小程序·中文） | web（网页·日英）
 * doc:   user-agreement | privacy-policy
 * lang:  zh | ja | en
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';

export const legalRouter = Router();

const LEGAL_DIR = path.join(__dirname, '../../legal');
const SCOPES = new Set(['weapp', 'web']);
const DOCS = new Set(['user-agreement', 'privacy-policy']);
const LANGS = new Set(['zh', 'ja', 'en']);

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 行内：**bold** → <strong>（先转义再处理，内容可控） */
function inline(s: string): string {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong style="font-weight:600">$1</strong>');
}

const ST = {
  h1: 'font-size:20px;font-weight:700;margin:18px 0 10px;color:#111',
  h2: 'font-size:17px;font-weight:700;margin:18px 0 8px;color:#111',
  h3: 'font-size:15px;font-weight:600;margin:12px 0 6px;color:#111',
  p: 'font-size:14px;line-height:1.75;margin:8px 0;color:#333',
  hr: 'border:none;border-top:1px solid #eee;margin:16px 0',
  ol: 'padding-left:22px;margin:8px 0',
  li: 'font-size:14px;line-height:1.75;margin:4px 0;color:#333',
  table: 'width:100%;border-collapse:collapse;margin:12px 0;font-size:12px',
  cell: 'border:1px solid #e0e0e0;padding:6px 8px;text-align:left;vertical-align:top;color:#333',
  thcell: 'border:1px solid #e0e0e0;padding:6px 8px;text-align:left;background:#f7f7f7;font-weight:600;color:#111',
};

/** 极简 Markdown → HTML，仅覆盖本项目协议用到的语法（标题/加粗/表格/有序列表/分隔线/段落）。 */
function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  const cells = (row: string) => row.replace(/^\||\|$/g, '').split('|').map(c => c.trim());

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    // 表格块：连续以 | 开头的行
    if (t.startsWith('|')) {
      const block: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { block.push(lines[i].trim()); i++; }
      if (block.length >= 1) {
        const header = cells(block[0]);
        const bodyRows = block.slice(2); // block[1] 是 |---|---| 分隔行
        out.push(`<table style="${ST.table}"><thead><tr>` +
          header.map(h => `<th style="${ST.thcell}">${inline(h)}</th>`).join('') +
          `</tr></thead><tbody>` +
          bodyRows.map(r => `<tr>` + cells(r).map(c => `<td style="${ST.cell}">${inline(c)}</td>`).join('') + `</tr>`).join('') +
          `</tbody></table>`);
      }
      continue;
    }

    // 有序列表块
    if (/^\d+\.\s/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s/, '')); i++;
      }
      out.push(`<ol style="${ST.ol}">` + items.map(it => `<li style="${ST.li}">${inline(it)}</li>`).join('') + `</ol>`);
      continue;
    }

    if (t === '') { i++; continue; }
    if (t === '---') { out.push(`<hr style="${ST.hr}"/>`); i++; continue; }
    if (t.startsWith('### ')) { out.push(`<h3 style="${ST.h3}">${inline(t.slice(4))}</h3>`); i++; continue; }
    if (t.startsWith('## ')) { out.push(`<h2 style="${ST.h2}">${inline(t.slice(3))}</h2>`); i++; continue; }
    if (t.startsWith('# ')) { out.push(`<h1 style="${ST.h1}">${inline(t.slice(2))}</h1>`); i++; continue; }

    out.push(`<p style="${ST.p}">${inline(t)}</p>`); i++;
  }
  return out.join('');
}

legalRouter.get('/:scope/:doc', (req, res) => {
  const { scope, doc } = req.params;
  const lang = String(req.query.lang || '');
  if (!SCOPES.has(scope) || !DOCS.has(doc) || !LANGS.has(lang)) {
    return res.status(400).json({ error: '参数不合法' });
  }
  const file = path.join(LEGAL_DIR, scope, `${doc}.${lang}.md`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: '文档不存在' });
  try {
    const md = fs.readFileSync(file, 'utf8');
    res.json({ scope, doc, lang, html: mdToHtml(md) });
  } catch {
    res.status(500).json({ error: '读取失败' });
  }
});
