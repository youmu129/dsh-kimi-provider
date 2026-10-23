// 播种器静态校验：
// 1. 种子 profile 满足 llm-pi-ai 手写路由的硬性要求（api、baseURL、非空
//    models —— 缺失会提交到 Host 才被拒）；
// 2. 迁移基准守卫：关键字段与 dsh-plugin-custom-providers 的
//    kimi-coding-plan 定义一致（含 compat 段与 off 空映射）；
// 3. patch 不目标 `llm-pi-ai` 行（多 bundle 覆盖问题的回归守卫）；
// 4. shouldSeed 判定：路由存在（任意层）即跳过；
// 5. apply 等 loader settle 后再注册用量路由（挂载顺序回归守卫）；
// 6. 凭证缺失时 usage 路由返回 unconfigured 快照（不报错）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, name, seedProfile, shouldSeed } from '../src/index.ts'

const root = fileURLToPath(new URL('..', import.meta.url))

test('seed profile satisfies the hand-declared route requirements', () => {
  const profile = seedProfile()
  assert.ok(profile.api.length > 0, 'api 必填')
  assert.ok(/^https?:\/\//.test(profile.baseURL), 'baseURL 必须是 http(s) URL')
  assert.ok(profile.apiKeyEnv.length > 0, 'apiKeyEnv 必填（凭证引用名）')
  assert.ok(profile.models.length > 0, '手写路由至少一个模型，否则 Host 以 resolves no models 拒绝')
  for (const model of profile.models) {
    assert.ok(model.id.length > 0, '模型 id 必填')
    assert.ok(model.contextWindow > 0, '模型 contextWindow 必须为正')
    assert.ok(model.input.length > 0, '模型 input 非空')
    assert.ok(Object.keys(model.reasoningEfforts).length > 0, '模型需声明推理等级映射')
  }
})

test('seed profile matches the kimi-coding-plan baseline plus the K3.1 Pro series', () => {
  // 迁移基准：repos/dsh-plugin-custom-providers/cordis.patch.yml 的 kimi-coding-plan 段
  const profile = seedProfile()
  assert.equal(profile.displayName, 'Kimi Coding Plan')
  assert.equal(profile.apiKeyEnv, 'KIMI_CODING_PLAN_API_KEY')
  assert.equal(profile.api, 'openai-completions')
  assert.equal(profile.baseURL, 'https://api.kimi.com/coding/v1')
  assert.equal(profile.reasoning, 'max')
  assert.deepEqual(
    profile.models.map((m) => m.id),
    ['k3.1-pro', 'k3.1-pro-highspeed', 'k3-256k', 'k3', 'kimi-for-coding'],
  )
  // 基准定义带 compat 段（与 zhipu 不同），迁移保持一致
  assert.deepEqual(profile.compat, { supportsDeveloperRole: false, maxTokensField: 'max_tokens' })

  const baseline = profile.models.filter((m) => !m.id.startsWith('k3.1'))
  assert.deepEqual(baseline.map((m) => m.name), ['Kimi-K3-256k', 'Kimi-K3', 'Kimi-K2.8-Preview'])
  assert.deepEqual(baseline.map((m) => m.contextWindow), [262144, 1048576, 1048576])
  for (const model of baseline) {
    // 基准定义的 `off:` 空值 = 等级存在、线上不发送（llm-pi-ai 认可的写法）
    assert.deepEqual(model.reasoningEfforts, { off: null, low: 'low', high: 'high', max: 'max' })
    assert.deepEqual(model.input, ['text', 'image'])
  }

  // K3.1 Pro 系列：1M 上下文，只支持思考模式（关闭思考的请求被 400 拒绝 → 无 off 等级）
  const k31 = profile.models.filter((m) => m.id.startsWith('k3.1'))
  assert.deepEqual(k31.map((m) => m.name), ['Kimi-K3.1-Pro', 'Kimi-K3.1-Pro-Highspeed'])
  for (const model of k31) {
    assert.equal(model.contextWindow, 1048576)
    assert.deepEqual(model.reasoningEfforts, { low: 'low', high: 'high', max: 'max' })
    assert.deepEqual(model.input, ['text', 'image'])
  }
})

test('patch inserts own row and never targets the llm-pi-ai row', () => {
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  assert.ok(patch.includes('- id: dsh-kimi-provider'), 'patch 应插入 dsh-kimi-provider 自身挂载行')
  assert.ok(!/^\s*-\s+id:\s*llm-pi-ai\s*$/m.test(patch),
    'patch 不得目标 llm-pi-ai 行（整行替换会覆盖其他 bundle 的 providers）')
})

test('shouldSeed skips when the route exists in any layer', () => {
  assert.equal(shouldSeed(undefined), true)
  assert.equal(shouldSeed({}), true)
  assert.equal(shouldSeed({ 'zhipu-coding-plan': {} }), true)
  assert.equal(shouldSeed({ 'kimi-coding-plan': {} }), false)
})

test('apply defers usage API setup until loader settles (mount-order fix)', async () => {
  // 回归守卫（dsh-plugin-raven v0.6.0 首版缺陷）：apply 期 ctx.get('connection')
  // （strict）只返回 ACTIVE 实现，而 apply 时 connection 尚未挂载——立即取会
  // 拿到 undefined，路由不注册，pill 取数 404。正确行为：等 loader settle 再取。
  const routes: string[] = []
  let settled = false
  const connection = { fetch: { register: (r: { path: string }) => { routes.push(r.path); return () => {} } } }
  const mockCtx = {
    logger: { warn: () => {}, info: () => {} },
    loader: { await: async () => { settled = true } },
    get(name: string) {
      // 仅在 loader settle 后才提供 connection（模拟挂载顺序）
      return name === 'connection' && settled ? connection : undefined
    },
    interval: () => () => {},
    effect: () => {},
  }
  apply(mockCtx, resolvedConfig())
  assert.equal(settled, true, 'loader.await 已被消费')
  // 等待微任务链（loader.await().then(...)）落定
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(routes.includes('/api/kimi-usage/usage'), 'settle 后应注册 usage 路由')
  assert.ok(routes.includes('/api/kimi-usage/refresh'), 'settle 后应注册 refresh 路由')
  assert.equal(name, 'dsh-kimi-provider')
})

test('usage routes report unconfigured when the credential seam is absent', async () => {
  const handlers = new Map<string, () => Promise<Response>>()
  const connection = {
    fetch: { register: (r: { path: string; fetch: () => Promise<Response> }) => { handlers.set(r.path, r.fetch); return () => {} } },
  }
  let settled = false
  const mockCtx = {
    logger: { warn: () => {}, info: () => {} },
    loader: { await: async () => { settled = true } },
    get(name: string) {
      if (name === 'connection' && settled) return connection
      if (name === 'credentials') return undefined // 凭证服务缺失 → unconfigured
      return undefined
    },
    interval: () => () => {},
    effect: () => {},
  }
  apply(mockCtx, resolvedConfig())
  await new Promise((resolve) => setTimeout(resolve, 0))
  const handler = handlers.get('/api/kimi-usage/usage')
  assert.ok(handler, 'usage 路由已注册')
  const res = await handler()
  const body = (await res.json()) as { snapshot: { status: string; quotas: unknown[] } }
  assert.equal(body.snapshot.status, 'unconfigured')
  assert.deepEqual(body.snapshot.quotas, [])
})

/** apply 收到的是 schema 解析后的完整 config，测试直接给等价形状 */
function resolvedConfig() {
  return {
    usage: {
      apiKeyEnv: 'KIMI_CODING_PLAN_API_KEY',
      baseUrl: 'https://api.kimi.com/coding/v1',
      pollIntervalMs: 0,
      requestTimeoutMs: 1000,
    },
  }
}
