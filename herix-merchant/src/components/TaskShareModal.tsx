import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Download, Copy, Check } from 'lucide-react'
import { tasksApi, type Task } from '@/lib/api'
import { buildTaskShareConfig, type TaskShareConfig } from '@/lib/taskShare'

// ── Canvas utilities ──────────────────────────────────────────────

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxWidth) {
      if (cur) lines.push(cur)
      cur = ch
    } else {
      cur += ch
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'

async function generatePosterBlob(
  config: TaskShareConfig,
  qrSrc: string,
  scanLabel: string,
  poweredBy: string,
): Promise<Blob> {
  const W = 750, H = 1000

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  const [qrImg, logoImg] = await Promise.all([
    loadImage(qrSrc),
    config.brandLogo ? loadImage(config.brandLogo) : Promise.resolve(null),
  ])

  // ── Background ───────────────────────────────────────────────────
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // ── Header gradient bar ──────────────────────────────────────────
  const hGrad = ctx.createLinearGradient(0, 0, W, 0)
  hGrad.addColorStop(0, '#ff4c2b')
  hGrad.addColorStop(1, '#ff7b54')
  ctx.fillStyle = hGrad
  ctx.fillRect(0, 0, W, 88)

  ctx.textBaseline = 'middle'

  // Herix wordmark
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold 36px ${FONT}`
  ctx.textAlign = 'left'
  ctx.fillText('Herix', 44, 44)

  // Type badge
  ctx.font = `500 22px ${FONT}`
  const badgeTextW = ctx.measureText(config.typeLabel).width
  const badgePad = 18
  const badgeW = badgeTextW + badgePad * 2
  const badgeX = W - 44 - badgeW
  ctx.fillStyle = 'rgba(255,255,255,0.22)'
  roundRect(ctx, badgeX, 20, badgeW, 48, 24)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.fillText(config.typeLabel, badgeX + badgeW / 2, 44)
  ctx.textAlign = 'left'

  // ── Brand logo ───────────────────────────────────────────────────
  if (logoImg) {
    const sz = 80
    const lx = W - 44 - sz, ly = 110
    ctx.save()
    roundRect(ctx, lx, ly, sz, sz, 14)
    ctx.clip()
    ctx.drawImage(logoImg, lx, ly, sz, sz)
    ctx.restore()
    ctx.strokeStyle = '#e5e7eb'
    ctx.lineWidth = 2
    roundRect(ctx, lx, ly, sz, sz, 14)
    ctx.stroke()
  }

  // ── Task title ───────────────────────────────────────────────────
  ctx.fillStyle = '#111827'
  ctx.font = `bold 50px ${FONT}`
  ctx.textBaseline = 'alphabetic'
  const titleLines = wrapText(ctx, config.title, W - 88).slice(0, 2)
  titleLines.forEach((line, i) => ctx.fillText(line, 44, 190 + i * 66))

  // ── Divider ──────────────────────────────────────────────────────
  const divY = titleLines.length > 1 ? 300 : 250
  ctx.strokeStyle = '#f3f4f6'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(44, divY)
  ctx.lineTo(W - 44, divY)
  ctx.stroke()

  // ── Payout ───────────────────────────────────────────────────────
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#6b7280'
  ctx.font = `24px ${FONT}`
  ctx.fillText(config.payoutLabel, 44, divY + 48)

  ctx.fillStyle = '#ff4c2b'
  ctx.font = `bold 68px ${FONT}`
  ctx.fillText(config.payoutDisplay, 44, divY + 130)

  // ── QR section ───────────────────────────────────────────────────
  const qrSecY = 520
  ctx.fillStyle = '#f9fafb'
  ctx.fillRect(0, qrSecY, W, H - 60 - qrSecY)

  if (qrImg) {
    const qrSize = 220
    const qrX = (W - qrSize) / 2
    const qrY = qrSecY + 50

    // white card shadow
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.07)'
    ctx.shadowBlur = 20
    ctx.shadowOffsetY = 4
    ctx.fillStyle = '#ffffff'
    roundRect(ctx, qrX - 22, qrY - 22, qrSize + 44, qrSize + 44, 20)
    ctx.fill()
    ctx.restore()

    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize)

    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#6b7280'
    ctx.font = `24px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillText(scanLabel, W / 2, qrY + qrSize + 52)
    ctx.textAlign = 'left'
  }

  // ── Footer ───────────────────────────────────────────────────────
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, H - 60, W, 60)
  ctx.strokeStyle = '#e5e7eb'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, H - 60)
  ctx.lineTo(W, H - 60)
  ctx.stroke()

  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#9ca3af'
  ctx.font = `20px ${FONT}`
  ctx.textAlign = 'left'
  ctx.fillText(poweredBy, 44, H - 30)
  ctx.textAlign = 'right'
  ctx.fillText('herix.huaxuex.com', W - 44, H - 30)

  return new Promise((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('canvas blob failed')), 'image/png')
  )
}

// ── Language options for poster ───────────────────────────────────

const POSTER_LANGS = [
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
  { code: 'en', label: 'EN' },
  { code: 'ko', label: '한국어' },
] as const
type PosterLang = typeof POSTER_LANGS[number]['code']

// ── Modal component ───────────────────────────────────────────────

export function TaskShareModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const { t, i18n } = useTranslation()

  const defaultLang = ((): PosterLang => {
    const l = i18n.language
    if (l.startsWith('ja')) return 'ja'
    if (l.startsWith('ko')) return 'ko'
    if (l.startsWith('en')) return 'en'
    return 'zh'
  })()

  const [posterLang, setPosterLang] = useState<PosterLang>(defaultLang)
  const [posterUrl, setPosterUrl] = useState<string | null>(null)
  const [generating, setGenerating] = useState(true)
  const [shortUrl, setShortUrl] = useState<string | null>(null)
  const [copiedLink, setCopiedLink] = useState(false)

  const weappQrUrl = tasksApi.getWeappQrUrl(task.id)
  const h5Url = `${window.location.origin}/app/#/pages/landing/index?task=${task.id}`
  const h5QrUrl = `/api/qr?data=${encodeURIComponent(h5Url)}`

  useEffect(() => {
    // 短链（幂等，已存在则复用）— 只跑一次
    tasksApi.getShortLink(task.id)
      .then(r => setShortUrl(r.data.url))
      .catch(() => setShortUrl(h5Url))
  }, [task.id])

  useEffect(() => {
    // 生成海报：用目标语言的 t 函数渲染标签
    const posterT = i18n.getFixedT(posterLang)
    const posterConfig = buildTaskShareConfig(task, posterT)
    const token = localStorage.getItem('herix-merchant-token') ?? ''

    setGenerating(true)
    setPosterUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })

    async function build() {
      let qrSrc = h5QrUrl
      try {
        const resp = await fetch(weappQrUrl, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (resp.ok) {
          const blob = await resp.blob()
          qrSrc = URL.createObjectURL(blob)
        }
      } catch { /* fall through to H5 QR */ }

      const blob = await generatePosterBlob(
        posterConfig, qrSrc,
        posterT('share.scanHint'),
        posterT('share.poweredBy'),
      )
      if (qrSrc.startsWith('blob:')) URL.revokeObjectURL(qrSrc)
      return URL.createObjectURL(blob)
    }

    let objUrl: string | null = null
    build()
      .then(url => { objUrl = url; setPosterUrl(url) })
      .catch(console.error)
      .finally(() => setGenerating(false))

    return () => { if (objUrl) URL.revokeObjectURL(objUrl) }
  }, [task.id, posterLang])

  function savePoster() {
    if (!posterUrl) return
    const a = document.createElement('a')
    a.href = posterUrl
    a.download = `herix-task-${task.id}-${posterLang}.png`
    a.click()
  }

  function copyShareText() {
    if (!shortUrl) return
    const posterT = i18n.getFixedT(posterLang)
    const text = posterT('share.shareText', { title: task.title, url: shortUrl })
    navigator.clipboard.writeText(text).then(() => {
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden">

        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
            {t('share.modalTitle')}
          </span>
          <button onClick={onClose} style={{ color: 'var(--muted)' }}>
            <X size={18} />
          </button>
        </div>

        {/* Poster language selector */}
        <div className="flex items-center gap-2 px-5 pt-4">
          <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>
            {t('share.posterLangLabel')}
          </span>
          <div className="flex gap-1.5 flex-wrap">
            {POSTER_LANGS.map(({ code, label }) => (
              <button
                key={code}
                onClick={() => setPosterLang(code)}
                className="px-2.5 py-0.5 rounded-full text-xs font-medium transition-all"
                style={posterLang === code
                  ? { background: 'var(--primary)', color: '#fff' }
                  : { background: 'var(--surface-2, #f3f4f6)', color: 'var(--muted)' }
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Poster preview */}
        <div className="px-5 pt-3 pb-2">
          <div
            className="w-full rounded-xl overflow-hidden flex items-center justify-center"
            style={{ background: '#f3f4f6', aspectRatio: '3/4', maxHeight: 320 }}
          >
            {generating ? (
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                {t('share.generating')}
              </span>
            ) : posterUrl ? (
              <img src={posterUrl} alt="share poster" className="w-full h-full object-contain" />
            ) : (
              <span className="text-xs" style={{ color: 'var(--muted)' }}>—</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 mt-2 space-y-3">
          <button
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity"
            style={{ background: 'var(--primary)' }}
            onClick={savePoster}
            disabled={!posterUrl || generating}
          >
            <Download size={15} />
            {t('share.savePoster')}
          </button>

          <button
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold border disabled:opacity-40 transition-opacity"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            onClick={copyShareText}
            disabled={!shortUrl}
          >
            {copiedLink
              ? <Check size={15} style={{ color: '#16a34a' }} />
              : <Copy size={15} />}
            {copiedLink ? t('share.copied') : t('share.copyLink')}
          </button>
          <p className="text-center text-xs" style={{ color: 'var(--muted)' }}>
            {t('share.linkLangHint')}
          </p>
        </div>
      </div>
    </div>
  )
}
