/**
 * 需求单规则提取（P1，v1 纯规则版）
 *
 * 商家把线下需求单（微信里那种）粘进任务简报，本模块用正则识别高度模式化的
 * 表达（粉丝1000+/图片3张以上/视频30秒/8月10日交稿/改稿3次…），产出
 * 「建议式」补丁——面板展示识别结果，商家确认后才应用到表单字段。
 *
 * 设计原则（2026-07-25 方案定稿）：
 * 1. 建议式，不静默：识别错一个数字商家从此不敢用，必须过目确认
 * 2. 应用后结构化字段是唯一权威源，不做简报↔字段双向同步（漂移之源）
 * 3. 规则按任务类型分集：内容型才有图片/秒数/改稿，邀请码型不提取这些
 * 4. 提不出来的信息自然留在简报正文里，没有损失
 *
 * v2（LLM 提取）等本版命中率数据说话再立项。
 */

export interface ExtractHit {
  /** 表单字段名（与 TaskForm FormState 对齐） */
  field: string
  /** 面板展示用的 i18n label key（复用表单字段自己的 label） */
  labelKey: string
  /** 面板展示的识别值（人读的） */
  display: string
  /** 应用到 setForm 的补丁 */
  patch: Record<string, unknown>
}

const COMMUNITY_KEYWORDS: Array<[RegExp, string]> = [
  [/在日华人|在日中国/, 'cn-in-jp'],
  [/在日越南/, 'vn-in-jp'],
  [/在日韩/, 'kr-in-jp'],
  [/菲律宾/, 'ph-in-jp'],
  [/在澳华人|澳洲华人/, 'cn-in-au'],
  [/在美华人|美国华人/, 'cn-in-us'],
  [/在加华人|加拿大华人/, 'cn-in-ca'],
  [/在英华人|英国华人/, 'cn-in-uk'],
  [/在新华人|新加坡华人/, 'cn-in-sg'],
]

/** 「M月D日」→ ISO 日期。年份取当年，已过则顺延到明年（需求单从不写年份） */
function toIsoDate(month: number, day: number): string {
  const now = new Date()
  let year = now.getFullYear()
  const candidate = new Date(year, month - 1, day)
  if (candidate.getTime() < now.getTime() - 86400_000) year += 1
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

export function extractBrief(text: string, mode: 'STANDARD' | 'PERFORMANCE'): ExtractHit[] {
  const hits: ExtractHit[] = []
  if (!text || !text.trim()) return hits

  // 目标社群（两种类型通用）
  const communities = COMMUNITY_KEYWORDS.filter(([re]) => re.test(text)).map(([, id]) => id)
  if (communities.length) {
    hits.push({
      field: 'targetCommunities',
      labelKey: 'taskForm.fieldCommunity',
      display: communities.join(', '),
      patch: { targetCommunities: communities },
    })
  }

  // 招募人数（通用）
  const heralds = text.match(/(?:招募|需要|寻找|找)\s*(\d{1,3})\s*[名人位]/)
  if (heralds) {
    hits.push({
      field: 'maxHeralds',
      labelKey: 'taskForm.fieldMaxHeralds',
      display: `${heralds[1]}`,
      patch: { maxHeralds: Number(heralds[1]) },
    })
  }

  // 报酬（通用）：¥3,000 / 报酬3000日元 等
  const payout =
    text.match(/[¥￥]\s*([\d,，]{3,7})/) ||
    text.match(/(?:报酬|单价|每人|每单|佣金)[^\d\n]{0,8}([\d,，]{3,7})\s*(?:日元|円|元)?/)
  if (payout) {
    const n = Number(payout[1].replace(/[,，]/g, ''))
    if (n >= 100) {
      hits.push({
        field: 'payoutPerHerald',
        labelKey: 'taskForm.fieldPayout',
        display: `¥${n.toLocaleString()}`,
        patch: { payoutPerHerald: n },
      })
    }
  }

  // 截止日期（通用）：取文本里最后出现的「M月D日」当交付/结束时限
  //（多个日期时，前面的通常是中间里程碑——按 2026-07-25 决策不进字段，留在简报里）
  const dates = [...text.matchAll(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)]
  if (dates.length) {
    const last = dates[dates.length - 1]
    const iso = toIsoDate(Number(last[1]), Number(last[2]))
    if (mode === 'STANDARD') {
      hits.push({ field: 'submitDeadline', labelKey: 'taskForm.fieldSubmitDeadline', display: iso, patch: { submitDeadline: iso } })
    } else {
      hits.push({ field: 'deadline', labelKey: 'taskForm.fieldDeadline', display: iso, patch: { deadline: iso } })
    }
  }

  // ── 以下为内容创作型专属 ──
  if (mode === 'STANDARD') {
    const imgs = text.match(/图片\s*(\d{1,2})\s*张/)
    if (imgs) {
      hits.push({ field: 'minImages', labelKey: 'taskForm.fieldMinImages', display: `≥${imgs[1]}`, patch: { minImages: Number(imgs[1]) } })
    }

    const secs = text.match(/(?:视频|时长)[^\n。]*?(\d{1,4})\s*秒/)
    if (secs) {
      hits.push({ field: 'minVideoSeconds', labelKey: 'taskForm.fieldMinVideoSecs', display: `≥${secs[1]}s`, patch: { minVideoSeconds: Number(secs[1]) } })
    }

    const revs = text.match(/改稿[^\n。]*?(\d{1,2})\s*次/)
    if (revs) {
      hits.push({ field: 'maxRevisions', labelKey: 'taskForm.fieldMaxRevisions', display: `≤${revs[1]}`, patch: { maxRevisions: Number(revs[1]) } })
    }

    // 内容形式：图/视频“或”关系→either；图+视频都提→both；单提→对应类型
    const hasVideo = /视频/.test(text)
    const hasPhoto = /图片|图文|照片/.test(text)
    if (hasVideo || hasPhoto) {
      const isEither = /图片.{0,8}或.{0,8}视频|视频.{0,8}或.{0,8}图片/.test(text)
      const ct = isEither ? 'either' : hasVideo && hasPhoto ? 'both' : hasVideo ? 'video' : 'photo'
      const labelMap = { photo: 'taskForm.ctPhoto', video: 'taskForm.ctVideo', either: 'taskForm.ctEither', both: 'taskForm.ctBoth' } as const
      hits.push({ field: 'contentType', labelKey: labelMap[ct], display: '', patch: { contentType: ct } })
    }
  }

  return hits
}
