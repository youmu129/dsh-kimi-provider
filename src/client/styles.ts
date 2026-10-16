// 样式注入助手（官方 data-plugin-css 去重模式）。pill/panel 样式内联在
// bar.tsx（自包含，便于随组件维护）。

export const PLUGIN_ID = 'dsh-kimi-provider'

export function injectCss(mark: string, css: string): void {
  const attr = `${PLUGIN_ID}/${mark}.css`
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${attr}"]`)) return
  const tag = document.createElement('style')
  tag.dataset.plugin = PLUGIN_ID
  tag.dataset.pluginCss = attr
  tag.textContent = css
  document.head.appendChild(tag)
}
