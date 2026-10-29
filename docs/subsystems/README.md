# Subsystem design references

These pages describe current responsibilities, runtime paths, state, and contracts. Start with the subsystem relevant to your task, then follow its source links to verify the implementation you change.

| Subsystem | Reference |
| --- | --- |
| Built-in subscriptions moving to plugins | [Provider and plugin ownership](provider-plugins.md) |
| Built-in plugins: registry, lifecycle, plugins.yml, presets, settings schemas, the window's kernel (slots, error boundary, kit) | [Plugin runtime](plugin-runtime.md) |
| Plugins that run on the gateway's requests and replies | [Gateway middleware](gateway-middleware.md) |
| Tools that plugins give, offered to every agent as an MCP server | [Plugin tools](plugin-tools.md) |
| Plugins that await context recall and observe completed replies | [Asynchronous gateway request hooks](gateway-request-hooks.md) |
| Claude subscription turns across Claude Code runs | [Claude subscription bridge](claude-subscription-bridge.md) |
| How the gateway picks a provider, key or account, and falls back | [Gateway routing and fallback](gateway-routing.md) |
| Gateway Session Aggregation | [Gateway Session Aggregation](gateway-sessions.md) |
| Connecting an agent's config to the gateway, drift, disconnect, WSL twins | [Agent wiring](agent-wiring.md) |
| Providers, keys, subscription accounts, refresh and allowance | [Providers and accounts](providers-accounts.md) |
| Instructions, MCP servers, skills and RTK written into agents | [Library](library.md) |
| One MCP server, magpie, given to every agent in place of the Library's servers | [MCP hub](mcp-hub.md) |
| Tray, panel, window, `magpie web` and the page's JSON API | [GUI app shell](gui-shell.md) |
| Encrypted backups and setup synchronization over WebDAV, S3 or GitHub | [Sync and backup](sync-backup.md) |

A subsystem can span several packages or repositories. Its reference describes the behavior those parts provide together; it does not need to list every function.

## Maintain a reference

改动如果改变了已记录的责任、接口、状态转换、运行路径、兼容规则或失败行为，就在同一次改动里更新对应的参考页；不改变这些契约的内部重构，不需要改文字。

Keep each fact in one reference and link to it from agent instructions or other pages. Link to source files and named symbols rather than copying implementation details that change frequently. Explain field meanings and constraints that signatures alone do not express.

新增参考页时，写清责任与边界、真相来源、主要运行路径、状态转换、重要约束和现有的验证命令，相关处写明失败与兼容行为。「当前行为」和「拟议改动」要分开写：提案放在自己的 commit 里，不要写进参考页。

## 说明改动的语义影响

对每个受影响的子系统，说明可观察的变化、它的触发条件，以及改动前后的行为差异；涉及接口、状态、兼容和失败行为时一并写出。链接到对应的参考页、实现和验证证据；重构保持既有行为时也要说明。

例如改 plugin 的 adoption 时，要说清它由哪种迁移状态和账号条件触发、改动前后分别由哪段实现处理请求、哪个测试覆盖这个转换。

这是改动者自己的说明，要对着 diff 和周边代码核对；它不是自动证明的兼容性结论。

## Review a change

1. Identify the affected subsystem and the actual runtime path, including plugin or built-in ownership.
2. Compare the claimed before/after behavior with the base and head implementation. Trace relevant callers and state transitions beyond the changed lines.
3. Check that changed contracts appear in the owning reference and that source links still resolve.
4. Check that the cited tests or runtime evidence exercise the claimed behavior. Report checks that were not run.

A documentation update alone does not prove the implementation. Existing tests and runtime evidence remain necessary for behavior changes.
