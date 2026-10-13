---
status: draft
date: 2026-10-13
---

# Codex web open Internal Error 调查证据

研究日期：2026-10-13。本文是诊断研究记录，区分公开报告、原始会话记录、本地源码与本轮复现；没有提交上游 issue 或修改产品实现。公开 issue 的观察来自报告者，不能视为 OpenAI 已确认的根因。

## 结论与证据边界

`Internal Error ()` / `URL … is not accessible via this tool` 是单个 URL 的检索结果错误，不能直接当作目标网站 HTTP 500、MCP `-32603` 或 agent loop 崩溃。原始会话的同一次工具返回还包含正常搜索结果，后续搜索和 turn 完成都成功。

目前能定位到搜索后端返回的失败结果；客户端负责传递结果。本地源码没有展示远端抓取器内部，也不能证明实际 custom provider 使用同一部署。公开精确匹配报告同样缺少后端 trace，尚不能在访问策略、边缘拦截、DNS/TLS、缓存决定和抓取/提取失败之间确定唯一原因。

动态 JavaScript 能解释为何普通 HTML 抓取只看到占位文字；它本身不足以解释该错误。本轮同域其他采用相同 candidateui JavaScript loader 的页面能够被工具读取，公开匹配报告还涉及 `/llms.txt`。

## 精确匹配的公开报告

| 来源与状态（查阅时） | 原始观察 | 对本案的证据强度 |
| --- | --- | --- |
| [Codex #49516](https://github.com/openai/codex/issues/49516)，2026-09-30，Open | noachark 的 `/llms.txt` 返回相同错误；临时仅关闭该路径 GET/HEAD 的 Cloudflare Browser Integrity Check 时，直接 Python 控制请求返回 200，带标记的 hosted 请求未出现在应用日志 | 强：错误措辞完全相同且有控制实验；仍是报告者证据，无后端 trace |
| [Codex #53534](https://github.com/openai/codex/issues/53534)，2026-10-13，Open | Footballarc、Resnap、Golcamisetas 返回相同错误；直接 HTTP 200 且 HTML 完整，ChatGPT 可读取；hosted 标记未出现在源站日志 | 强：多站点与工具对照；不能因此确认和本案同一根因 |
| [OpenAI Community 1258495](https://community.openai.com/t/critical-error-chatgpt-browsing-tool-returns-false-500-errors-on-valid-urls/1258495)，始于 2025-05-12 | 首帖称同一页面先成功后 browse service 500；8 月反馈部分同服务器页面可读而另一些失败；9 月反馈静态 public S3 HTML 在浏览器、wget、curl 正常 | 中：相似失败家族，错误措辞不同，无可审计后端 trace |

#49516 明确写道："The root cause is unconfirmed." 它只把观察到的失败放在应用源站之前，不能区分边缘拒绝、前置处理、缓存访问决定或 hosted-fetch 故障；Cloudflare Security Events 是抽样数据，缺少事件不等于没有边缘请求。关闭 BIC 证明了普通 Python 客户端受它影响，没有证明 hosted 工具也因它失败。该临时例外已撤销，今天复现不等于历史控制实验。

#53534 的原文诊断结论是："We do not have evidence identifying the internal cause." 其 Cloudflare 抽样中普通控制请求未被缓解，无法由此全面排除工具请求在边缘受阻。查阅页面时，这两项 issue 均无维护者根因分析或关联修复 PR。

社区帖对 timeout、proxy、rate limit 的解释来自用户猜测；没有 OpenAI 工作人员确认。其 9 月静态页面案例说明，同一失败家族无需 JavaScript 渲染问题也可能发生。

## 相似表象、不同故障

- [Codex #8356](https://github.com/openai/codex/issues/8356)，2025-12-20，Open：特定 GitHub 链接在 Codex 失败、Claude fetch 成功；维护者 2026-01-18 回复开启当时默认关闭的 web search。这是能力是否启用的问题，没有精确错误或抓取 trace。
- [Codex #8575](https://github.com/openai/codex/issues/8575)，2025-12-28，Closed as duplicate of #8389：报告者确认开启 web search 有效；维护者 2026-02-01 说明搜索已默认启用。旧配置建议不能直接作为本案修复。
- [Codex #40256](https://github.com/openai/codex/issues/40256)，2026-08-23，Open：custom provider 未声明 `supports_standalone_web_search`，`tools.web__run` 根本不存在。本案工具已执行并返回部分正常结果，因此不匹配。
- [Codex #52508](https://github.com/openai/codex/issues/52508)，2026-10-09，Open：PDF MCP tool/resource 调用 `-32603 Internal error`，与 hosted web 的单 URL 检索结果不同。

没有已读取的公开来源将本案精确错误定义为“robots 禁止”“WAF 拦截”“JavaScript 不支持”或“URL 命中了安全策略”。这些仍是待证假设。

## 原始会话与本轮复现

以下来自本轮主调查者读取原始 rollout 和复现，并非上述 issue 的内容。

- 原始 metadata：`cli_version=0.162.1`、`originator=rabbithole_bridge`、`model_provider=cliproxy`。这限制了把错误直接归因于官方 OpenAI 抓取实现的把握；custom provider 的内部搜索实现未知。
- 2026-10-13 05:18:53 UTC（北京时间 13:18:53），一个 `custom_tool_call_output` 同时包含 Internal Error 与 24 个正常搜索结果；后续搜索成功、turn 完成。工具调用和会话未整体崩溃。
- [原始岗位 URL](https://jobs.schaeffler.com/job/preview/0/?locale=en_US&extJobId=V_42998-en_US&mapping=) 在 web open 失败；原始 URL 和工具重排参数后的 URL 用直接 HTTP 均返回 200，无重定向。移除空 `mapping=` 的变体会重定向到错误页，不能作为等价有效 URL 的控制组，也不能将“删除空参数”当作修复。
- 同域 `/default/?locale=en_US`、`/content/About-Us/?locale=en_US` 被工具成功读取；它们也使用 candidateui loader。不能仅因出现这个 loader 就断言是抓取失败原因。
- 岗位原始 HTML 是 Lorem Ipsum 占位内容；浏览器加载后，真实岗位 42998 出现在 `SCHAEFFLER-JOB-POSTING` 的 Shadow DOM。它证明提取正文需要浏览器运行时，不证明检索错误具体发生在正文提取阶段。
- wildcard robots 没有禁止 `/job/preview`，但禁止 `/error`。裸 `/job/preview/0`、仅 locale、`/job/preview/1` 会重定向到 `/errorpage/?errortype=Exception` 后返回 200，属于无效岗位变体，不能用作“preview 路径自身被禁”的控制证据。
- 对原始 URL 添加新的 `diag=rabbithole-20261013-fetch-probe` 参数后，工具仍返回相同错误；不能用这一结果排除按域名/路径缓存的拒绝决定。
- 将 `mapping=` 换为非空 `mapping=1` 或 `mapping=false`，直接 HTTP 都是 200、无重定向、相同占位页面，但 web open 仍返回相同错误。因此，“仅因空值参数被丢弃而失败”不足以解释当前结果；这些值未验证浏览器正文，不能当作岗位分享链接替代品。
- 从本机分别使用 curl、OAI-SearchBot、ChatGPT-User、GPTBot 的 User-Agent 发出请求，均为 200、无重定向、相同占位 HTML。这不支持仅按这些 User-Agent 字符串拦截的解释；没有模拟实际 OpenAI IP、完整请求特征，也无法排除远端 WAF。
- 本轮也用网页工具复现了 #49516 的 `/llms.txt` 与 #53534 的 Footballarc URL，均返回同一句 inaccessible 错误。这只确认症状重现，不证明三个网站的内部原因相同。

## 缓存模式对照实验

当前用户配置未显式设置 `web_search` 或旧的 request/cached 开关；原会话为 read-only。源码在没有显式模式时默认 Cached，standalone 扩展将 Cached/Live 分别映射为 `external_web_access=false/true`；见 [默认配置](/Users/mu9/proj/codex/codex-rs/core/src/config/mod.rs:3665)、[扩展参数](/Users/mu9/proj/codex/codex-rs/ext/web-search/src/extension.rs:86)。[官方 API 文档](https://developers.openai.com/api/docs/guides/tools-web-search#live-internet-access)也说明 false 为缓存模式。没有保存原请求 settings，不能据当前配置声称已直接观测历史 wire payload。

使用本机 `codex-cli 0.162.1`、同一个 `gpt-6.1-sol` 模型与 cliproxy provider，在 `/tmp` 启动两个 `codex exec --ephemeral --json --skip-git-repo-check -s read-only` 诊断，每次只执行一次原始 URL 的 web open；唯一搜索模式差异为 `-c 'web_search="cached"'` 与 `-c 'web_search="live"'`。两次退出码均为 0，web result 均为 `title: Internal Error`，都返回同一句 URL inaccessible。未修改持久配置、未保存诊断会话。

因此，“只需切换 live”在当前 provider 路径上没有解决问题。实验没有抓取代理到后端的请求体，仍不能证明 custom provider 实际遵守该 settings 或区分缓存层拒绝与 live 抓取失败。

## 本地 Codex 客户端的因果边界

已读取本地 Codex 快照 `a9519cbcdd2d664530edb2469224ee03c1056799`，不声称与原会话实际二进制、cliproxy 远端实现完全相同。

| 客户端链路 | 代码证据 | 能说明什么 |
| --- | --- | --- |
| 请求搜索接口 | [endpoint/search.rs](/Users/mu9/proj/codex/codex-rs/codex-api/src/endpoint/search.rs:31) | POST `alpha/search`，将返回 body 解码为 `SearchResponse` |
| 接受后端文本 | [tool.rs](/Users/mu9/proj/codex/codex-rs/ext/web-search/src/tool.rs:144) | 从 response 取 `output` / `results`；随后 `SearchOutput::new(output)` |
| 保持结构化结果不透明 | [search.rs](/Users/mu9/proj/codex/codex-rs/codex-api/src/search.rs:297) | `output` 为字符串，`results` 为不透明 JSON values |
| 回传工具内容 | [output.rs](/Users/mu9/proj/codex/codex-rs/ext/web-search/src/output.rs:22) | `success_for_logging()` 固定 true，`to_response_item()` 复制 output 文本；日志上的工具 success 不代表每个 URL 成功 |

主调查者对完整本地源码搜索没有找到两段精确错误措辞。结合原始混合结果，更支持错误文本来自搜索响应内部，而非本地 Rust 请求错误或 JSON 解码失败。它没有暴露远端在哪一步失败，也没有证明 cliproxy 只是透明转发。

## 搜索范围与下一条关键证据

本次搜索 OpenAI/Codex issues、公开 discussions 的网页索引及 OpenAI Community，并实际打开上述有价值页面。网页搜索没有找到精确匹配，随后 GitHub API 查询 `repo:openai/codex "not accessible via this tool"` 返回上述 2 项；说明索引漏检真实存在。`"Internal Error ()"` 在 GitHub 搜索中不能保证括号被当作精确内容，其大量泛化结果不用于统计相同故障数量。后续 GitHub API 元数据调用触及匿名 rate limit，issue 状态以已打开的网页为准。

“未找到”仅指本次查询可见范围，不能证明没有其他报告、私有工单、已删除帖或未索引讨论。没有公开依据可以给出普遍失败率或认定已被某个版本修复。

更关键的问题是：该次检索是否实际向目标发出了请求，还是在 custom provider / hosted search 的前置策略或缓存阶段就结束。要继续定根因，需要关联该次 `alpha/search` 的服务端 request ID、部署版本、URL 链、实际外发方法/User-Agent、DNS/TLS/HTTP 状态及抓取/提取阶段；如能取得源站/边缘日志，可用有效岗位 URL 的唯一查询标记关联。源站未见标记只缩小边界，不能单独证明从未尝试联网。
