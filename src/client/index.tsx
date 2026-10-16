// client 半面入口（机制迁自 dsh-plugin-raven v0.6.0 / dsh-zhipu-provider）。
// 注入保持最小（slots/locale），其余服务一律延迟到组件渲染期取用——避免
// bundle 物化顺序导致 apply 期服务缺失、整 fiber 失败。
import { PANEL_NS, panelDict } from './locale.ts'
import { ABSENT_MODEL_SOURCE, createUsagePill, type SnapshotSourceLike } from './bar.tsx'

export const inject = ['slots', 'locale']

/**
 * 会话座位的 inject 面：为 pill 绑定本会话共享的模型选择目录 store（官方
 * ui-model-selection 的 ctx.modelDirectories 服务，directoryFor(sessionId) 即
 * 模型选择器与 /model 弹窗共用的那份状态）。回调在渲染期执行（sessionId 由
 * 座位机制传入），服务仍按渲染期取用约束经 ctx.get 判空；缺失 / 会话不可
 * 解析时降级为恒空源，pill 据此隐藏。
 */
function modelSelectionHooks(ctx: any, sessionId: string): { hooks: { modelDirectory: SnapshotSourceLike } } {
  try {
    const models = ctx.get('modelDirectories')
    return { hooks: { modelDirectory: models?.directoryFor(sessionId)?.store ?? ABSENT_MODEL_SOURCE } }
  } catch {
    return { hooks: { modelDirectory: ABSENT_MODEL_SOURCE } }
  }
}

export function apply(ctx: any) {
  ctx.effect(() => ctx.locale.register(PANEL_NS, panelDict), 'kimi-usage: bar dictionary')

  // Kimi 用量 pill：输入卡片下方 dock 行（conversation.composer.dock，list 座位），
  // 与官方「会话统计 / Token 用量」（id stats, order 0）、plan-usage 套餐 pill
  //（id plan-usage, order 10）、zhipu-usage pill（order 15）、raven-usage pill
  //（order 20）同一座位链，order 16 排 zhipu-usage 右侧。仅当前会话选用
  // kimi-coding-plan provider 时显示（座位 inject 面按 entry×会话绑定模型目录，
  // 见 modelSelectionHooks）；pill 显示配额百分比摘要，面板展示 5 小时窗口 /
  // 每周 / 月度总额度配额明细与重置时间。
  const UsagePill = createUsagePill(ctx)
  ctx.effect(
    () =>
      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.composer.dock',
            id: 'kimi-usage',
            order: 16,
            locale: PANEL_NS,
            inject: (sessionId: string) => modelSelectionHooks(ctx, sessionId),
          },
          UsagePill,
        ),
      ),
    'kimi-usage: usage pill',
  )
}
