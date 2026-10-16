# dsh-kimi-provider

DSH（DeepSeek Harness）插件：为 Web GUI 接入 Kimi Coding Plan（月之暗面 OpenAI 兼容 coding 端点），并附带用量展示。

## 功能

- **provider 播种**：启动时把 `kimi-coding-plan` 路由写入 `llm-pi-ai` 用户设置层——与 Models 页「自定义模型 API」卡片同一条写入路径，按 provider 键合并，与其他插件互不覆盖；模型选择器随即出现 `k3-256k` / `k3` / `kimi-for-coding`（显示名 Kimi-K2.8）。
- **用量 pill**：会话选用 Kimi 模型时，输入卡片下方显示用量 pill——摘要为 5 小时窗口 / 每周配额百分比（≥90% 标红），点击弹出面板查看各配额已用 / 总量 / 剩余与重置时间。数据取自 Kimi 开放平台。

## 用法

```powershell
dsh plugin --profile web add ./dsh-kimi-provider
```

1. 配置凭证：在设置页录入 Kimi Console Key（`sk-` 前缀，与模型推理同一把），或设置环境变量 `KIMI_CODING_PLAN_API_KEY`；
2. 重启 `dsh web`，选用 Kimi 模型即见 pill；未配置凭证时 pill 显示「未配置」并给出指引。

可选设置（覆盖 schema 默认值）：`baseUrl`（默认 `https://api.kimi.com/coding/v1`，海外站用 `https://api.kimi.ai/coding/v1`）、`usage.pollIntervalMs` / `usage.requestTimeoutMs`（默认 0，关闭自动轮询，以手动刷新为主）。

## 开发

```powershell
pnpm install
pnpm run build
pnpm test
```

> API Key 只存放于 DSH 凭证机制或 `apiKeyEnv` 引用的环境变量，不入库、不写入日志与文档。
