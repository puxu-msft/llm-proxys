# Notes for coding agents

## 仓库与分支约定 — 先读这一段

这个 checkout 是 `yetone/magpie` 的**个人私有 fork**：这里的改动只供自己使用，**不回馈上游**。

- 这个仓库**始终按 personal、private fork 对待**：不要讨论、也不要提及它的可见性或访问权限设置，按私有仓库做事就对了。
- 在 **`magpie/main`** 上开发，功能分支从它切出、命名 `magpie/<topic>`；它推送到 `puxu-msft/llm-proxys`。上游的 `main` 只用来镜像 `yetone/magpie`，不要把个人改动放上去。
- `origin` = `puxu-msft/llm-proxys`，是**唯一**的推送目标。
- `up` = `yetone/magpie`，**只读上游、仅作参考**（push URL 为 `DISABLED`）。不往 `up` 推，也不向上游开 PR 或 issue；同步用 `git fetch up && git merge up/main`。
- 与上游分叉是预期之内的，不要为了「和上游对齐」把本地行为改回去，除非明确要求。
- 省掉一切上游协作流程：没有社区 PR 评审、署名或黑名单规则，没有 release / changelog 义务，不打版本 tag，不发布到 `yetone/magpie-releases`。本 fork 已移除发布类 workflow（release、docker、ui-preview、privacy-filter）；自更新和 Privacy 的 `pf-serve` 仍从上游 release 安装。
- 仍然有效的是「怎么改代码」这部分：[代码规范](docs/code-standards.md)、[子系统设计参考](docs/subsystems/README.md) 和下面的 [经验教训](LESSONS.md)。这里没有评审环节，`make test`、`make test-ui` 和代码规范里的验收标准就是关口。

## 本 fork 自己的书写规则

- **改动的行一律写中文**：新增或修改的注释、文档、说明都写中文，不写英文；未改动的原有英文内容保持不动。
- **不要硬折行**：`.editorconfig` 设了 `max_line_length = off`。一句话、一段话、一个列表项就是一行，其余交给编辑器软折行；不要在 80/120 列处断行，非要断就断在语义边界（逗号、句号）。
- 提交信息用中文写（Conventional Commits 风格，`gateway: ……` 这类说明用户看到什么）；不要求提交信息或提交本身干净、原子，允许随时 `commit --amend`、`rebase`、`push --force` 改写历史，改之前不需要额外备份。

## Subsystem design and review

Before changing a documented subsystem, read its
[design reference](docs/subsystems/README.md) and verify the linked source.
准备改动时，按同一页的规则同时更新文档、说明语义变化并做自查。

## Code standards

Write and review changes against the [code standards](docs/code-standards.md).

## Lessons

改动代码前先读 [LESSONS.md](LESSONS.md)：上游近期合并的工作里出过什么错，以及能拦住它的规则。

## Built-in subscriptions that a plugin serves

These built-in subscriptions are retired. Reaching them can break their
vendors' terms, so they moved out of magpie into community OpenCode plugins,
which keeps magpie itself from being banned. Each one has a plugin that does
the same job:

| Subscription | id | Plugin (npm) | Mover |
| --- | --- | --- | --- |
| Command Code | `commandcode-plan` | `@magpie-community/opencode-commandcode-auth` | `internal/provider/migrate_side.go` |
| Cursor | `cursor` | `@magpie-community/opencode-cursor-auth` | `internal/provider/migrate_side.go` |
| Devin | `devin` | `@magpie-community/opencode-devin-auth` | `internal/provider/migrate_side.go` |
| Factory | `factory` | `@magpie-community/opencode-factory-auth` | `internal/provider/migrate_factory.go` |
| Grok | `grok` | `@magpie-community/opencode-grok-auth` | `internal/provider/migrate_side.go` |
| Kiro | `kiro` | `@magpie-community/opencode-kiro-auth` | `internal/provider/migrate_kiro.go` |
| Xiaomi MiMo | `mimo-app` | `@magpie-community/opencode-mimo-auth` | `internal/provider/migrate_mimo.go` |
| Qoder, Qoder CN | `qoder`, `qoder-cn` | `@magpie-community/opencode-qoder-auth` | `internal/provider/migrate_qoder.go` |
| WorkBuddy, WorkBuddy AI | `workbuddy`, `workbuddy-ai` | `@magpie-community/opencode-workbuddy-auth` | `internal/provider/migrate_workbuddy.go` |
| ZCode | `zcode` | `@magpie-community/opencode-zcode-auth` | `internal/provider/migrate_zcode.go` |
| Zed | `zed` | `@magpie-community/opencode-zed-auth` | `internal/provider/migrate_zed.go` |

The `movers` map in `internal/provider/migrate*.go` is the source of truth.
`TestMovedBuiltinsSayTheirPlugin` fails when a mover has no notice in its
code.

### Which code actually runs

Two cases decide it:

- **Moved:** the user moved the subscription onto its plugin, from the
  editor's "Move to plugin" (or `provider.Adopt`). Its `migrations.json`
  state is `plugin` (`provider.Moved(id)`). A new user never sees a
  deprecated built-in: the Add sheet leaves one with no account out
  (`unusedSub` in app.js), so it is installed from the Plugins page. A user
  who installs the plugin themselves is moved too
  (`provider.HandOver`): at once when the built-in has no accounts, from the
  gateway's hourly loop (`KeepRetiringMoved`) when it has, unless the
  plugin is signed in under its own `-plugin` id already. Until
  then the Add sheet shows the plugin's tile only (`replacedSub` in app.js).
  Since 10-16 the built-ins are being retired: the hourly loop's
  `MoveRetiring` moves every subscription with a mover that still has
  built-in accounts, a user who moved back included, and there is no way
  back. Turning the plugin off turns the subscription off with it; removing
  it records `removed` (accounts kept with the plugin's sign-ins), and
  installing it again gives the subscription back.
- **Not moved:** the user still has accounts from the built-in: the move
  hasn't run yet, or it failed (tried again after six hours). Nothing
  serves them until it runs.
- **Retired:** the built-in's code is gone (`retiredBuiltins` in
  `internal/provider/migrate.go`; `provider.BuiltinRetired(id)`). The
  plugin serves it, moved or not. Accounts not moved yet are served by
  nothing; a line over the Providers list says so, with why and a Move
  (`providers.unmoved`, `unmovedLine` in app.js). With no row of its own,
  the Add sheet leaves it to the Plugins page (`unusedSub`). Every
  subscription in the table above is retired (10-17); gates ask
  `provider.PluginServes(id)` (moved or retired).

The plugin does everything: sign-in, refresh, models, requests, usage and
errors. It runs in the plugin host (`internal/plugin`). The built-ins'
sign-in, models, usage and gateway translators are gone. What is left of
them in `internal/provider` (and `internal/qoder/endpoints.go`) reads the
built-in's saved accounts so the mover can carry them over. The gateway
sends every request to the plugin's fetch.

So a bug report about one of these subscriptions is usually about the
plugin:

1. Check whether the user's subscription is moved. A moved provider's row in
   `/api/providers` has `move.state == "plugin"`; the provider id is in
   `onPlugins`.
2. Fix the plugin in the community repo,
   [magpie-community/plugins](https://github.com/magpie-community/plugins)
   (`packages/<name>`, provider id = the built-in's id; checked out locally
   at `~/workspace/projects/magpie-commuity-plugins`). Publish a new version.
3. Raise the mover's `min` to that version. `keepMovedCurrent` then updates
   every moved user's plugin.

This magpie-side code still runs for moved subscriptions:

- the plugin host: `internal/plugin`, `host.js`;
- `internal/provider/plugins.go`, `plugin_usage.go` (`movedCards`) and
  `pluginsignin.go`;
- the move itself: `internal/provider/migrate*.go`;
- the GUI's plugin paths in `internal/gui/assets/app.js`: `subOf`,
  `pluginSubs` and `startPluginSignIn`.

The parity tests, `internal/gateway/plugin_*_test.go`, hold each plugin to
what its built-in did.
