# 本地 Codex 搜索源码证据

状态：方案研究；2026-10-07。只读检查 `/Users/mu9/proj/codex`，HEAD `a9519cbcdd2d664530edb2469224ee03c1056799`；未读取用户凭据，未请求真实后端。下文源码链接均指该本地目录。

## 已证实：两条不同的执行路径

- **Hosted search**：推理请求内发送 `type: "web_search"`，服务端负责执行。工具序列化定义见 [tool_spec.rs:39](/Users/mu9/proj/codex/codex-rs/tools/src/tool_spec.rs:39)。`cached` 对应 `external_web_access=false`，`live` 对应 `true`，`disabled` 不生成工具；见 [hosted_spec.rs:14](/Users/mu9/proj/codex/codex-rs/core/src/tools/hosted_spec.rs:14)。
- **Standalone search**：模型看到 `web.run` namespace/function；客户端解析参数后调用独立 HTTP 搜索接口，结果作为 `function_call_output` 返回模型。工具 schema 见 [tool.rs:52](/Users/mu9/proj/codex/codex-rs/ext/web-search/src/tool.rs:52)，请求链见 [tool.rs:94](/Users/mu9/proj/codex/codex-rs/ext/web-search/src/tool.rs:94)，结果输出见 [output.rs:30](/Users/mu9/proj/codex/codex-rs/ext/web-search/src/output.rs:30)。
- 当前独立接口路径是 **`POST alpha/search`**，不是普通 `/search`；见 [endpoint/search.rs:31](/Users/mu9/proj/codex/codex-rs/codex-api/src/endpoint/search.rs:31)。URL 由 provider base URL 直接追加该相对路径；见 [provider.rs:53](/Users/mu9/proj/codex/codex-rs/codex-api/src/provider.rs:53)。
- `web.run` 成功注册时，Codex 不再发送 hosted `web_search`，避免两套工具并存；见 [spec_plan.rs:620](/Users/mu9/proj/codex/codex-rs/core/src/tools/spec_plan.rs:620)。

## 已证实：登录和第三方 Codex 使用同一 provider 路由

- ChatGPT 登录的默认 base URL 为 `https://chatgpt.com/backend-api/codex`，因而搜索 URL 是 `https://chatgpt.com/backend-api/codex/alpha/search`；API key 默认 base URL 为 `https://api.openai.com/v1`；显式 provider base URL 优先。见 [lib.rs:40](/Users/mu9/proj/codex/codex-rs/model-provider-info/src/lib.rs:40)、[lib.rs:292](/Users/mu9/proj/codex/codex-rs/model-provider-info/src/lib.rs:292)。
- 搜索工具获取当前 provider 的 `api_provider()` 和 `api_auth()`，没有单独读取登录文件的实现；见 [tool.rs:101](/Users/mu9/proj/codex/codex-rs/ext/web-search/src/tool.rs:101)。
- ChatGPT bearer 是 `access_token`；见 [manager.rs:563](/Users/mu9/proj/codex/codex-rs/login/src/auth/manager.rs:563)。请求添加 `Authorization: Bearer ...` 和可选 `ChatGPT-Account-ID`；见 [auth.rs:307](/Users/mu9/proj/codex/codex-rs/model-provider/src/auth.rs:307)、[bearer_auth_provider.rs:31](/Users/mu9/proj/codex/codex-rs/model-provider/src/bearer_auth_provider.rs:31)。
- 额外搜索 headers 是可选 `originator`、`x-codex-turn-metadata`；见 [tool.rs:191](/Users/mu9/proj/codex/codex-rs/ext/web-search/src/tool.rs:191)。
- `AuthManager.auth()` 有主动刷新机制；见 [manager.rs:2341](/Users/mu9/proj/codex/codex-rs/login/src/auth/manager.rs:2341)。搜索本身没有显式 401 刷新重试循环，错误直接映射为 fatal；见 [tool.rs:144](/Users/mu9/proj/codex/codex-rs/ext/web-search/src/tool.rs:144)。不能从“复用认证”推导出所有搜索认证错误都会自动恢复。

## 已证实：普通第三方 provider 的工具开放门槛

- `features.standalone_web_search` 当前为 UnderDevelopment、默认 `false`；见 [features/lib.rs:1033](/Users/mu9/proj/codex/codex-rs/features/src/lib.rs:1033)。
- `web_search != disabled` 且 provider 是 OpenAI、actor authorization，或 `supports_standalone_web_search=true`，扩展才贡献 executor；见 [extension.rs:40](/Users/mu9/proj/codex/codex-rs/ext/web-search/src/extension.rs:40)。该 provider 配置字段默认 `false`；见 [lib.rs:148](/Users/mu9/proj/codex/codex-rs/model-provider-info/src/lib.rs:148)。
- Core 还要求 namespace capability、web search capability，以及 standalone feature（或 Responses Lite）；见 [spec_plan.rs:1045](/Users/mu9/proj/codex/codex-rs/core/src/tools/spec_plan.rs:1045)、[spec_plan.rs:1420](/Users/mu9/proj/codex/codex-rs/core/src/tools/spec_plan.rs:1420)。
- 普通 `ConfiguredModelProvider` 仅定制 remote compaction；namespace/search 均继承默认 `true`。第三方兼容 provider 不会被这两项 capability 默认拦截；见 [provider.rs:67](/Users/mu9/proj/codex/codex-rs/model-provider/src/provider.rs:67)、[provider.rs:353](/Users/mu9/proj/codex/codex-rs/model-provider/src/provider.rs:353)、[spec_plan.rs:651](/Users/mu9/proj/codex/codex-rs/core/src/tools/spec_plan.rs:651)。
- 所以按用户“所有 Codex 渠道默认尝试接口”的要求，普通第三方渠道应配置 `web_search="live"`、`features.standalone_web_search=true`、该 provider 的 `supports_standalone_web_search=true`。后端接不接受由真实响应决定。
- 已有 mock 集成测试验证 ChatGPT 和第三方 provider 的 standalone 路径：第三方为 `<base>/alpha/search`、携带第三方自己的 bearer，而非 ChatGPT token；见 [web_search.rs:45](/Users/mu9/proj/codex/codex-rs/app-server/tests/suite/v2/web_search.rs:45)、[web_search.rs:118](/Users/mu9/proj/codex/codex-rs/app-server/tests/suite/v2/web_search.rs:118)、[web_search.rs:206](/Users/mu9/proj/codex/codex-rs/app-server/tests/suite/v2/web_search.rs:206)。

## 已证实：请求、会话与结果

- 请求顶层含 `id`、`model`，可选 `input`、`commands`、`settings`、`reasoning`、`max_output_tokens`；见 [search.rs:9](/Users/mu9/proj/codex/codex-rs/codex-api/src/search.rs:9)。Codex 用 session ID 作为 `id`、当前模型作为 `model`；见 [tool.rs:116](/Users/mu9/proj/codex/codex-rs/ext/web-search/src/tool.rs:116)。
- 文本搜索命令为 `search_query: [{q, recency?, domains?}]`；同一接口支持 `open`、`click`、`find` 等操作；见 [search.rs:31](/Users/mu9/proj/codex/codex-rs/codex-api/src/search.rs:31)。先只暴露文本搜索可减小产品承诺，但读页 ref ID 需要保持同一搜索会话。
- 发送的历史仅取最近两条用户消息及限 1k tokens 的 assistant 文本，不是整段历史；见 [history.rs:14](/Users/mu9/proj/codex/codex-rs/ext/web-search/src/history.rs:14)。
- 响应为 `output: string`、可选 `encrypted_output`、可选 `results: JsonValue[]`。`results` 刻意保持不透明以保留未来类型和字段；见 [search.rs:297](/Users/mu9/proj/codex/codex-rs/codex-api/src/search.rs:297)。已有 fixture 包含 `type/ref_id/url`，但这不是所有真实后端结果字段的完整规范；见 [endpoint/search.rs:137](/Users/mu9/proj/codex/codex-rs/codex-api/src/endpoint/search.rs:137)。
- 搜索开始/完成通过标准 item 生命周期暴露；standalone `WebSearchItem.results` 保留不透明 DTO。见 [tool.rs:131](/Users/mu9/proj/codex/codex-rs/ext/web-search/src/tool.rs:131)、[web_search.rs:13](/Users/mu9/proj/codex/codex-rs/ext/items/src/web_search.rs:13)。

## 已证实：app-server RPC 与引用事件的边界

- 当前 app-server 没有独立调用后端搜索的 RPC。`thread/search` 是搜索聊天历史：参数只有分页、排序、来源、归档和 `searchTerm`；处理器调用 `thread_store.search_threads`。见 [thread.rs:1440](/Users/mu9/proj/codex/codex-rs/app-server-protocol/src/protocol/v2/thread.rs:1440)、[thread_processor.rs:2619](/Users/mu9/proj/codex/codex-rs/app-server/src/request_processors/thread_processor.rs:2619)。名称含 search 不能作为网络搜索接口使用。
- app-server 可以经 `thread/start` + `turn/start` 驱动模型选择 `web.run`，并复用 Codex 自身认证；这是原生工具执行路径，不等于 RPC 接受任意搜索 commands 的直接调用。
- `experimentalRawEvents=true` 才发 raw response 事件，源代码注明 internal use；见 [thread.rs:154](/Users/mu9/proj/codex/codex-rs/app-server-protocol/src/protocol/v2/thread.rs:154)、[thread_lifecycle.rs:349](/Users/mu9/proj/codex/codex-rs/app-server/src/request_processors/thread_lifecycle.rs:349)。
- `rawResponseItem/completed` 载荷仍是已解析的 `ResponseItem`，并非完整后端原始 JSON；见 [item.rs:1407](/Users/mu9/proj/codex/codex-rs/app-server-protocol/src/protocol/v2/item.rs:1407)、[bespoke_event_handling.rs:1139](/Users/mu9/proj/codex/codex-rs/app-server/src/bespoke_event_handling.rs:1139)。
- `ContentItem::OutputText` 只有 `text`，没有 `annotations/url_citation`；hosted `WebSearchCall` 仅 id/status/action 等，没有 `results`。因此不能承诺启用 raw events 就能获得结构化 URL 引用。见 [models.rs:853](/Users/mu9/proj/codex/codex-rs/protocol/src/models.rs:853)、[models.rs:1154](/Users/mu9/proj/codex/codex-rs/protocol/src/models.rs:1154)。Standalone 应优先从标准 `item/completed` 的 WebSearchItem.results 取来源。

## 需要实现阶段验证

- 本机安装的 Codex 二进制是否含上述源码版本、namespace 支持和 standalone flag；本地源码存在不证明已发布二进制可用。
- ChatGPT 搜索接口账户权限、模型限制、ref ID 会话寿命、实际 DTO 字段、限额和错误码；mock 测试只证明客户端链路。
- 每个第三方渠道的 `<base>/alpha/search` 是否实现；按用户要求默认尝试，明确回报 404/405/鉴权错误，不能静默改走官方端点。
- 如需要 Rabbithole 独立 MCP 搜索工具，原生 `web.run` 的模型驱动路径还需包装/新增直接执行边界；不应把一次普通推理回答伪装成确定的搜索执行。
