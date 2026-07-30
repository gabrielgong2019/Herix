/** 平台支持的语言列表 — 单一事实源，新增语言只改此文件 */
export const LOCALES = [
  { code: 'zh', label: '中文',       isDefaultTarget: false },
  { code: 'ja', label: '日本語',     isDefaultTarget: true  },
  { code: 'en', label: 'English',    isDefaultTarget: true  },
  { code: 'ko', label: '한국어',     isDefaultTarget: true  },
  { code: 'vi', label: 'Tiếng Việt', isDefaultTarget: true  },
] as const;

export type LocaleCode = typeof LOCALES[number]['code'];

/** 满足 z.enum() 要求的非空元组，直接用于 Zod schema */
export const LOCALE_CODES = LOCALES.map(l => l.code) as unknown as [LocaleCode, ...LocaleCode[]];

/** 任务主语言为空（全量受众）时的默认翻译目标（isDefaultTarget=true 的语言）*/
export const DEFAULT_TARGET_LOCALES: string[] = LOCALES
  .filter(l => l.isDefaultTarget)
  .map(l => l.code);

/** 翻译管道支持的全部语言（含源语言），用于合法性过滤 */
export const SUPPORTED_LOCALES = new Set<string>(LOCALES.map(l => l.code));
