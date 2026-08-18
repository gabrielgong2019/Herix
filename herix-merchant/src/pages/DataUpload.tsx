import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { tasksApi, type Task, type CsvRecord, type CsvUploadResult } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { useAuth } from '@/contexts/AuthContext'

// ── CSV parsing ────────────────────────────────────────────────────
//
// 涉及结算，解析一律"宁可报错、不可猜"（2026-08 事故：Remitly 表头 usage_status
// 匹配不上转化列同义词，旧代码静默当 0 → 108 行明细全判未转化、赫使漏结算）。
// 因此：① 精确列名匹配（旧的 includes 子串匹配会让 'user' 命中 user_id，
// 把 UserID 当邮箱、uniqueId 反而空着）；② 必需列缺失直接报错，不再有默认值；
// ③ 逐行校验列数（裸 split(',') 遇到引号内逗号会整行错位，静默算错钱）。

/** 列名归一：小写、去空白、下划线/连字符统一成空格（user_id ≡ user id ≡ User-ID） */
function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/^﻿/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

/** 精确匹配（归一后全等）。按别名优先级依次找，命中即返回 —— 与列顺序无关 */
function findHeaderIdx(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const want = normHeader(alias)
    const hit = headers.indexOf(want)
    if (hit >= 0) return hit
  }
  return -1
}

/** RFC4180 单行解析：支持 "包含,逗号" 与 "" 转义 */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQuotes = false
      } else cur += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

// 模板列名 + 白名单别名（精确匹配，非子串）。新增合作方的导出列名时在此登记，
// 不要退回模糊匹配 —— 模糊匹配正是 2026-08 漏结算事故的技术根因。
const ALIAS_CODE     = ['code', 'promo code', 'promo', '推广码', '紹介コード', 'referral code', 'referral']
const ALIAS_UNIQUEID = ['user id', 'userid', 'unique id', 'uniqueid', 'customer id', '唯一id', '用户id', 'ユーザーid']
const ALIAS_USER     = ['user email masked', 'user email', 'email', 'user', 'name', '邮箱', '用户', 'メール', 'ユーザー']
const ALIAS_CONV     = ['converted', 'conversion', 'usage status', 'is converted', 'txn', '是否完成交易', '转化', '交易', '取引', '成約', 'コンバージョン']
const ALIAS_REG      = ['registered', 'registered count', 'registrations', 'signups', '注册数', '登録数']
const ALIAS_USED     = ['used', 'used count', 'usage', 'usage count', '使用数', '利用数']

/** 模板要求的列名（取别名表前几个当"官方写法"展示，下划线写法更贴近实际导出） */
function expectedNames(aliases: string[]): string {
  return aliases.slice(0, 3).map((a) => a.replace(/ /g, '_')).join(' / ')
}
/** 把用户实际表头按列序号列出来，便于对照第几列该改成什么 */
function actualHeaders(rawHeaders: string[]): string {
  return rawHeaders.map((h, i) => `第${i + 1}列「${h || '(空)'}」`).join('，')
}

/** 编辑距离（用于"是不是想写 X"提示，拼错一两个字母是最常见的上传事故） */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
  return dp[a.length][b.length]
}

/** 在用户表头里找与模板列名最接近的那个（距离 ≤2 才算数，避免瞎猜） */
function suggestColumn(headers: string[], rawHeaders: string[], aliases: string[]): string {
  let best = { idx: -1, dist: Infinity, alias: '' }
  headers.forEach((h, i) => {
    for (const a of aliases) {
      const d = editDistance(h, normHeader(a))
      if (d < best.dist) best = { idx: i, dist: d, alias: a.replace(/ /g, '_') }
    }
  })
  if (best.idx < 0 || best.dist > 2) return ''
  return `第${best.idx + 1}列「${rawHeaders[best.idx]}」→ 应为「${best.alias}」`
}

export type ParseError = { errorKey: string; params?: Record<string, unknown> }
type ParseResult =
  | { ok: true; records: CsvRecord[]; convertedCount: number; keyMode: 'ID' | 'EMAIL' }
  | { ok: false; error: ParseError }

const TRUTHY = ['1', 'true', 'yes', 'y', '是']
const FALSY = ['0', 'false', 'no', 'n', '否', '']

function parseCsv(text: string, dataMode: 'AGGREGATE' | 'DETAIL'): ParseResult {
  const lines = text.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return { ok: false, error: { errorKey: 'csv.errMinRows' } }

  const rawHeaders = splitCsvLine(lines[0])
  const headers = rawHeaders.map(normHeader)
  const colCount = headers.length
  const shown = actualHeaders(rawHeaders)

  const codeIdx = findHeaderIdx(headers, ALIAS_CODE)
  if (codeIdx === -1)
    return { ok: false, error: { errorKey: 'csv.errNoCodeCol', params: { expected: expectedNames(ALIAS_CODE), headers: shown, hint: suggestColumn(headers, rawHeaders, ALIAS_CODE) } } }

  const records: CsvRecord[] = []
  let convertedCount = 0

  if (dataMode === 'DETAIL') {
    const uniqueIdx = findHeaderIdx(headers, ALIAS_UNIQUEID)
    // 邮箱列不能跟 UserID 列撞（表头同时有 user_id 和 user 时，别让同一列兼两职）
    let userIdx = findHeaderIdx(headers, ALIAS_USER)
    if (userIdx === uniqueIdx) userIdx = -1
    const convIdx = findHeaderIdx(headers, ALIAS_CONV)

    if (uniqueIdx === -1 && userIdx === -1)
      return { ok: false, error: { errorKey: 'csv.errNoUserCol', params: { expected: `${expectedNames(ALIAS_UNIQUEID)}（优先）/ ${expectedNames(ALIAS_USER)}`, headers: shown, hint: suggestColumn(headers, rawHeaders, ALIAS_UNIQUEID.concat(ALIAS_USER)) } } }
    // 转化列缺失曾被静默当 0 → 整批漏结算。现在硬报错。
    if (convIdx === -1)
      return { ok: false, error: { errorKey: 'csv.errNoConvCol', params: { expected: expectedNames(ALIAS_CONV), headers: shown, hint: suggestColumn(headers, rawHeaders, ALIAS_CONV) } } }

    // 去重键模式：有 UserID 列就全批用 ID，否则全批用邮箱/姓名。
    // 服务端会把该模式锁在任务上，跨批切换直接拒绝（同一人换键=重复计费）
    const keyMode: 'ID' | 'EMAIL' = uniqueIdx >= 0 ? 'ID' : 'EMAIL'

    for (let i = 1; i < lines.length; i++) {
      const rowNo = i + 1
      const cols = splitCsvLine(lines[i])
      if (cols.length !== colCount)
        return { ok: false, error: { errorKey: 'csv.errColCount', params: { row: rowNo, want: colCount, got: cols.length } } }

      const code = cols[codeIdx] || ''
      const uniqueId = uniqueIdx >= 0 ? cols[uniqueIdx] || '' : ''
      const user = userIdx >= 0 ? cols[userIdx] || '' : ''
      if (!code && !uniqueId && !user) continue // 整行空，跳过

      if (!code) return { ok: false, error: { errorKey: 'csv.errRowNoCode', params: { row: rowNo } } }
      // 锁定 ID 模式后，该列不允许留空：留空会回退成邮箱键，同一人产生两条记录
      if (keyMode === 'ID' && !uniqueId)
        return { ok: false, error: { errorKey: 'csv.errRowNoUniqueId', params: { row: rowNo } } }
      if (keyMode === 'EMAIL' && !user)
        return { ok: false, error: { errorKey: 'csv.errRowNoUser', params: { row: rowNo } } }

      const convRaw = (cols[convIdx] || '').toLowerCase()
      if (!TRUTHY.includes(convRaw) && !FALSY.includes(convRaw))
        return { ok: false, error: { errorKey: 'csv.errConvValue', params: { row: rowNo, value: cols[convIdx] || '' } } }
      const converted = TRUTHY.includes(convRaw)
      if (converted) convertedCount++

      records.push({ code, user, uniqueId: uniqueId || undefined, converted })
    }

    if (!records.length) return { ok: false, error: { errorKey: 'csv.errNoValidRows' } }
    return { ok: true, records, convertedCount, keyMode }
  }

  const regIdx = findHeaderIdx(headers, ALIAS_REG)
  const usedIdx = findHeaderIdx(headers, ALIAS_USED)
  if (regIdx === -1 || usedIdx === -1)
    return { ok: false, error: { errorKey: 'csv.errNoAggCols', params: { expected: `${expectedNames(ALIAS_REG)} + ${expectedNames(ALIAS_USED)}`, headers: shown, hint: suggestColumn(headers, rawHeaders, ALIAS_REG.concat(ALIAS_USED)) } } }

  for (let i = 1; i < lines.length; i++) {
    const rowNo = i + 1
    const cols = splitCsvLine(lines[i])
    if (cols.length !== colCount)
      return { ok: false, error: { errorKey: 'csv.errColCount', params: { row: rowNo, want: colCount, got: cols.length } } }
    const code = cols[codeIdx] || ''
    if (!code) continue
    const reg = Number(cols[regIdx])
    const used = Number(cols[usedIdx])
    if (!Number.isInteger(reg) || reg < 0 || !Number.isInteger(used) || used < 0)
      return { ok: false, error: { errorKey: 'csv.errCountValue', params: { row: rowNo } } }
    records.push({ code, registered_count: reg, used_count: used })
    convertedCount += used
  }

  if (!records.length) return { ok: false, error: { errorKey: 'csv.errNoValidRows' } }
  return { ok: true, records, convertedCount, keyMode: 'EMAIL' }
}

// ── Template download ──────────────────────────────────────────────

function downloadTemplate(dataMode: 'AGGREGATE' | 'DETAIL', hdrUser: string, hdrUniqueId: string, hdrConverted: string, hdrReg: string, hdrUsed: string) {
  const csv =
    dataMode === 'DETAIL'
      ? `code,${hdrUniqueId},${hdrUser},${hdrConverted}\nHERIX-EXAMPLE1,U1001,alice@gmail.com,1\nHERIX-EXAMPLE2,U1002,a**@gmail.com,0`
      : `code,${hdrReg},${hdrUsed}\nHERIX-EXAMPLE1,0,0\nHERIX-EXAMPLE2,0,0`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = dataMode === 'DETAIL' ? 'herix_detail_template.csv' : 'herix_conversion_template.csv'
  a.click()
}

// ── Sub-components ─────────────────────────────────────────────────

function ModeBlock({ task }: { task: Task }) {
  const { t } = useTranslation()
  const isDetail = task.data_mode === 'DETAIL'

  const hdrUser = t('csv.hdrUser')
  const hdrUniqueId = t('csv.hdrUniqueId')
  const hdrConverted = t('csv.hdrConverted')
  const hdrReg = t('csv.hdrRegistered')
  const hdrUsed = t('csv.hdrUsed')

  const sample = isDetail
    ? `code,${hdrUniqueId},${hdrUser},${hdrConverted}\nHERIX-A3K9Z2,U1001,alice@gmail.com,1\nHERIX-A3K9Z2,U1002,a**@gmail.com,0`
    : `code,${hdrReg},${hdrUsed}\nHERIX-A3K9Z2,10,5\nHERIX-DEF456,8,3`

  const noteKeys = isDetail
    ? ['csv.detailNote1', 'csv.detailNoteMasked', 'csv.detailNote2', 'csv.detailNote3', 'csv.detailNote4', 'csv.detailNote5']
    : ['csv.aggregateNote1', 'csv.aggregateNote2', 'csv.aggregateNote3', 'csv.aggregateNote4', 'csv.aggregateNote5']

  const privacyKeys = ['csv.privacy1', 'csv.privacy2', 'csv.privacy3', 'csv.privacy4']

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{t('csv.uploadTitle')}</span>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: isDetail ? '#ede9fe' : '#dbeafe', color: isDetail ? '#6d28d9' : '#1d4ed8' }}
          >
            {isDetail ? t('csv.tagDetailMode') : t('csv.tagAggregateMode')}
          </span>
        </div>
        <button
          type="button"
          onClick={() => downloadTemplate(isDetail ? 'DETAIL' : 'AGGREGATE', hdrUser, hdrUniqueId, hdrConverted, hdrReg, hdrUsed)}
          className="text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors hover:bg-gray-50"
          style={{ border: '1px solid var(--border)', color: '#374151' }}
        >
          ↓ {t('csv.downloadTemplate')}
        </button>
      </div>

      <div
        className="rounded-xl px-4 py-3 mb-3 text-xs leading-relaxed"
        style={{ background: '#1e293b', color: '#e2e8f0', fontFamily: 'monospace', whiteSpace: 'pre' }}
      >
        {sample}
      </div>

      <div
        className="rounded-xl px-4 py-3 mb-3 text-xs"
        style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#78350f' }}
      >
        <div className="font-semibold mb-2">{t('csv.notesTitle')}</div>
        <ul className="space-y-1.5" style={{ paddingLeft: 16, margin: 0 }}>
          {noteKeys.map((k) => (
            <li key={k} dangerouslySetInnerHTML={{ __html: t(k) }} />
          ))}
        </ul>
      </div>

      {isDetail && (
        <div
          className="rounded-xl px-4 py-3 mb-3 text-xs"
          style={{ background: '#f0fdf4', border: '1px solid #86efac', color: '#166534' }}
        >
          <div className="font-semibold mb-2">{t('csv.privacyTitle')}</div>
          <ul className="space-y-1.5" style={{ paddingLeft: 16, margin: 0 }}>
            {privacyKeys.map((k) => (
              <li key={k} dangerouslySetInnerHTML={{ __html: t(k) }} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function ResultPanel({ result }: { result: CsvUploadResult & { newConversions?: number; multiCodeUsers?: Array<{ user: string; codes: string[] }> } }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      {result.processed > 0 && (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d' }}
        >
          {result.totalPaid !== undefined && result.totalPaid > 0
            ? t('csv.resultPaid', { n: result.processed, conv: result.newConversions ?? 0, paid: Number(result.totalPaid).toLocaleString() })
            : t('csv.resultProcessed', { n: result.processed, conv: result.newConversions ?? 0 })}
        </div>
      )}

      {result.skippedCodes && result.skippedCodes.length > 0 && (() => {
        const hints: Record<string, string> = {}
        ;(result.skippedHints || []).forEach((h) => { hints[h.code] = h.belongsTo })
        return (
          <div
            className="rounded-xl px-4 py-3 text-xs"
            style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}
          >
            <div className="font-semibold mb-1.5">{t('csv.skippedTitle', { n: result.skippedCodes.length })}</div>
            <div className="space-y-1">
              {result.skippedCodes.map((c) => (
                <div key={c} style={{ fontFamily: 'monospace' }}>
                  {c} — {hints[c] ? t('csv.codeBelongsTo', { title: hints[c] }) : t('csv.codeNotFound')}
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {result.blockedCodes && result.blockedCodes.length > 0 && (
        <div
          className="rounded-xl px-4 py-3 text-xs"
          style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}
        >
          <div className="font-semibold mb-1">{t('csv.blockedTitle')}</div>
          <div style={{ fontFamily: 'monospace' }}>{result.blockedCodes.join(', ')}</div>
        </div>
      )}

      {result.multiCodeUsers && result.multiCodeUsers.length > 0 && (
        <div
          className="rounded-xl px-4 py-3 text-xs"
          style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#78350f' }}
        >
          <div className="font-semibold mb-1.5">{t('csv.multiCodeTitle', { n: result.multiCodeUsers.length })}</div>
          <div className="space-y-1 mb-2">
            {result.multiCodeUsers.map((m) => (
              <div key={m.user} style={{ fontFamily: 'monospace' }}>{m.user} → {(m.codes || []).join(' + ')}</div>
            ))}
          </div>
          <div>{t('csv.multiCodeHint')}</div>
        </div>
      )}

      {result.processed === 0 && (!result.skippedCodes || result.skippedCodes.length === 0) && (
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}
        >
          {t('csv.errNoProcessed')}
        </div>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────

export default function DataUpload() {
  const { t } = useTranslation()
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [csvText, setCsvText] = useState('')
  const [parseError, setParseError] = useState<ParseError | null>(null)
  /** 解析通过后的待确认批次：结算真金白银，先给商家"最后一眼" */
  const [preview, setPreview] = useState<{ records: CsvRecord[]; convertedCount: number; keyMode: 'ID' | 'EMAIL' } | null>(null)
  const [uploadResult, setUploadResult] = useState<any>(null)
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: tasksData } = useQuery({
    queryKey: ['tasks', 'performance', user?.id],
    queryFn: () => tasksApi.list({ page: 1, creator: user?.id }).then((r) => r.data),
    enabled: !!user?.id,
  })

  const perfTasks = (tasksData?.tasks || []).filter((task) =>
    task.mode === 'PERFORMANCE' && (task.status === 'OPEN' || task.status === 'COMPLETED')
  )
  const selectedTask = perfTasks.find((task) => task.id === selectedTaskId)
  const dataMode: 'AGGREGATE' | 'DETAIL' = selectedTask?.data_mode === 'DETAIL' ? 'DETAIL' : 'AGGREGATE'

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setCsvText(ev.target?.result as string)
    reader.readAsText(file, 'utf-8')
  }, [])

  const mutation = useMutation({
    mutationFn: ({ records }: { records: CsvRecord[] }) =>
      tasksApi.uploadCsv(selectedTaskId, records).then((r) => r.data),
    onSuccess: (data) => { setUploadResult(data); setPreview(null) },
  })

  /** 第一步：只解析，不提交 —— 解析结果进预览区等商家确认 */
  const handleParse = (e: React.FormEvent) => {
    e.preventDefault()
    setUploadResult(null)
    setParseError(null)
    setPreview(null)

    const result = parseCsv(csvText, dataMode)
    if (!result.ok) { setParseError(result.error); return }
    setPreview({ records: result.records, convertedCount: result.convertedCount, keyMode: result.keyMode })
  }

  const resetInput = () => { setUploadResult(null); setParseError(null); setPreview(null) }

  if (tasksData && perfTasks.length === 0) {
    return (
      <div className="flex flex-col min-h-screen">
        <Topbar title={t('nav.csv')} />
        <div className="p-7 flex-1 flex items-center justify-center">
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📤</div>
            <div className="text-sm font-medium mb-1">{t('csv.noTasks')}</div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>{t('csv.noTasksHint')}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Topbar title={t('nav.csv')} />
      <div className="p-7 flex-1">
        <div className="max-w-2xl mx-auto">
          <form onSubmit={handleParse} className="rounded-2xl p-6 space-y-5" style={{ background: '#fff' }}>
            {/* Task selector */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#374151' }}>
                {t('csv.selectTask')}
              </label>
              <select
                value={selectedTaskId}
                onChange={(e) => { setSelectedTaskId(e.target.value); resetInput() }}
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--text)' }}
              >
                <option value="">{t('csv.selectTaskPh')}</option>
                {perfTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}{task.data_mode === 'DETAIL' ? ` [${t('csv.tagDetail')}]` : ` [${t('csv.tagAggregate')}]`}
                  </option>
                ))}
              </select>
            </div>

            {/* Mode block */}
            {selectedTask && <ModeBlock task={selectedTask} />}

            {/* CSV input */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium" style={{ color: '#374151' }}>
                  {t('csv.pasteOrChoose')}
                </label>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors hover:bg-gray-50"
                  style={{ border: '1px solid var(--border)', color: '#374151' }}
                >
                  {t('csv.chooseFile')}
                </button>
                <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileChange} />
              </div>
              <textarea
                value={csvText}
                onChange={(e) => { setCsvText(e.target.value); resetInput() }}
                rows={8}
                placeholder={t('csv.pastePlaceholder')}
                className="w-full rounded-xl px-3 py-2.5 text-sm resize-y outline-none"
                style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--text)', fontFamily: 'monospace', lineHeight: 1.6 }}
              />
            </div>

            {/* Parse error */}
            {parseError && (
              <div
                className="rounded-xl px-4 py-3 text-sm"
                style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}
              >
                {(() => {
                  const p = { ...(parseError.params || {}) } as Record<string, unknown>
                  // hint 为空时不要留下悬空的"疑似拼写错误："前缀
                  if (p.hint) p.hint = `${t('csv.hintPrefix')}${p.hint}`
                  return t(parseError.errorKey, p as any) as string
                })()}
              </div>
            )}

            {/* 预览确认：解析结果核对无误后才真正提交（结算不可逆） */}
            {preview && (
              <div
                className="rounded-xl px-4 py-3 text-sm space-y-2"
                style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534' }}
              >
                <div className="font-semibold">{t('csv.previewTitle')}</div>
                <div className="flex justify-between"><span>{t('csv.previewRows')}</span><span className="font-mono font-semibold">{preview.records.length}</span></div>
                <div className="flex justify-between">
                  <span>{t('csv.previewConverted')}</span>
                  <span className="font-mono font-semibold" style={preview.convertedCount === 0 ? { color: '#dc2626' } : undefined}>
                    {preview.convertedCount}
                  </span>
                </div>
                <div className="flex justify-between"><span>{t('csv.previewKeyMode')}</span><span className="font-mono">{t(preview.keyMode === 'ID' ? 'csv.keyModeId' : 'csv.keyModeEmail')}</span></div>
                {preview.convertedCount === 0 && (
                  <div className="pt-1" style={{ color: '#dc2626' }}>{t('csv.previewZeroWarn')}</div>
                )}
                <div className="pt-1 text-xs" style={{ color: '#15803d' }}>{t('csv.previewHint')}</div>
                <button
                  type="button"
                  onClick={() => mutation.mutate({ records: preview.records })}
                  disabled={mutation.isPending}
                  className="w-full mt-1 py-2 rounded-lg text-sm font-semibold text-white transition-opacity disabled:opacity-40"
                  style={{ background: '#16a34a' }}
                >
                  {mutation.isPending ? t('csv.uploading') : t('csv.previewConfirm')}
                </button>
              </div>
            )}

            {/* API error */}
            {mutation.isError && (
              <div
                className="rounded-xl px-4 py-3 text-sm"
                style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}
              >
                {(() => {
              const data = (mutation.error as any)?.response?.data
              if (data?.code === 'MASKED_USER_REQUIRES_ID')
                return t('csv.errMaskedRequiresId', { n: (data.rows || []).length, rows: (data.rows || []).slice(0, 5).join(', ') })
              if (data?.code === 'INCONSISTENT_KEY_MODE')
                return t('csv.errMixedKeyMode')
              if (data?.code === 'KEY_MODE_LOCKED')
                return t('csv.errKeyModeLocked', {
                  locked: t(data.lockedMode === 'ID' ? 'csv.keyModeId' : 'csv.keyModeEmail'),
                  got: t(data.gotMode === 'ID' ? 'csv.keyModeId' : 'csv.keyModeEmail'),
                })
              return data?.error || (mutation.error as Error)?.message || t('csv.uploadError')
            })()}
              </div>
            )}

            {/* Upload result */}
            {uploadResult && <ResultPanel result={uploadResult} />}

            {/* 第一步：解析校验（真正提交在预览区确认后） */}
            <button
              type="submit"
              disabled={!selectedTaskId || !csvText.trim() || mutation.isPending}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-40"
              style={{ background: 'var(--primary)' }}
            >
              {t('csv.parseAndPreview')}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
