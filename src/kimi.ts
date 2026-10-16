// Kimi Coding Plan 用量适配器（迁自 dsh-plugin-custom-providers 的
// src/providers/kimi.ts，接口契约与解析逻辑逐段一致）。
//
// 端点：GET {baseUrl}/usages，baseUrl 默认 https://api.kimi.com/coding/v1
//       （海外 api.kimi.ai 经 settings 覆盖）
// 认证：Authorization: Bearer <Console sk- key>（与模型推理同一把）
// 字段映射（社区逆向，多项目印证；响应数值可能是字符串）：
//   usage            → weekly（老套餐周配额；缺省则跳过）
//   limits[] window.duration=300 + TIME_UNIT_MINUTE → window-5h
//   totalQuota       → monthly
//   旧版 usages[]（scope FEATURE_CODING 嵌套）→ 兼容解析
//   鉴权失败：error.code=invalid_auth / code=unauthenticated → auth

import {
  AdapterError,
  type QuotaEntry,
  isRecord,
  pickTime,
  redact,
  toNumber,
} from './model.ts'

export const KIMI_DEFAULT_BASE_URL = 'https://api.kimi.com/coding/v1'

/** 凭证仅允许附带到这些 canonical host（§6 出站立减），不跟随重定向 */
const CREDENTIAL_HOSTS = new Set(['api.kimi.com', 'api.kimi.ai'])

const RESET_VARIANTS = ['resetTime', 'reset_at', 'resetAt', 'reset_time']

export interface KimiUsage {
  planName?: string
  quotas: QuotaEntry[]
}

function parseDetail(detail: unknown, kind: QuotaEntry['kind'], label: string): QuotaEntry | undefined {
  if (!isRecord(detail)) return undefined
  const limit = toNumber(detail.limit)
  const used = toNumber(detail.used)
  const remaining = toNumber(detail.remaining)
  const resetAt = pickTime(detail, RESET_VARIANTS)
  if (limit === undefined && used === undefined && remaining === undefined) return undefined
  return {
    kind,
    label,
    limit,
    used,
    remaining,
    percentUsed:
      limit != null && limit > 0 && used != null
        ? Math.round((used / limit) * 1000) / 10
        : undefined,
    resetAt,
  }
}

/** 解析 /coding/v1/usages 响应体（新版 + 旧版 usages[] 嵌套格式）。失败抛 AdapterError。 */
export function parseKimiUsage(json: unknown): KimiUsage {
  if (!isRecord(json)) throw new AdapterError('parse', 'Kimi 响应不是 JSON 对象')

  // 鉴权失败形态：{ error: { code: 'invalid_auth' } } 或 { code: 'unauthenticated' }
  if (isRecord(json.error) && (json.error.code === 'invalid_auth' || json.error.code === 'unauthenticated')) {
    throw new AdapterError('auth', 'Kimi 凭证无效或已过期')
  }
  if (json.code === 'unauthenticated') throw new AdapterError('auth', 'Kimi 凭证无效或已过期')

  const quotas: QuotaEntry[] = []

  // 新版格式：usage（周配额）/ limits[]（窗口配额）/ totalQuota（月度总额度）
  const weekly = parseDetail(json.usage, 'weekly', '每周')
  if (weekly) quotas.push(weekly)

  if (Array.isArray(json.limits)) {
    for (const item of json.limits) {
      if (!isRecord(item)) continue
      const win = isRecord(item.window) ? item.window : {}
      const is5h =
        toNumber(win.duration) === 300 &&
        (win.timeUnit === 'TIME_UNIT_MINUTE' || win.timeUnit === 'TIME_UNIT_MINUTES')
      if (!is5h) continue
      const q = parseDetail(item.detail, 'window-5h', '5 小时窗口')
      if (q) quotas.push(q)
    }
  }

  const monthly = parseDetail(json.totalQuota, 'monthly', '月度总额度')
  if (monthly) quotas.push(monthly)

  // 旧版格式：usages[] 嵌套（scope FEATURE_CODING 项）
  if (Array.isArray(json.usages)) {
    for (const item of json.usages) {
      if (!isRecord(item)) continue
      if (item.scope !== undefined && item.scope !== 'FEATURE_CODING') continue
      const w = parseDetail(item.detail, 'weekly', '每周')
      if (w) quotas.push(w)
      if (Array.isArray(item.limits)) {
        for (const l of item.limits) {
          if (!isRecord(l)) continue
          const q = parseDetail(l.detail, 'window-5h', '5 小时窗口')
          if (q) quotas.push(q)
        }
      }
    }
  }

  if (quotas.length === 0) throw new AdapterError('parse', 'Kimi 响应中未识别到配额字段')
  return { quotas }
}

export interface FetchKimiOptions {
  baseUrl: string
  apiKey: string
  timeoutMs: number
  fetchImpl?: typeof fetch
}

export async function fetchKimiUsage(opts: FetchKimiOptions): Promise<KimiUsage> {
  const fetchImpl = opts.fetchImpl ?? fetch
  // 相对路径追加（无前导 /）：前导 / 会被 URL 解析为根绝对路径，
  // 丢掉 baseUrl 的 /coding/v1 前缀导致 404（2026-09-28 实测定位）
  const url = new URL('usages', ensureTrailingSlash(opts.baseUrl))

  // §6：非白名单 canonical host 不附带凭证头
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (CREDENTIAL_HOSTS.has(url.hostname)) {
    headers.Authorization = `Bearer ${opts.apiKey}`
  }

  let res: Response
  try {
    res = await fetchImpl(url, {
      headers,
      redirect: 'manual', // 不跟随重定向，防 key 泄漏
      signal: AbortSignal.timeout(opts.timeoutMs),
    })
  } catch (err) {
    throw mapFetchError(err)
  }
  if (res.status >= 300 && res.status < 400) {
    throw new AdapterError('network', `Kimi 端点发生重定向（${res.status}），已按安全策略拒绝跟随`)
  }
  if (res.status === 401 || res.status === 403) {
    throw new AdapterError('auth', 'Kimi 凭证无效或已过期')
  }
  if (res.status === 429) throw new AdapterError('rate-limit', 'Kimi 端点限流，请稍后重试')
  if (!res.ok) {
    const snippet = redact(await safeText(res), [opts.apiKey])
    throw new AdapterError('unknown', `Kimi 请求失败（HTTP ${res.status}）：${snippet}`)
  }

  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new AdapterError('parse', 'Kimi 响应不是合法 JSON')
  }
  return parseKimiUsage(json)
}

function ensureTrailingSlash(base: string): string {
  return base.endsWith('/') ? base : base + '/'
}

function mapFetchError(err: unknown): AdapterError {
  const name = err instanceof Error ? err.name : ''
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new AdapterError('network', 'Kimi 请求超时')
  }
  return new AdapterError('network', `Kimi 网络请求失败：${err instanceof Error ? err.message : String(err)}`)
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200)
  } catch {
    return ''
  }
}
