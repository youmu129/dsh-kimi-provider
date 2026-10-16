// host 半面入口：settings 播种器 + Kimi 用量 API。
//
// 播种机制（迁自 dsh-plugin-raven v0.5.0+）：本插件不拥有 `llm-pi-ai` 行
// （patch 层对目标行是整行替换 `config`，多个 bundle 的 providers 无法合并），
// 改在启动、全部条目挂载 settle 后，经 settings 服务把 kimi-coding-plan
// 路由合并进用户层（profile cordis.patch.yml）——与 Web Models 页「自定义
// 模型 API」完全同一条写入路径（update → mergeLayers，按 provider 键合并，
// 不整段覆盖）。生效配置中已存在该路由（无论来自哪个层）即跳过：用户在
// Models 页的字段编辑永不被覆盖，dsh-plugin-custom-providers 在 bundle 层
// 注册的同名路由也会让播种自动让位，两插件互不冲突、层序不敏感。
// 删除该路由后下次启动会重新播种——要永久移除请卸载本插件，或在 patch 中
// 禁用本挂载行（disabled: true）。
//
// provider 定义迁自 dsh-plugin-custom-providers 的 cordis.patch.yml
// kimi-coding-plan 段，逐字段一致（含 compat 段；`off:` 空值是
// llm-pi-ai 认可的「等级存在、线上不发送」写法）。
//
// 已知代价（与用户手动使用一次 Models 页相同）：播种会把当时生效的
// providers 全量快照进用户层；此后其他 bundle 层对该字典的更新被这份
// 快照遮蔽，直至用户手动编辑用户层文件。
//
// 凭证不落配置：路由经 apiKeyEnv 引用 KIMI_CODING_PLAN_API_KEY，由 harness
// 凭证机制按请求解析；用量查询同把钥匙现读现用（未配置 → unconfigured 态）。
//
// 用量 API：直连 api.kimi.com（海外 api.kimi.ai 经 settings 覆盖 baseUrl），
// 经 /api/kimi-usage/* 同源路由供给 client 半面的底部 pill。
// connection 为可选取用：组合缺 connection 时跳过路由注册（播种不受影响）。

import z from '@deepseek-ai/schemastery'
import { AdapterUnconfiguredError } from './model.ts'
import { KIMI_DEFAULT_BASE_URL, fetchKimiUsage } from './kimi.ts'
import { UsageStore } from './store.ts'

/** The settings namespace (= profile entry id) of the pi-ai adapter row. */
const NS = 'llm-pi-ai'

/** The provider route this plugin seeds. */
const ROUTE = 'kimi-coding-plan'

/** One seeded model; fields follow PiAiProviderProfile's model entry. */
interface SeedModel {
  id: string
  name: string
  contextWindow: number
  input: string[]
  reasoningEfforts: Record<string, string | null>
}

/** The seeded provider profile; fields follow @deepseek-ai/dsh-llm-pi-ai's PiAiProviderProfile. */
interface SeedProfile {
  displayName: string
  apiKeyEnv: string
  api: string
  baseURL: string
  reasoning: string
  compat: {
    supportsDeveloperRole: boolean
    maxTokensField: string
  }
  models: SeedModel[]
}

/** The kimi-coding-plan route (migrated verbatim from dsh-plugin-custom-providers, compat section included). */
const PROFILE: SeedProfile = {
  displayName: 'Kimi Coding Plan',
  apiKeyEnv: 'KIMI_CODING_PLAN_API_KEY',
  api: 'openai-completions',
  baseURL: 'https://api.kimi.com/coding/v1',
  reasoning: 'max',
  compat: {
    supportsDeveloperRole: false,
    maxTokensField: 'max_tokens',
  },
  models: [
    {
      id: 'k3-256k',
      name: 'Kimi-K3-256k',
      contextWindow: 262144,
      input: ['text', 'image'],
      reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
    },
    {
      id: 'k3',
      name: 'Kimi-K3',
      contextWindow: 1048576,
      input: ['text', 'image'],
      reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
    },
    {
      id: 'kimi-for-coding',
      name: 'Kimi-K2.8',
      contextWindow: 1048576,
      input: ['text', 'image'],
      reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
    },
  ],
}

/**
 * 播种判定：生效 providers 里已存在本路由（无论来自哪个层）即跳过，
 * 用户编辑与其他 bundle（custom-providers）的同名注册因此永不被覆盖。
 * @param providers 生效配置的 providers 字典（describe().value.providers）。
 * @returns 是否需要播种。
 */
export function shouldSeed(providers: unknown): boolean {
  return !(typeof providers === 'object' && providers !== null && ROUTE in providers)
}

/**
 * 种子 profile 的深拷贝（导出供测试断言形状；调用方拿到独立副本）。
 * @returns kimi-coding-plan 的 PiAiProviderProfile。
 */
export function seedProfile(): SeedProfile {
  return structuredClone(PROFILE)
}

// ---------------------------------------------------------------------------
// Config（usage 子树；行 config 经 cordis.patch.yml 传入）
// ---------------------------------------------------------------------------

const UsageSettings = z.object({
  // 凭证引用名（值只经 DSH 凭证机制，与 custom-providers 的 kimi 段默认一致）
  apiKeyEnv: z.string().role('credential-ref').default('KIMI_CODING_PLAN_API_KEY'),
  baseUrl: z.string().default(KIMI_DEFAULT_BASE_URL),
  pollIntervalMs: z.number().default(0),
  requestTimeoutMs: z.number().default(10000),
})

export const Config = z.object({
  usage: UsageSettings.default({}),
})

export type PluginConfig = z.infer<typeof Config>

export const name = 'dsh-kimi-provider'

export function apply(ctx: any, config: PluginConfig): void {
  // 与播种同一条 settle 等待：apply 期 connection 服务尚未 ACTIVE，
  // ctx.get（strict）只返回 ACTIVE 实现，立即取会拿到 undefined 而误判缺组合
  // （dsh-plugin-raven v0.6.0 首版即此缺陷：路由未注册，pill 取数 404）。
  void ctx.loader.await().then(() => setupUsageApi(ctx, config)).catch(reportUsageApi)

  // 等 loader settle 再读生效配置：apply 时 llm-pi-ai 可能尚未 ACTIVE，
  // describe() 会过滤非 ACTIVE 条目导致误判「组合里没有该适配器」。
  void ctx.loader.await().then(seed).catch(report)

  async function seed(): Promise<void> {
    // settings 为可选依赖（组合里可能没有 dsh-settings），缺失时告警跳过
    const settings = ctx.get('settings')
    if (settings === undefined) {
      ctx.logger.warn('dsh-kimi-provider: settings 服务不可用，跳过 provider 播种（需要 dsh-base 组合）')
      return
    }
    const descriptor = settings.describe().find((row: { ns: string }) => row.ns === NS)
    if (descriptor === undefined) {
      ctx.logger.warn(`dsh-kimi-provider: 组合中没有活跃的 ${NS} 条目，跳过 provider 播种`)
      return
    }
    if (!shouldSeed((descriptor.value ?? {}).providers)) return
    // 无 expectedRevision：启动期没有交互写入方，last-write-wins 即正确语义
    await settings.update(NS, { providers: { [ROUTE]: seedProfile() } })
    ctx.logger.info(`dsh-kimi-provider: 已将 ${ROUTE} 播种到用户层（profile cordis.patch.yml），Models 页可管理`)
  }

  function report(error: unknown): void {
    // 播种失败不阻断启动：路由缺失的后果（UNKNOWN_MODEL）比整进程退出轻
    ctx.logger.warn('dsh-kimi-provider: provider 播种失败')
    ctx.logger.warn(error)
  }

  function reportUsageApi(error: unknown): void {
    // 同上：用量 API 失败不阻断启动，pill 侧会呈现查询失败态
    ctx.logger.warn('dsh-kimi-provider: 用量 API 初始化失败')
    ctx.logger.warn(error)
  }
}

// ---------------------------------------------------------------------------
// 用量 API：/api/kimi-usage/usage | /api/kimi-usage/refresh
// ---------------------------------------------------------------------------

function setupUsageApi(ctx: any, config: PluginConfig): void {
  // 本函数在 loader settle 后调用：此时组合里要挂载的条目均已 ACTIVE，
  // ctx.get('connection') 能真实反映组合是否含 Web connection 服务。
  const connection = ctx.get('connection')
  if (connection === undefined) {
    ctx.logger.warn('dsh-kimi-provider: connection 服务不可用，跳过用量 API（需要 Web 组合）')
    return
  }

  try {
    registerUsageRoutes(ctx, config, connection)
  } catch (error) {
    // 路由注册失败（如 live reload 重挂载冲突）只告警，不影响播种与其他功能
    ctx.logger.warn('dsh-kimi-provider: 用量路由注册失败')
    ctx.logger.warn(error)
  }
}

function registerUsageRoutes(ctx: any, config: PluginConfig, connection: any): void {
  // 每次刷新现 resolve 凭证（热轮换友好）；未配置 → unconfigured 快照
  const store = new UsageStore(async () => {
    const creds = ctx.get('credentials')
    const resolved = creds ? await creds.resolve(config.usage.apiKeyEnv) : undefined
    const apiKey = resolved?.value
    if (!apiKey) {
      throw new AdapterUnconfiguredError(
        `Kimi 凭证未配置：请在设置页录入 ${config.usage.apiKeyEnv}，或在环境中设置该变量`,
      )
    }
    return fetchKimiUsage({
      baseUrl: config.usage.baseUrl,
      apiKey,
      timeoutMs: config.usage.requestTimeoutMs,
    })
  })

  // --- 轮询（默认关闭，手动/面板刷新为主） ---
  let disposePolling: (() => void) | undefined
  const armPolling = () => {
    disposePolling?.()
    disposePolling = undefined
    if (config.usage.pollIntervalMs > 0) {
      disposePolling = ctx.interval(() => void store.refresh(), config.usage.pollIntervalMs)
    }
  }
  armPolling()
  ctx.effect(() => () => disposePolling?.(), 'dsh-kimi-provider: usage polling dispose')

  // --- /api 路由（认证由 Connection 统一负责） ---
  connection.fetch.register({
    path: '/api/kimi-usage/usage',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      await store.ensureFresh()
      return Response.json({ snapshot: store.snapshot() })
    },
  })

  connection.fetch.register({
    path: '/api/kimi-usage/refresh',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async () => {
      await store.refresh()
      return Response.json({ snapshot: store.snapshot() })
    },
  })
}
