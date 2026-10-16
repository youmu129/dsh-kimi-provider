// 与 host 半面 /api/kimi-usage/* 路由通信（同源 fetch，认证 cookie 由 Connection 统一负责）

/** Kimi 配额行（与 host 半面 model.ts 的 QuotaEntry 同构） */
export interface QuotaDto {
  kind: 'window-5h' | 'weekly' | 'monthly' | 'other'
  label: string
  limit?: number
  used?: number
  remaining?: number
  percentUsed?: number
  resetAt?: string
}

/** Kimi 用量快照（与 host 半面 store.ts 的 UsageSnapshot 同构） */
export interface UsageSnapshotDto {
  status: 'ok' | 'error' | 'unconfigured'
  planName?: string
  quotas: QuotaDto[]
  fetchedAt?: string
  stale?: boolean
  error?: { kind: string; message: string }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

export const api = {
  usage: () => request<{ snapshot: UsageSnapshotDto | undefined }>('/api/kimi-usage/usage'),
  refresh: () =>
    request<{ snapshot: UsageSnapshotDto | undefined }>('/api/kimi-usage/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }),
}
