import { defineConfig } from 'tsdown'

// 浏览器 shell 基线模块表（PLATFORM_MODULES）：client bundle 的 require 只允许命中
// 基线词 + dsh.client.external 声明项；构建时全部 external，运行时由 shell 供给。
// 与 dsh-plugin-raven / dsh-plugin-custom-providers / dsh-zhipu-provider 的
// tsdown.config.ts 保持一致。
const CLIENT_BASELINE = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
  '@deepseek-ai/dsh-client-locale',
]

const clientExternal = (id: string) =>
  CLIENT_BASELINE.some((word) => id === word || id.startsWith(word + '/'))

export default defineConfig([
  {
    // host 半面：TS → ESM（lib/index.js），运行时依赖 external（由 profile 安装树解析）
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    outDir: 'lib',
    external: ['@deepseek-ai/schemastery'],
    platform: 'node',
    minify: true,
    sourcemap: false,
    dts: false,
    outExtensions: () => ({ js: '.js' }),
  },
  {
    // client 半面：TSX → CJS（lib/client.cjs），再由 scripts/wrap-client.mjs
    // 包装为 lazy-CJS factory 格式的 lib/client.js（window.__ModuleLoader__.load）
    entry: { client: 'src/client/index.tsx' },
    format: ['cjs'],
    outDir: 'lib',
    external: clientExternal,
    platform: 'browser',
    minify: true,
    sourcemap: false,
    dts: false,
    outExtensions: () => ({ js: '.cjs' }),
  },
])
