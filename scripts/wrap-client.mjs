// 把 tsdown 产出的 lib/client.cjs 包装为官方 lazy-CJS factory 格式的 lib/client.js：
//
//   window.__ModuleLoader__.load({
//     id: "<包名>",
//     factory: (require) => {
//       var module = { exports: {} };
//       var exports = module.exports;
//       ...cjs body...
//       return module.exports;
//     }
//   })
//
// 与 dsh-plugin-raven / dsh-plugin-custom-providers / dsh-zhipu-provider 的
// scripts/wrap-client.mjs 同构。
// 用法：node scripts/wrap-client.mjs [--watch]（--watch 跟随 tsdown watch 重建）

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'lib', 'client.cjs')
const dst = join(root, 'lib', 'client.js')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

function wrap() {
  if (!existsSync(src)) {
    console.warn(`[wrap-client] ${src} 不存在，跳过（先运行 tsdown）`)
    return
  }
  const body = readFileSync(src, 'utf8')
  const out = `/* dsh-kimi-provider · client half · lazy-CJS factory（由 scripts/wrap-client.mjs 生成，勿手改） */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(pkg.name)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${body}
    return module.exports;
  }
})
`
  writeFileSync(dst, out)
  console.log(`[wrap-client] ${dst} 已生成（${out.length} bytes）`)
}

wrap()

if (process.argv.includes('--watch')) {
  console.log('[wrap-client] watching lib/client.cjs ...')
  let timer = null
  // fs.watch 目录更稳：tsdown 重建时可能是 rename+write
  const { watch } = await import('node:fs')
  watch(dirname(src), () => {
    clearTimeout(timer)
    timer = setTimeout(wrap, 200)
  })
}
