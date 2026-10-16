// Kimi 用量 pill（conversation.composer.dock，与官方「会话统计 / Token 用量」、
// plan-usage 套餐 pill、raven-usage / zhipu-usage pill 同一座位链）：pill 触发
// 按钮（官方时钟图标 + 配额百分比）+ 点击开 portal 面板（5 小时窗口 / 每周 /
// 月度总额度配额明细，含重置时间）。仅当前会话选用 kimi-coding-plan provider
// 时渲染（座位 inject 面绑定的 useModelDirectory 读取会话模型目录，选择源
// 缺失或选了别家 → 渲染 null）。交互范式复刻 dsh-plugin-raven /
// dsh-zhipu-provider 的 bar.tsx（进而复刻官方 StatsPills / stat-dialog 与
// plan-usage）：useAnchoredPosition 视口钳制定位、useDismissOnOutsidePointer +
// Escape 关闭、样式对齐官方设计 token（--dsw-* / --dsh-*）。组件在渲染期才
// 取数，不在 apply 期触碰服务。
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import {
  IconClockOutlineRegular,
  Tooltip,
  useAnchoredPosition,
  useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { api, type QuotaDto, type UsageSnapshotDto } from './api.ts'
import { PANEL_NS } from './locale.ts'
import { injectCss } from './styles.ts'

// dsh-plugin-raven / dsh-zhipu-provider bar.tsx 的 token 化样式（类名换 kmi-
// 前缀，数值与官方产物一致），另补配额进度条（kmi-bar*）与重置时间行
//（kmi-reset）。
const PILL_CSS = `
.kmi-root { min-width: 0; display: inline-flex; font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px); line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px)); }
.kmi-pill { box-sizing: border-box; max-width: 100%; color: var(--dsw-alias-label-tertiary); font: inherit; font-variant-numeric: tabular-nums; line-height: inherit; white-space: nowrap; background: none; border: none; border-radius: 999px; align-items: center; gap: 6px; padding: 1px 8px; display: inline-flex; cursor: pointer; }
.kmi-pill svg { flex: none; width: 14px; height: 14px; }
.kmi-pill:hover, .kmi-pill[aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.kmi-label { text-overflow: ellipsis; min-width: 0; overflow: hidden; }
.kmi-sep { color: var(--dsw-alias-separator-primary); margin: 0 6px; }
.kmi-val--muted { opacity: .55; }
.kmi-val--err { color: #d4380d; }
@media (max-width: 480px) { .kmi-label, .kmi-sep { display: none; } }
.kmi-panel { z-index: 1100; box-sizing: border-box; border-radius: var(--dsw-radius-lg); background: var(--dsw-specific-menu); width: max-content; min-width: min(300px, 100vw - 24px); max-width: min(440px, 100vw - 24px); backdrop-filter: var(--dsw-menu-backdrop-filter); --dsw-elevation-stroke-color: var(--dsw-alias-border-l1); box-shadow: var(--dsw-elevation-prominent); color: var(--dsw-alias-label-secondary); cursor: default; border: 0; padding: 16px; font-size: 12px; line-height: 18px; position: fixed; }
.kmi-title { color: var(--dsw-alias-label-primary); justify-content: space-between; gap: 16px; margin-bottom: 8px; font-weight: 500; display: flex; align-items: center; }
.kmi-titleLabel { align-items: center; gap: 6px; min-width: 0; display: inline-flex; }
.kmi-titleLabel svg { flex: none; width: 14px; height: 14px; }
.kmi-titleMeta { align-items: center; gap: 8px; font-variant-numeric: tabular-nums; font-weight: 400; color: var(--dsw-alias-label-tertiary); display: inline-flex; }
.kmi-titleRule { border-top: .5px solid var(--dsw-alias-border-l2); margin-bottom: 10px; }
.kmi-rows { display: flex; flex-direction: column; gap: 10px; }
.kmi-rowHead { display: flex; justify-content: space-between; gap: 16px; color: var(--dsw-alias-label-primary); }
.kmi-rowHead dd { margin: 0; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; text-align: right; }
.kmi-bar { height: 4px; border-radius: 2px; background: var(--dsw-alias-border-l2); margin-top: 4px; overflow: hidden; }
.kmi-bar--unlimited { opacity: .3; }
.kmi-barFill { height: 100%; border-radius: 2px; background: var(--dsw-alias-label-tertiary); }
.kmi-barFill--err { background: #d4380d; }
.kmi-reset { color: var(--dsw-alias-label-tertiary); font-size: 11px; margin-top: 2px; }
.kmi-hint { color: var(--dsw-alias-label-tertiary); line-height: 1.6; overflow-wrap: anywhere; }
.kmi-stale { color: #d48806; font-size: 11px; font-weight: 400; }
.kmi-refresh { background: none; border: none; color: inherit; cursor: pointer; opacity: .55; font-size: 13px; line-height: 1; padding: 2px 4px; flex: none; }
.kmi-refresh:hover:not(:disabled) { opacity: .9; }
.kmi-refresh:disabled { opacity: .25; cursor: default; }
`

type Translate = (key: string, params?: Record<string, string | number>) => string

// ---------------------------------------------------------------------------
// 会话模型选择（官方 ui-model-selection 服务的使用子集，类型本地镜像；
// 与 primitives.d.ts 同理：DSH 内部包无可安装类型，运行时对象由宿主供给）
// ---------------------------------------------------------------------------

/** 模型选择（镜像官方 ModelSelection 的使用子集） */
interface ModelSelectionLike {
  provider: string
  model: string
}

/** 会话模型目录快照（镜像官方 ModelDirectoryState 的使用子集） */
interface ModelDirectorySnapshotLike {
  current: ModelSelectionLike | null
}

/** 可观察快照源（官方 HostObservable 的使用子集：getSnapshot + subscribe） */
export interface SnapshotSourceLike {
  getSnapshot(): ModelDirectorySnapshotLike | undefined
  subscribe(fn: () => void): () => void
}

/** 座位机制绑定后的选择器 hook（hooks.modelDirectory → useModelDirectory prop） */
export type UseModelDirectory = <S>(selector: (s: ModelDirectorySnapshotLike | undefined) => S) => S

/** 选择源缺失时的降级源：snapshot 恒 undefined（pill 据此隐藏） */
export const ABSENT_MODEL_SOURCE: SnapshotSourceLike = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
}

/** 播种的 provider 路由 id（cordis 路由与 pill 显隐判定共用） */
const KIMI_PROVIDER = 'kimi-coding-plan'

/** 官方浮层首帧测量样式（定位结果就绪前隐藏，避免闪现在原点）。 */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

const FILL_THRESHOLD = 90

/** pill 摘要最多取的配额段数（5h 窗口 + 每周，防溢出） */
const MAX_SEGMENTS = 2

/** 配额 kind 的展示优先级（pill 摘要与面板排序共用） */
const KIND_ORDER: Array<QuotaDto['kind']> = ['window-5h', 'weekly', 'monthly', 'other']

function fmtTokens(n: number): string {
  return n.toLocaleString('en-US')
}

function kindRank(kind: QuotaDto['kind']): number {
  const i = KIND_ORDER.indexOf(kind)
  return i === -1 ? KIND_ORDER.length : i
}

/** 面板行视图：百分比优先取上游 percentUsed，缺省按 used/limit 推导 */
interface QuotaView {
  key: string
  kind: QuotaDto['kind']
  label: string
  used?: number
  limit?: number
  remaining?: number
  /** 0–100；无法推导时为 null（不渲染进度条） */
  pct: number | null
  over: boolean
  resetAt?: string
}

/** kind → 本地化标签；other 回退 host 侧固定 label */
function labelFor(q: QuotaDto, t: Translate): string {
  if (q.kind === 'window-5h') return t('quota.window5h')
  if (q.kind === 'weekly') return t('quota.weekly')
  if (q.kind === 'monthly') return t('quota.monthly')
  return q.label
}

function toView(q: QuotaDto, idx: number, t: Translate): QuotaView {
  const pct =
    q.percentUsed ??
    (q.limit != null && q.limit > 0 && q.used != null ? Math.round((q.used / q.limit) * 1000) / 10 : null)
  return {
    key: `${q.kind}-${idx}`,
    kind: q.kind,
    label: labelFor(q, t),
    used: q.used,
    limit: q.limit,
    remaining: q.remaining,
    pct,
    over: pct !== null && pct >= FILL_THRESHOLD,
    resetAt: q.resetAt,
  }
}

function buildQuotas(quotas: QuotaDto[], t: Translate): QuotaView[] {
  return quotas
    .map((q, i) => toView(q, i, t))
    .sort((a, b) => kindRank(a.kind) - kindRank(b.kind))
}

/** 配额右侧数值文案：已用/总量 · 百分比；无总量时退化为已用 / 仅剩 */
function quotaText(q: QuotaView, t: Translate): string {
  if (q.limit != null && q.limit > 0 && q.used != null) {
    const base = t('used.of', { used: fmtTokens(q.used), limit: fmtTokens(q.limit) })
    return q.pct != null ? `${base} · ${q.pct}%` : base
  }
  const parts: string[] = []
  if (q.used != null) parts.push(t('used.only', { used: fmtTokens(q.used) }))
  if (q.remaining != null) parts.push(t('remaining', { value: fmtTokens(q.remaining) }))
  if (q.pct != null && parts.length === 0) parts.push(`${q.pct}%`)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

/** pill 短文案：按 kind 优先级取前两段配额百分比（无百分比的行跳过） */
function pillSegments(quotas: QuotaDto[]): Array<{ key: string; text: string; over?: boolean }> {
  return quotas
    .map((q, i) => toView(q, i, (key) => key)) // 标签不进 pill，Translate 仅占位
    .filter((v) => v.pct !== null)
    .sort((a, b) => kindRank(a.kind) - kindRank(b.kind))
    .slice(0, MAX_SEGMENTS)
    .map((v) => ({ key: v.kind, text: `${v.pct}%`, over: v.over }))
}

/** 错误行文案键：按 error.kind 映射，未知 kind 回退通用文案 */
function errorTextKey(kind: string | undefined): string {
  return kind === 'network' || kind === 'auth' || kind === 'rate-limit' || kind === 'parse'
    ? `error.${kind}`
    : 'error.unknown'
}

function fmtReset(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function createUsagePill(ctx: any) {
  const t: Translate = (key, params) => ctx.locale.bind(PANEL_NS)(key, params)

  function UsagePill({ useModelDirectory }: { useModelDirectory?: UseModelDirectory }) {
    const [snapshot, setSnapshot] = useState<UsageSnapshotDto | undefined>(undefined)
    // 与「从未请求成功」区分：true 表示至少拿到过一次 host 响应（含错误快照）
    const [loaded, setLoaded] = useState(false)
    // 请求级失败（host 路由缺失 / 网络断开）：与「暂无数据」区分呈现
    const [loadError, setLoadError] = useState(false)
    const [refreshing, setRefreshing] = useState(false)
    const [open, setOpen] = useState(false)
    const rootRef = useRef<HTMLSpanElement | null>(null)
    const panelRef = useRef<HTMLDivElement | null>(null)
    // 复刻官方 useStatDialog：锚定定位 + 外点关闭 + Escape 关闭
    const pos = useAnchoredPosition({ open, anchorRef: rootRef, panelRef, side: 'top', gap: 8, margin: 12 })
    useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef)
    useEffect(() => {
      if (!open) return
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setOpen(false)
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
    }, [open])

    const load = useCallback(async () => {
      try {
        const data = await api.usage()
        setSnapshot(data.snapshot)
      } catch {
        setLoadError(true)
      } finally {
        setLoaded(true)
      }
    }, [])

    const refresh = useCallback(async () => {
      setRefreshing(true)
      try {
        const data = await api.refresh()
        setSnapshot(data.snapshot)
        setLoaded(true)
      } catch {
        /* 保留现状 */
      } finally {
        setRefreshing(false)
      }
    }, [])

    useEffect(() => {
      injectCss('pill', PILL_CSS)
      void load().catch(() => setLoaded(true))
      const timer = setInterval(() => void refresh(), 60_000)
      return () => clearInterval(timer)
    }, [load, refresh])

    // 显隐判定：仅当前会话选用 kimi-coding-plan provider 时显示。注：座位
    // inject 面按（entry × 会话绑定）缓存，useModelDirectory 在一次挂载内恒
    // 存在或恒缺失，条件调用不破坏 hook 调用序稳定性；选择源缺失时 selection
    // 恒 null，pill 隐藏而非退化常显。
    const hasSelectionSource = typeof useModelDirectory === 'function'
    const selection = hasSelectionSource
      ? useModelDirectory((s: ModelDirectorySnapshotLike | undefined) => s?.current ?? null)
      : null

    // 非 Kimi 会话（或选择未就绪 / 选择源缺失）不渲染 pill；组件仍保持挂载，
    // 取数副作用照常运行（数据保温），切到 Kimi 时 pill 即刻有数据。
    if (selection?.provider !== KIMI_PROVIDER) return null

    const status = snapshot?.status
    const quotas = snapshot?.quotas ? buildQuotas(snapshot.quotas, t) : []
    const segments = snapshot?.quotas ? pillSegments(snapshot.quotas) : []

    // pill 摘要（平台名风格，对齐 plan-usage 的 "Kimi 45%"）：
    // 单段配额 → 「Kimi 2.1%」；多段 → 「Kimi 5h 2.1% · 周 36%」（短标签防歧义）
    const summary =
      segments.length === 1
        ? `${t('bar.brand')} ${segments[0].text}`
        : segments.length > 1
          ? `${t('bar.brand')} ${segments.map((s) => `${t(`short.${s.key}`)} ${s.text}`).join(' · ')}`
          : t('panel.title')

    // pill 文案：加载中 → 请求失败/错误/未配置/Kimi 摘要
    const label = !loaded
      ? t('loading')
      : loadError && status === undefined
        ? t('state.error')
        : status === 'error'
          ? t('state.error')
          : status === 'unconfigured'
            ? t('state.unconfigured')
            : summary

    return (
      <span className="kmi-root" ref={rootRef}>
        <button
          type="button"
          className="kmi-pill"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label}
          onClick={() => setOpen(!open)}
        >
          <IconClockOutlineRegular />
          <span className="kmi-label">
            {!loaded ? null : loadError && status === undefined ? (
              <span className="kmi-val kmi-val--err">{t('state.error')}</span>
            ) : status === 'error' ? (
              <span className="kmi-val kmi-val--err">{t('state.error')}</span>
            ) : status === 'unconfigured' ? (
              <span className="kmi-val kmi-val--muted">{t('state.unconfigured')}</span>
            ) : segments.length > 0 ? (
              <span>
                <span>{t('bar.brand')} </span>
                {segments.map((s, i) => (
                  <span key={s.key}>
                    {segments.length > 1 && (
                      <span>
                        {i > 0 && (
                          <span className="kmi-sep" aria-hidden="true">
                            ·
                          </span>
                        )}
                        {t(`short.${s.key}`)}{' '}
                      </span>
                    )}
                    <span
                      className={
                        s.over ? 'kmi-val kmi-val--err' : snapshot?.stale ? 'kmi-val kmi-val--muted' : 'kmi-val'
                      }
                    >
                      {s.text}
                    </span>
                  </span>
                ))}
              </span>
            ) : (
              <span className="kmi-val kmi-val--muted">{t('panel.title')}</span>
            )}
          </span>
        </button>
        {open &&
          createPortal(
            <div
              ref={panelRef}
              className="kmi-panel"
              role="dialog"
              aria-label={t('panel.title')}
              style={pos ?? MEASURE_STYLE}
            >
              <div className="kmi-title">
                <span className="kmi-titleLabel">
                  <IconClockOutlineRegular />
                  {t('panel.title')}
                </span>
                <span className="kmi-titleMeta">
                  {snapshot?.planName && <span>{snapshot.planName}</span>}
                  {status === 'ok' && snapshot?.stale && <span className="kmi-stale">{t('stale.badge')}</span>}
                  {snapshot?.fetchedAt && (
                    <span>{t('updated.at', { time: new Date(snapshot.fetchedAt).toLocaleTimeString() })}</span>
                  )}
                  <Tooltip label={refreshing ? t('refreshing') : t('refresh')} side="top" delayMs={300}>
                    <button
                      type="button"
                      className="kmi-refresh"
                      aria-label={t('refresh')}
                      disabled={refreshing}
                      onClick={refresh}
                    >
                      ⟳
                    </button>
                  </Tooltip>
                </span>
              </div>
              <div className="kmi-titleRule" aria-hidden="true" />
              {!loaded && <div>{t('loading')}</div>}
              {loaded && loadError && status === undefined && (
                <div className="kmi-hint">{t('error.route')}</div>
              )}
              {loaded && !loadError && status === undefined && <div>{t('empty')}</div>}
              {loaded && status === 'unconfigured' && <div className="kmi-hint">{t('hint.unconfigured')}</div>}
              {loaded && status === 'error' && (
                <div className="kmi-hint">
                  {t(errorTextKey(snapshot?.error?.kind))}
                  {snapshot?.error?.message ? `：${snapshot.error.message}` : ''}
                </div>
              )}
              {status === 'ok' && (
                <div className="kmi-rows">
                  {quotas.map((q) => (
                    <div key={q.key}>
                      <dl className="kmi-rowHead">
                        <dt>{q.label}</dt>
                        <dd>{quotaText(q, t)}</dd>
                      </dl>
                      {/* 无百分比（pct===null）也渲染进度条，整条置灰（kmi-bar--unlimited）无填充 */}
                      <div className={q.pct === null ? 'kmi-bar kmi-bar--unlimited' : 'kmi-bar'} aria-hidden="true">
                        {q.pct !== null && (
                          <div
                            className={q.over ? 'kmi-barFill kmi-barFill--err' : 'kmi-barFill'}
                            style={{ width: `${Math.min(q.pct, 100)}%` }}
                          />
                        )}
                      </div>
                      {q.resetAt && <div className="kmi-reset">{t('reset.at', { time: fmtReset(q.resetAt) })}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>,
            document.body,
          )}
      </span>
    )
  }

  return UsagePill
}
