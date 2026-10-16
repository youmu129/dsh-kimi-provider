// Kimi 用量适配器与 store 行为校验：
// 1. parseKimiUsage：新版 / 旧版 usages[] 嵌套 / 实测干扰形态各变体
//    （fixtures 迁自 dsh-plugin-custom-providers 的 kimi-parse.test.ts）；
// 2. fetchKimiUsage：URL 前缀追加回归、凭证 host 白名单、重定向/鉴权/限流/
//    超时归类（fetchImpl stub 不触网，回归背景迁自 kimi-fetch.test.ts）；
// 3. UsageStore：成功快照、失败保留 stale、未配置态、ensureFresh 幂等。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AdapterError, AdapterUnconfiguredError } from '../src/model.ts'
import { fetchKimiUsage, parseKimiUsage } from '../src/kimi.ts'
import { UsageStore } from '../src/store.ts'

// opencodex 测试 fixture（调研报告 §1.2）：数值为字符串
const NEW_FORMAT = {
  user: { userId: 'u1', businessId: 'b1' },
  usage: { limit: '100', used: '15', remaining: '85', resetTime: '2026-07-24T12:20:50.442060Z' },
  limits: [
    {
      window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
      detail: { limit: '100', remaining: '100', resetTime: '2026-07-24T17:20:50Z' },
    },
  ],
  totalQuota: { limit: '100', remaining: '99' },
  subType: 'TYPE_PURCHASE',
}

// ---------------------------------------------------------------------------
// parseKimiUsage · 新版格式
// ---------------------------------------------------------------------------

test('parseKimiUsage maps weekly / window-5h / monthly quotas', () => {
  const r = parseKimiUsage(NEW_FORMAT)
  assert.equal(r.quotas.length, 3)
  const [weekly, win, monthly] = r.quotas
  assert.equal(weekly.kind, 'weekly')
  assert.equal(weekly.limit, 100)
  assert.equal(weekly.used, 15)
  assert.equal(weekly.remaining, 85)
  assert.equal(weekly.resetAt, '2026-07-24T12:20:50.442Z')
  assert.equal(win.kind, 'window-5h')
  assert.equal(win.limit, 100)
  assert.equal(monthly.kind, 'monthly')
  assert.equal(monthly.remaining, 99)
})

test('parseKimiUsage derives percentUsed from string-number used/limit', () => {
  const r = parseKimiUsage(NEW_FORMAT)
  assert.equal(r.quotas[0].percentUsed, 15)
})

test('parseKimiUsage skips weekly when usage is missing, keeps the rest', () => {
  const { usage: _drop, ...rest } = NEW_FORMAT
  const r = parseKimiUsage(rest)
  assert.equal(r.quotas.length, 2)
  assert.ok(r.quotas.every((q) => q.kind !== 'weekly'))
})

test('parseKimiUsage tries reset field name variants (reset_at / resetAt / reset_time)', () => {
  for (const variant of ['reset_at', 'resetAt', 'reset_time']) {
    const body = { usage: { limit: '10', used: '1', remaining: '9', [variant]: 1784300400 } }
    const r = parseKimiUsage(body)
    assert.equal(r.quotas[0].kind, 'weekly')
    assert.equal(typeof r.quotas[0].resetAt, 'string')
  }
})

test('parseKimiUsage ignores non-5h window entries (duration != 300)', () => {
  const body = {
    limits: [
      { window: { duration: 60, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '9' } },
      { window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100' } },
    ],
  }
  const r = parseKimiUsage(body)
  assert.equal(r.quotas.length, 1)
  assert.equal(r.quotas[0].kind, 'window-5h')
})

test('parseKimiUsage fails when no quota field is recognized', () => {
  assert.throws(() => parseKimiUsage({ subType: 'TYPE_PURCHASE' }), AdapterError)
})

test('parseKimiUsage real-world form (2026-09): usages as object + booster_wallet noise', () => {
  // 线上真实响应同时携带新格式字段与 usages 对象形态；解析器应从新格式取数，
  // 忽略对象形态 usages 与 booster_wallet（兼容旧版数组形态的代码不误伤）。
  const body = {
    usage: { limit: '100', used: '15', remaining: '85', resetTime: '2026-10-02T09:56:21.277Z' },
    limits: [
      { window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100', used: '22', remaining: '78', resetTime: '2026-09-27T14:56:21.277Z' } },
    ],
    usages: { limit_5h: { used_ratio: 0.22, reset_time: '2026-09-27T14:56:21.277Z' }, limit_7d: { used_ratio: 0.15 } },
    booster_wallet: { id: 'w', balance: { priceInCents: '0' }, status: 'ACTIVE' },
  }
  const r = parseKimiUsage(body)
  assert.equal(r.quotas.length, 2)
  assert.equal(r.quotas[0].kind, 'weekly')
  assert.equal(r.quotas[1].kind, 'window-5h')
  assert.equal(r.quotas[1].used, 22)
})

// ---------------------------------------------------------------------------
// parseKimiUsage · 旧版 usages[] 嵌套格式
// ---------------------------------------------------------------------------

test('parseKimiUsage supports the legacy usages[] nesting (scope FEATURE_CODING)', () => {
  const body = {
    usages: [
      {
        scope: 'FEATURE_CODING',
        detail: { limit: '50', used: '5', remaining: '45', resetTime: '2026-07-25T00:00:00Z' },
        limits: [{ detail: { limit: '80', remaining: '60' } }],
      },
    ],
  }
  const r = parseKimiUsage(body)
  assert.equal(r.quotas.length, 2)
  assert.equal(r.quotas[0].kind, 'weekly')
  assert.equal(r.quotas[1].kind, 'window-5h')
})

test('parseKimiUsage ignores non-FEATURE_CODING scopes', () => {
  const body = { usages: [{ scope: 'FEATURE_CHAT', detail: { limit: '1' } }] }
  assert.throws(() => parseKimiUsage(body), AdapterError)
})

// ---------------------------------------------------------------------------
// parseKimiUsage · 鉴权失败
// ---------------------------------------------------------------------------

test('parseKimiUsage maps error.code=invalid_auth to auth', () => {
  assert.throws(() => parseKimiUsage({ error: { code: 'invalid_auth' } }), (e: unknown) => {
    assert.ok(e instanceof AdapterError)
    assert.equal(e.kind, 'auth')
    return true
  })
})

test('parseKimiUsage maps code=unauthenticated to auth', () => {
  assert.throws(() => parseKimiUsage({ code: 'unauthenticated' }), (e: unknown) => {
    assert.ok(e instanceof AdapterError)
    assert.equal(e.kind, 'auth')
    return true
  })
})

test('parseKimiUsage rejects non-object responses', () => {
  assert.throws(() => parseKimiUsage('not json'), (e: unknown) => {
    assert.ok(e instanceof AdapterError)
    assert.equal(e.kind, 'parse')
    return true
  })
})

// ---------------------------------------------------------------------------
// fetchKimiUsage（fetchImpl stub，不触网）
// ---------------------------------------------------------------------------

/** 捕获请求的假 fetch：记录 url 与 headers，返回固定 JSON */
function stubFetch(status: number, body: unknown) {
  const calls: Array<{ url: URL; headers: Record<string, string> }> = []
  const impl: typeof fetch = (async (input: any, init?: any) => {
    calls.push({ url: new URL(input.href ?? String(input)), headers: init?.headers ?? {} })
    return new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return { impl, calls }
}

const OK_BODY = {
  usage: { limit: '100', used: '15', remaining: '85', resetTime: '2026-07-24T12:20:50Z' },
  limits: [],
  totalQuota: { limit: '100', remaining: '99' },
}

const FETCH_OPTS = { baseUrl: 'https://api.kimi.com/coding/v1', apiKey: 'sk-test', timeoutMs: 1000 }

test('fetchKimiUsage appends /usages after the /coding/v1 prefix (regression)', async () => {
  // 回归背景：`new URL('/usages', base)` 的前导 / 是根绝对路径，会丢掉
  // baseUrl 的 /coding/v1 前缀，实际打到 https://api.kimi.com/usages（404）。
  const { impl, calls } = stubFetch(200, OK_BODY)
  const r = await fetchKimiUsage({ ...FETCH_OPTS, fetchImpl: impl })
  assert.equal(r.quotas.length, 2)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url.href, 'https://api.kimi.com/coding/v1/usages')
})

test('fetchKimiUsage keeps the path prefix on the overseas baseUrl override', async () => {
  const { impl, calls } = stubFetch(200, OK_BODY)
  await fetchKimiUsage({ ...FETCH_OPTS, baseUrl: 'https://api.kimi.ai/coding/v1', fetchImpl: impl })
  assert.equal(calls[0].url.href, 'https://api.kimi.ai/coding/v1/usages')
})

test('fetchKimiUsage attaches Bearer only on canonical hosts', async () => {
  const ok = stubFetch(200, OK_BODY)
  await fetchKimiUsage({ ...FETCH_OPTS, fetchImpl: ok.impl })
  assert.equal(ok.calls[0].headers.Authorization, 'Bearer sk-test')

  const foreign = stubFetch(200, OK_BODY)
  await fetchKimiUsage({ ...FETCH_OPTS, baseUrl: 'https://example.com/v1', fetchImpl: foreign.impl })
  assert.equal(foreign.calls[0].url.href, 'https://example.com/v1/usages')
  assert.equal(foreign.calls[0].headers.Authorization, undefined)
})

test('fetchKimiUsage refuses 3xx redirects by policy (redirect: manual)', async () => {
  const { impl } = stubFetch(302, null)
  await assert.rejects(
    () => fetchKimiUsage({ ...FETCH_OPTS, fetchImpl: impl }),
    (e: unknown) => e instanceof AdapterError && e.kind === 'network',
  )
})

test('fetchKimiUsage maps HTTP 401 to auth error', async () => {
  const { impl } = stubFetch(401, {})
  await assert.rejects(
    () => fetchKimiUsage({ ...FETCH_OPTS, fetchImpl: impl }),
    (e: unknown) => e instanceof AdapterError && e.kind === 'auth',
  )
})

test('fetchKimiUsage maps HTTP 429 to rate-limit error', async () => {
  const { impl } = stubFetch(429, {})
  await assert.rejects(
    () => fetchKimiUsage({ ...FETCH_OPTS, fetchImpl: impl }),
    (e: unknown) => e instanceof AdapterError && e.kind === 'rate-limit',
  )
})

test('fetchKimiUsage maps timeout to network error', async () => {
  const fetchImpl = (async () => {
    throw Object.assign(new Error('aborted'), { name: 'TimeoutError' })
  }) as typeof fetch
  await assert.rejects(
    () => fetchKimiUsage({ ...FETCH_OPTS, fetchImpl }),
    (e: unknown) => e instanceof AdapterError && e.kind === 'network',
  )
})

// ---------------------------------------------------------------------------
// UsageStore
// ---------------------------------------------------------------------------

test('UsageStore keeps ok snapshot with quotas', async () => {
  const store = new UsageStore(async () => parseKimiUsage(NEW_FORMAT))
  await store.refresh()
  const snap = store.snapshot()
  assert.equal(snap?.status, 'ok')
  assert.equal(snap?.quotas.length, 3)
  assert.ok(snap?.fetchedAt)
})

test('UsageStore preserves last ok data with stale flag on later failure', async () => {
  let fail = false
  const store = new UsageStore(async () => {
    if (fail) throw new AdapterError('network', 'Kimi 请求超时')
    return parseKimiUsage(NEW_FORMAT)
  })
  await store.refresh()
  fail = true
  await store.refresh()
  const snap = store.snapshot()
  assert.equal(snap?.status, 'error')
  assert.equal(snap?.stale, true)
  assert.equal(snap?.quotas.length, 3)
  assert.equal(snap?.error?.kind, 'network')
})

test('UsageStore maps unconfigured error without error field', async () => {
  const store = new UsageStore(async () => {
    throw new AdapterUnconfiguredError('Kimi 凭证未配置')
  })
  await store.refresh()
  const snap = store.snapshot()
  assert.equal(snap?.status, 'unconfigured')
  assert.equal(snap?.error, undefined)
})

test('UsageStore ensureFresh only refreshes once when a snapshot exists', async () => {
  let calls = 0
  const store = new UsageStore(async () => {
    calls += 1
    return parseKimiUsage(NEW_FORMAT)
  })
  await store.ensureFresh()
  await store.ensureFresh()
  assert.equal(calls, 1)
  assert.equal(store.snapshot()?.status, 'ok')
})

test('UsageStore ensureFresh surfaces error snapshot from a failing adapter', async () => {
  const store = new UsageStore(async () => {
    throw new AdapterError('parse', 'Kimi 响应不是合法 JSON')
  })
  await store.ensureFresh()
  assert.equal(store.snapshot()?.status, 'error')
  assert.equal(store.snapshot()?.error?.kind, 'parse')
})
