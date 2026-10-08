---
status: draft
date: 2026-10-07
---

# Web search 官方接口证据

研究日期：2026-10-07。范围：官方 OpenAI documentation 与仓库已有本地源码证据；没有读取真实凭据、没有调用真实推理或搜索后端。先搜索官方域，再打开页面核实。Codex 文档 URL 当前自动重定向至 ChatGPT Learn。

## 官方公开 API：Responses hosted search

公开集成路径是 `POST https://api.openai.com/v1/responses`，请求的 `tools` 包含 `{ "type": "web_search" }`。它由模型调用 hosted search，返回 `web_search_call` 和 assistant message；不是直接接收任意 `search_query/open/find` 命令的独立搜索服务。新集成应使用 `web_search`，旧 `web_search_preview` 不支持全部新控制项。输出中的 `url_citation` 提供 URL、标题及文本位置，产品必须显示清晰可点击的引用；`include: ["web_search_call.action.sources"]` 可请求更完整的来源。需要确定搜索发生时应显式要求工具调用，而不是仅在 prompt 中写“搜索”。[官方 Web search guide](https://developers.openai.com/api/docs/guides/tools-web-search)

## Codex custom endpoint 的官方配置边界

Codex 支持独立 provider 的 `base_url`、`env_key`、静态/环境变量 headers 和 `requires_openai_auth`。`wire_api` 当前只有 `responses`；这意味着模型协议兼容，不能据此断言任意网关支持搜索。`supports_standalone_web_search` 表示兼容独立搜索接口，默认 `false`，官方注明该能力仍在开发且默认关闭，单独声明 provider 兼容不会启用。[Codex configuration reference](https://developers.openai.com/codex/config-reference)

本地源码的 `POST alpha/search`、ChatGPT 默认 `backend-api/codex` base、`commands` DTO、认证复用和开启门槛见 [本地源码证据](./web-search-codex-evidence.md)。这些代码证明客户端怎样请求，不能证明普通 API key、每个 ChatGPT 账户或任意第三方 endpoint 都提供该接口。此次阅读的公开文档没有将 `<base>/alpha/search` 定义为稳定公共 API；应将其隔离为 Codex 协议适配层，保留版本与错误诊断。

## 官方新增替代路线：Sign in with ChatGPT

官方针对开源、本地运行工具提供 OAuth 动态注册路线：在用户同意下取得独立 client ID 与 ChatGPT plan 的 Responses API 授权，持久化本机 `ext_agent_host_id`。身份 scopes 本身不授予推理权限。这是 Rabbithole 自己的登录授权，与读取/借用现有 Codex 凭据不同。[Overview](https://developers.openai.com/siwc/token-sharing-open-source)、[Quickstart](https://developers.openai.com/siwc/quickstart)

该授权的官方推理目的地是 `https://api.openai.com/v1/responses`；文档明确不能指向 ChatGPT `backend-api`。可以用同一 OAuth access token 获取账户模型列表。HTTP 请求须 `store:false`、`stream:true`，完整消费至 `response.completed` 才确认成功。[Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)

这一 preview 路线的 web search 仍受模型、账户与 workspace policy 限制。它不接受全部普通 Responses 参数，包括 `temperature`、`max_output_tokens`、`previous_response_id`；不能简单共用普通 API key 请求体。[Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

该登录由应用管理刷新、账户选择与撤销；同一会话的 refresh 必须串行化，防止 rotating token 竞争。凭据放受保护的本地运行时存储，不放浏览器 storage、日志、源码或导出文档。[Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)

也可把这种 OAuth token 传给 `codex app-server` 子进程，通过 Responses custom provider 使用；官方示例仍要求应用自己刷新 token，再重启子进程、恢复 thread。这里的 `model/list` 可能返回 bundled catalog，成功推理才确认模型可用。[Codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)

## 对 Rabbithole 方案的推论

用户真正需要区分的是“现有 Codex 登录能直接使用的独立搜索工具”与“官方公开 Responses 内置搜索”。前者可按本地源码适配 `alpha/search`，但需实际验证账户、二进制版本和每个自定义后端；后者有公开文档，却通常需要模型推理并返回合成答案。两个 adapter 可以提供统一产品能力，但不能假定两者请求/响应或凭据可互换。

建议保留三种明确来源：Codex 登录 + Codex search、custom endpoint + 显式搜索协议、公开 Responses hosted search。如后续希望减少对未承诺后端的依赖，再增加独立 Sign in with ChatGPT 登录；它是另一个授权产品路径，并不能替代用户本轮要求的现有 Codex 登录复用。
