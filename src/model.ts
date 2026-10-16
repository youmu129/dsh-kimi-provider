// 统一用量模型（迁自 dsh-plugin-custom-providers 的 src/model.ts 使用子集，
// 单平台版无 PlatformId/快照工厂）。host 半面把 Kimi 接口归一化为本模型；
// 解析原则：容忍字段缺失（单字段失败只丢该字段）、数值兼容字符串、时间兼容
// ISO / epoch 秒 / epoch 毫秒，解析异常归一为 error.kind: 'parse'。

export type QuotaKind = 'window-5h' | 'weekly' | 'monthly' | 'other'

export interface QuotaEntry {
  /** 语义类别，供 UI i18n 映射到本地文案 */
  kind: QuotaKind
  /** 展示名（zh 固定文案，如 "5 小时窗口"）；kind 为 other 时 UI 直接显示该值 */
  label: string
  /** 总量（接口未提供则缺省，UI 以无进度条形式呈现） */
  limit?: number
  used?: number
  remaining?: number
  /** 0–100 */
  percentUsed?: number
  /** ISO 时间字符串 */
  resetAt?: string
}

export type UsageErrorKind = 'network' | 'auth' | 'rate-limit' | 'parse' | 'unknown'

export interface UsageError {
  kind: UsageErrorKind
  /** 用户可理解的摘要（已脱敏，不含凭证片段） */
  message: string
}

export class AdapterError extends Error {
  readonly kind: UsageErrorKind

  constructor(kind: UsageErrorKind, message: string) {
    super(message)
    this.kind = kind
    this.name = 'AdapterError'
  }
}

/**
 * 适配器"环境未就绪"信号（如凭证未录入）：host 侧捕获后映射为
 * snapshot.status = 'unconfigured'（该状态不带 error 字段）。
 */
export class AdapterUnconfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdapterUnconfiguredError'
  }
}

// ---------------------------------------------------------------------------
// 解析通用工具
// ---------------------------------------------------------------------------

/** 数值兼容字符串（Kimi 返回字符串数字），无法解析时返回 undefined */
export function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

/**
 * 时间兼容 ISO 字符串 / epoch 秒 / epoch 毫秒。返回 ISO 字符串；
 * 无法解析返回 undefined。
 */
export function toIsoTime(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') {
    const t = Date.parse(value)
    if (!Number.isNaN(t)) return new Date(t).toISOString()
    return undefined
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // 启发式：1e12 及以上视为 epoch 毫秒，否则按秒
    const ms = value >= 1e12 ? value : value * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
  }
  return undefined
}

/** 在对象上按候选名顺序取第一个可解析为时间的字段（Kimi resetTime 命名变体） */
export function pickTime(obj: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) {
    const iso = toIsoTime(obj[name])
    if (iso) return iso
  }
  return undefined
}

/** 从快照展示/日志前剔除可能的凭证片段 */
export function redact(text: string, secrets: Array<string | undefined>): string {
  let out = text
  for (const s of secrets) {
    if (s && s.length >= 8) out = out.split(s).join('<redacted>')
  }
  return out.slice(0, 500)
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
