# Code standards

这些规则来自历次改动里反复被提的问题。改动收尾前逐条自查；哪条没做到就补上，不要带着它落地。子系统改动的描述与自查方式见[子系统参考](subsystems/README.md)。

## What a change contains

| 规则 | 检查什么 |
| --- | --- |
| 一次改动只做目标需要的事。 | 每一处行为变化都有理由；无关的重构、顺带加的功能、策略调整不属于这次改动。 |
| A fix covers exactly the cases it means to. | Which cases change, and which neighboring ones stay the same. Different errors are not handled as one. |
| A change holds on the whole path. | Follow it from the user's input to the end result, through the callers, the state it changes and the side effects. One correct function doesn't make the whole operation correct. For example, an agent's model picks are saved under one id and read under another (#926). An update button doesn't update the binary that actually runs (#930). |
| A fix reaches every sibling of the bug. | Grep for the same pattern: every agent, subcommand, guard of the same shape and caller of a changed predicate gets the fix in the same change. That includes the other branches of the same operation and the other messages that name the same endpoint or rule. On 2026-10-05 six fixes needed a second release because they covered only the case in the report. On 10-06 #933's Codex models followed an hour after its sign-in. On 10-07 cd8d64a9 (#1059) offered sub2api's balance URL in one hint, while the error shown after a failed balance read still names only new-api's. Pi's whole-file move of mcp.json had no backup until d40fee80 (#1097), though the merge branch beside it already had one. |
| A change re-derives everything built on what it changes. | When a change alters a formula, a list, a layout breakpoint or the timing of an async step, find every caller, saved copy and test that assumed the old meaning, and run it. 12cba74a kept Zed's old clamp under a new max_tokens. 5d871723 (#860) moved the Requests page's columns to 1150px, and click-scroll was red on main for most of 10-07 (82a36a35). ee2588c2 added an immediate re-read, and the test's assertion about the state in between became a race on Linux CI (3e38bd76). |
| A failed read, parse or hash means "unknown". | It never means "empty", "none" or "equal". Keep what was read before, copy a file that doesn't parse aside before writing over it, and fix the shared reader rather than writing a strict one beside it. A list that guards access (an allow list, a key limit) fails closed when its file can't be read. Test with the file unreadable. readLogins wrote a parse error back as "no accounts" (b363327d), and agent/stash.go had the same bug two days later (270b5257). On 10-12 7a9490638's IP allow list read an unreadable settings.json as an empty list and let every address in (7d9382db2). On 10-13 #2017's patch read an unreadable codex-autoreset.json as "no reset spent" (e297a8ab2). |
| Another app's values come from that app. | When magpie writes another app's file or speaks for it, take each field's type and value from that app's own data, binary, merge code or docs, not only its field names. 84554e57 wrote updatedAt in milliseconds and hung Claude Desktop's skills page (#863). #966 guessed Codex's limit_reached, which #996 undid after reading ChatGPT.app. On 10-13 accc8c090 copied Claude Code's OAuth client names but sent its own redirect_uri (127.0.0.1, where Claude Code sends localhost); e0ecf0161 read the binary and fixed it. |
| Nothing that can block runs under a lock its reader needs. | Never send on a channel or call anything that can block while holding a lock the receiver takes first. Set shared state before the handoff that lets another goroutine look at it, and a struct copied by value that holds a map is not a copy. A fake server's handler runs on many goroutines: guard what it records with a lock, and count only the calls the test makes, since background reads reach it too. A change that starts a goroutine or timer runs `-race` before it is pushed. 85fd35ab hung macOS -race CI (4fb8e887). 01e66e0f's marshal wrote into a shared map (15afd988). On 10-11 7cba316b9's turn-done timer read fields on its own goroutine and went red under -race (a2afc1828). On 10-13 TestKeptLoginStandsAtItsPlace's fake Codex appended from two goroutines (a75de4c21). |
| magpie 的默认值不覆盖用户自己设的值。 | 写一个 key 之前，列出 agent 或 magpie 会从哪里读这个设置，并带上用户自己设的值来测。迁移要重写某个设置时，先点名那些自己设过它的人，保留他们的值，或者在 commit 正文里说明为什么不改。CLAUDE_CODE_AUTO_COMPACT_WINDOW 覆盖了用户自己的 autoCompactWindow，持续了约 150 个版本（602d4ec6）。10-10 有四个修复（603dc0c4、5aca7d09、c65d9fb4、d9bf7c1c）一开始都没有带用户设值的测试。10-17 5a2414acd 把所有没标 settled 的 Essentials 预设一并抬成 All，其中包含用户自己跑过 `magpie plugin preset essentials` 的那份（#2749）。 |
| Checks cover the edges the change touches. | For numbers, check the boundaries. For paths, check each platform (macOS, Linux, Windows). For concurrency, check races and stale state. Pick checks by risk. |

## Tests

| 规则 | 检查什么 |
| --- | --- |
| 修复必须带一个去掉它就失败的测试。 | 把旧代码放回去跑该测试，它必须失败；commit 正文写明失败信息。为某个保证命名的测试，把该保证手动破坏后必须变红：#1318 的 TestHistoryWriteHoldsNoWaiter 在 waiter 被持有（#1358）时仍然通过；10-12 bbe8825c0 的 memo 测试在淘汰逻辑反转后仍通过（9dd5917a4），10-13 e21b1dbc1 的测试在丢掉 is_error 后仍通过（cc93b566e）。 |
| A test never reaches the network. | A vendor's page or API is served from httptest, built from bytes saved from the real one. A package comes from a lock file, not a registry's latest. Break the change and watch where the test's requests go. 9755201b opened ChatGPT and hung on its Cloudflare challenge. On 10-11 a library test reached the real GitHub with the icon proxy off (f04792f9). On 10-13 TestPiPackage tested npm's latest pi that minute (f230fa23b), and plugin and cli tests waited 30s on the real models.dev (bde11c778). |
| Tests use real inputs. | Fixtures look like real requests, real serialized output and real files on disk. That includes missing fields, empty values and defaults. |
| Tests check behavior, not implementation. | Assert what the user or caller needs. Formatting changes and internal refactors shouldn't break a test, unless exact bytes are the requirement. |
| main 上失败的测试，是现在就修的 bug。 | 「在 origin/main 上也是一样失败」不是基线，「整个 run 才失败、单独跑能过」也不是。在它的成因处修掉，并单独用一个 commit 记录，再在它上面继续做。10-05 到 10-07 有几十个 commit 带着红测试落地，其中有些是真 bug：一个 data race（a45b3e09）、测试顺序（bfe8bcaf），以及 click-scroll 自 5d871723 起就红着，dcbae2ef、76d82528 和 b2345078 都从它上面过去了。把一个 Go 测试称为 flake 之前，先跑 `go test -race -count=20 -run X`。 |
| Tests stay out of the real machine. | Run them under a temp HOME with Go's caches pinned (see the snippet in [provider-plugins.md](subsystems/provider-plugins.md)). Never touch a real agent's config or `~/.config/magpie`. An agent's variable goes in `agentenv.Vars`, so the sandbox clears it. |
| Whatever a test starts ends when the test does. | A fake process, a goroutine or an async refresh a test sets going is stopped or waited for before the test returns, or it writes into the next test's folder ("directory not empty") or spins for days. A package that isolates itself in its own `TestMain` instead of `testenv.Run` sets what testenv sets, `testenv.Marker` included. TestClaudeSignInByPaste's fake polled for 2 days (38a0f470). On 10-11 a CLI-identity ask outliving its test broke the next one (#1524): 4ee3a76b fixed it in internal/gateway only, 9c377231 for every package through the marker, which the gateway never set (a349de82). |
| A timing test leaves room on both sides. | Never bound a test by wall-clock time a loaded runner can exceed, and keep a threshold classifier's fixture far from every threshold it has. Reproduce a timing failure by injecting the delay (a held write, a late first arrival), not by rerunning until it fails, and list every timing assumption in the test when fixing one. 319b72c7 fixed one of two loops sharing a 2000-line bound and the other went red 9h later (229ce19a). On 10-11 TestMaxRPM's flake was a real gap: a first request that reached the vendor late let the vendor see one too many in its minute (ce1ecaa4), and the queued-stream tests timed the client's clock under CPU starvation (3f4287e6). |

## Acceptance criteria

一个改动只有在满足下面每一条时才算做完。写清哪些跑了、输出了什么；没跑的列为「未跑」，不要省略。

1. **A test that fails without the change.** Put the old code back and run
   the new test. It must fail with a real `FAIL` that names the behavior. A
   compile error or a skipped test doesn't count. Say which test fails and
   what it failed with. Then restore the change and check the test passes.
2. **Tests in a sandbox.** Run Go tests under a temporary HOME with Go's
   caches pinned: `GOPATH`, `GOMODCACHE` and `GOCACHE` taken from `go env`
   before HOME is swapped. Remove the HOME afterwards with
   `chmod -R u+w "$h"; rm -rf "$h"`, because the module cache in it is
   read-only. The snippet is in [provider-plugins.md](subsystems/provider-plugins.md#verification).
   Without the pinned caches, every run downloads 1–2 GB into a new temp
   HOME. A test never reads or writes a live agent config (`~/.codex`,
   `~/.claude`, `~/.claude.json`, `~/.gemini` and the rest) or
   `~/.config/magpie`. Packages set this up in their `TestMain`, most with `testenv`.
3. **The build and the suite.** Run `gofmt -l` on the changed files (it
   prints nothing), `go vet ./...`, `GOOS=linux go vet -tags nogui ./...`,
   `GOOS=windows go vet ./...`, `go build`,
   `GOOS=linux go build -tags nogui`, `GOOS=windows go build` and
   `go test -tags nogui ./...`. A cross-OS build doesn't compile
   `_test.go` files; vet does. On 10-08 bbf99143's test called
   `syscall.Getsid`, which Linux's syscall package doesn't have, and
   bb8a3e30 and e7de897f shipped unformatted. In a chain of commands, set
   `set -o pipefail`, so that `go test | tail && git push` stops on a
   failure. Run `./...`, not the packages you think you touched: the
   repo's guard tests live in packages a change doesn't touch.
   TestFolderVarsAreListed (internal/agent) fails when a new agent
   variable isn't in `agentenv.Vars`, TestNoCommandBypassesProc
   (internal/proc) when code calls `exec.Command` instead of
   `proc.Command`, and an output format change breaks another package's
   test that pinned the old text. On 10-13 four commits ran chosen
   packages and turned main red this way: 6fa3109ea (494609866),
   43d8a5633 (24146c031), 5617281f5 and cdb7b5ff7 (c6de0d2a5).
4. **GUI tests in both engines.** A change to `internal/gui/assets` runs the
   Playwright tests it touches in Chromium and WebKit (`make test-ui`, or
   `BROWSER=webkit node --test …`). The suite must also pass in Chinese,
   English, and `gui-zh-tw`/`gui-ja`/`gui-de` (every string has its
   Traditional Chinese, Japanese and German, with the same placeholders).
   CI doesn't run this suite, so it is run locally. Run the whole suite, not only the touched page's tests, when a
   change adds an API the GUI calls, a selector or class other pages share,
   a CSS feature older WebKit lacks (`:has()`), or a layout breakpoint. On
   10-07, 479865bc, 134d388b, 61838f7c and 51626258 cleared four tests left
   red by commits that had run only their own page's tests. On 10-08
   aff4f9f2's zh-TW was built before 685fa5dc's and 9dc0121f's strings
   (b1e795e5 added four 10 minutes later), and usage-ledger was red for
   about 7 hours after 586f2bce. When you reword a string, `git grep` the
   old text under `internal/gui/tests`, and test the empty case (a model
   with no list price, an account with no usage).
5. **Real use where possible.** A change to a provider, subscription or
   agent is also checked against the real thing: a real account or key, the
   agent's real config format, the vendor's real reply. Do this in a sandbox
   HOME with copies of the credentials. Never touch the live gateway or a
   running magpie. If a real check isn't possible, say so. What wasn't
   tried with the real thing isn't built on and isn't told to users as
   working. A platform report (Windows, WSL, Linux) is checked on that
   platform; the Windows box and its WSL2 distro are there, and a GOOS
   build is not a test. A test of a gateway guard goes through the real
   server stack or the built binary (b2345078 called Handler without
   lanGuard, and every such call got 401). When the guesses about a vendor
   differ, design the check that tells them apart, or ask the reporter to
   run it. On 10-08 bbf99143 said "not tried on Linux" and
   broke Linux vet; #1185's Linux-only reap failure was reviewed on macOS
   only. a24458ca (#1063), 5d0c1dca (MSIX not tried, said plainly) and
   #1328 (on the Windows box, six break checks) are the model.
6. **The UI rules** under [GUI](#gui) hold: `t()` strings, the app's own
   menu instead of `<select>`, no scroll on click, no colored left-border
   stripes.

改动以 commit 的形式落到 `magpie/main`，在自己的 worktree 里做，commit 正文写明跑了什么、在哪个 tree 上跑的。本 fork 没有评审环节、也没有发布流程：验收标准由改动者自己跑，`make test`（GUI 用 `make test-ui`）代替 CI 绿灯；没有运行记录的改动，事后无从核对。

被移动的订阅在 npm 上发布了新版本时，mover 的 `min` 当天就要抬到那个版本，因为 `keepMovedCurrent` 只按 `min` 安装。把版本写进 mover 的 `min` 之前，先 `npm view <package>@<version> --prefer-online` 确认；zed 0.1.9（10-18）和 factory 0.1.38（10-24，10-28 才在 490c0a4ad 抬起）在逐个比对 npm 之前一直没人拿到。

## 改动完成前的自查

下面这些来自最近的评审，逐条对照自己这次的改动：

- **真的跑一遍。** 把改动构建出来，在结果上跑验收标准；只看 diff 不算自查。
- **故意弄坏它。** 把修复回退，或用几种方式破坏它保护的那段代码，确认新测试每次都能抓住（#901 用四种方式破坏了 `backup.go`）。
- **查厂商本身，而不是改动对它的转述。** 厂商行为要读上游源码（#870 读了 Codex 的 `uses_openai_actor_authorization`）。拿改动去撞真实上游：#853 发现多数 Chat 上游不会续写结尾的 assistant 消息。
- **每个平台和架构都要看。** 在 arm64 上安全的 `int` 转换在 `GOARCH=amd64` 上可能回绕（#877）。Windows 把被拒绝的连接报成 `WSAECONNREFUSED`，`syscall.ECONNREFUSED` 匹配不上（#805）。
- **看完整条路径。** 检查一个选择是不是存和读用同一个 id（#926）、按钮作用在实际运行的那个东西上（#930）、别名和 User-Agent 不会和别的 agent 撞名（#926）。`agentenv.Vars` 里的名字除 `agentenv.NotPaths` 外都按文件夹路径处理（#922）。
- **归类要窄。** 一个标记或错误类别只覆盖它描述的那种情况：#873 把一轮里的所有失败都算成「被拒绝」。
- **预览不写任何东西。** dry run、plan、preview 都没有副作用（#827）。
- **不要推翻既有的产品决定。** 滚动护栏、按钮光标这类决定属于上游，只有被明确要求时才反转。
- **GUI 套件。** 通过数与 `main` 对比；在 `main` 上也失败的测试不是基线（见 [Tests](#tests)）：修掉或记录下来，绝不带着它继续。
- **文档要对得上源码。** 参考页要对着它链接的代码核对，链接必须都能打开（#889）。
- **改动只做自己的目标。** 无关的测试和重构各自单独一个 commit；注释写函数名不写行号；fixture 的名字要对得上它代表的东西（#901）。

## Go

- Write `any`, not `interface{}`.
- Read environment variables that name a folder with `appdir.Getenv`, which ignores a relative path. A variable in `agentenv.Vars` that names no folder goes in `agentenv.NotPaths`.
- A comment says what the code is for, in a sentence or two. Name functions instead of giving line numbers, which go stale.

## GUI

- Every string the user sees goes through `t()` and gets its translations in `i18n.js`. Tests run in Chinese and English.
- Use no native `<select>`. Dropdowns use the app's own menu (`openProtoMenu`).
- A click never scrolls the page (`scrollOnPurpose`).
- Don't use colored left-border stripes. Mark state with a dot or a swatch.

## Commits

commit 信息写中文，先点出改动的区域，再说用户看到什么，用平实的行为语言写：`gateway: a 429 that says the balance is spent is out of credit, not a rate limit`。

本 fork 不要求提交信息或提交本身干净、原子：一件事放几个 commit、几件事合成一个 commit，都按当时的节奏来；正文里能看出怎么验证的、或哪个测试去掉改动会失败，就够了。改写历史要在**明确授权之后**才做——`commit --amend`、`rebase` 由用户点头再做，推送用 `git push --force-with-lease`（不要用 `--force`）；得到授权也不等于可以随便，能做好就做好（该合并的合并、该拆的拆、说明写清楚），改写前不需要额外备份。

A checkout, a worktree and the logs in it belong to the session that made
them. Work in a worktree of your own (`git worktree add --detach`), never
check out, commit from or clean another session's, and after committing
check that `git show --stat HEAD` lists your files and only yours. On
10-09 2018882e carried the davsync subject but held another session's GTK
fix, taken from a shared index. On 10-12 3e88fc09d carried the auto-mode
subject but held the Get started card (#1825). On 10-17 another session
checked out origin/main in 7660399a1's worktree mid-run, and another
deleted part of 17557132c's GUI log.
