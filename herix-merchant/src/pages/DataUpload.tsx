import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { tasksApi, type Task, type CsvRecord, type CsvUploadResult } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { useAuth } from '@/contexts/AuthContext'

// ── CSV parsing ────────────────────────────────────────────────────

function findHeaderIdx(headers: string[], synonyms: string[]): number {
  for (let hi = 0; hi < headers.length; hi++) {
    for (const syn of synonyms) {
      if (headers[hi].includes(syn)) return hi
    }
  }
  return -1
}

type ParseResult =
  | { ok: true; records: CsvRecord[] }
  | { ok: false; errorKey: string }

function parseCsv(text: string, dataMode: 'AGGREGATE' | 'DETAIL'): ParseResult {
  const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return { ok: false, errorKey: 'csv.errMinRows' }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase())
  let codeIdx = headers.indexOf('code')
  if (codeIdx === -1) codeIdx = findHeaderIdx(headers, ['推广码', '紹介コード', 'referral'])
  if (codeIdx === -1) return { ok: false, errorKey: 'csv.errNoCodeCol' }

  const records: CsvRecord[] = []

  if (dataMode === 'DETAIL') {
    const userIdx = findHeaderIdx(headers, ['邮箱', '用户', 'メール', 'ユーザー', 'email', 'user'])
    const uniqueIdx = findHeaderIdx(headers, ['唯一id', '用户id', 'ユーザーid', 'unique id', 'uniqueid', 'user id'])
    const convIdx = findHeaderIdx(headers, ['交易', '转化', '取引', '成約', 'コンバージョン', 'convert', 'txn'])
    if (userIdx === -1 && uniqueIdx === -1) return { ok: false, errorKey: 'csv.errNoUserCol' }
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',')
      const code = (cols[codeIdx] || '').trim()
      const user = userIdx >= 0 ? (cols[userIdx] || '').trim() : ''
      const uniqueId = uniqueIdx >= 0 ? (cols[uniqueIdx] || '').trim() : ''
      if (!code || (!user && !uniqueId)) continue
      const convRaw = convIdx >= 0 ? (cols[convIdx] || '').trim() : '0'
      records.push({ code, user, uniqueId: uniqueId || undefined, converted: convRaw === '1' || /^true$/i.test(convRaw) })
    }
  } else {
    const regIdx = findHeaderIdx(headers, ['注册数', '登録数', 'registered', 'registrations', 'signups'])
    const usedIdx = findHeaderIdx(headers, ['使用数', '利用数', 'used', 'usage'])
    if (regIdx === -1 && usedIdx === -1) return { ok: false, errorKey: 'csv.errNoAggCols' }
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',')
      const code = (cols[codeIdx] || '').trim()
      if (!code) continue
      const reg = parseInt(cols[regIdx] || '0', 10)
      const used = parseInt(cols[usedIdx] || '0', 10)
      records.push({ code, registered_count: isNaN(reg) ? 0 : reg, used_count: isNaN(used) ? 0 : used })
    }
  }

  if (!records.length) return { ok: false, errorKey: 'csv.errNoValidRows' }
  return { ok: true, records }
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
  const [parseErrorKey, setParseErrorKey] = useState('')
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
    onSuccess: (data) => setUploadResult(data),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setUploadResult(null)
    setParseErrorKey('')

    const result = parseCsv(csvText, dataMode)
    if (!result.ok) { setParseErrorKey(result.errorKey); return }
    mutation.mutate({ records: result.records })
  }

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
          <form onSubmit={handleSubmit} className="rounded-2xl p-6 space-y-5" style={{ background: '#fff' }}>
            {/* Task selector */}
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: '#374151' }}>
                {t('csv.selectTask')}
              </label>
              <select
                value={selectedTaskId}
                onChange={(e) => {
                  setSelectedTaskId(e.target.value)
                  setUploadResult(null)
                  setParseErrorKey('')
                }}
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
                onChange={(e) => { setCsvText(e.target.value); setUploadResult(null); setParseErrorKey('') }}
                rows={8}
                placeholder={t('csv.pastePlaceholder')}
                className="w-full rounded-xl px-3 py-2.5 text-sm resize-y outline-none"
                style={{ border: '1px solid var(--border)', background: '#fff', color: 'var(--text)', fontFamily: 'monospace', lineHeight: 1.6 }}
              />
            </div>

            {/* Parse error */}
            {parseErrorKey && (
              <div
                className="rounded-xl px-4 py-3 text-sm"
                style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}
              >
                {t(parseErrorKey)}
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
              return data?.error || (mutation.error as Error)?.message || t('csv.uploadError')
            })()}
              </div>
            )}

            {/* Upload result */}
            {uploadResult && <ResultPanel result={uploadResult} />}

            {/* Submit */}
            <button
              type="submit"
              disabled={!selectedTaskId || !csvText.trim() || mutation.isPending}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-40"
              style={{ background: 'var(--primary)' }}
            >
              {mutation.isPending ? t('csv.uploading') : t('csv.upload')}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
