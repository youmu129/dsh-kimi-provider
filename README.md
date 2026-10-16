# dsh-kimi-provider

DSH（DeepSeek Harness）插件：把 Kimi（月之暗面 Moonshot AI）系列模型服务注册为 DSH 的自定义模型供应商，使其模型可出现在 Web GUI 的模型选择器中直接选用。

## 状态

- 空仓库初始化：仅含 `.gitignore` 与本 README 两个基线文件；
- 供应商注册、凭证接入等功能待规划与开发（任务上下文见 dsh-dev 工作台 [INDEX](../../../workbenches/dsh-dev/INDEX.md)）。

## 凭证纪律

Moonshot API Key 只存放于 DSH 凭证机制或 `apiKeyEnv` 引用的环境变量，不入库、不写入日志与文档。
