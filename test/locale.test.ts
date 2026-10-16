// 词典完整性守卫：pill 短标签按配额 kind 动态拼键（t(`short.${kind}`)），
// 键名与 kind 不一致时 locale.bind 会把原始键名渲染到界面上
// （实测症状：「Kimi short.window-5h 2.1% · 周 36%」，修复见同仓提交）。此处
// 在测试层断言每个 kind 的短标签在 zh/en 词典都存在，杜绝同类键名漂移。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { panelDict } from '../src/client/locale.ts'

const KINDS = ['window-5h', 'weekly', 'monthly', 'other'] as const

test('panel dict ships a non-empty short label for every quota kind in both languages', () => {
  for (const lang of ['zh', 'en'] as const) {
    const dict = panelDict[lang] as Record<string, string>
    for (const kind of KINDS) {
      const key = `short.${kind}`
      assert.ok(key in dict, `${lang} 词典缺少 ${key}（pill 会渲染原始键名）`)
      assert.ok(dict[key].length > 0, `${lang} 词典 ${key} 为空串`)
    }
  }
})

test('panel dict ships the fixed keys the pill and panel render', () => {
  const FIXED_KEYS = [
    'loading',
    'empty',
    'bar.brand',
    'panel.title',
    'state.error',
    'state.unconfigured',
    'stale.badge',
    'updated.at',
    'refresh',
    'refreshing',
    'reset.at',
    'quota.window5h',
    'quota.weekly',
    'quota.monthly',
    'unit.unlimited',
    'used.of',
    'used.only',
    'remaining',
    'hint.unconfigured',
    'error.route',
    'error.network',
    'error.auth',
    'error.rate-limit',
    'error.parse',
    'error.unknown',
  ]
  for (const lang of ['zh', 'en'] as const) {
    const dict = panelDict[lang] as Record<string, string>
    for (const key of FIXED_KEYS) {
      assert.ok(key in dict, `${lang} 词典缺少 ${key}`)
    }
  }
})
