<!-- upstream-reviewed-through: e297a8ab2 (2026-10-13 23:30 +0800) -->
# 上游已合并工作的经验教训

这是上游项目自己的评审日志，作为参考留在这里。上游那边 magpie 的代码由 agent 编写、评审、合并和发布，每晚都会复盘当天提交里哪些又被返工、哪些本不该合并、哪些验证得太薄，学到的东西记在这里。改动代码前先读它。每条教训的写法是：规则、原因、证据；「Seen」是评审发现它的天数，被看到 3 天以上的规则会移进 [docs/code-standards.md](docs/code-standards.md)。

本 fork 没有 issue 队列、没有社区 PR 评审、也没有发布流程，所以涉及这些的部分（读别人的报告、合并、打 tag、Latest、发布）在这里不适用。剩下的是工程规则：每条都对着本地改动自查，CI 绿灯的位置由 `make test` 顶上。

下面这些是上游那段日子的复盘（那几天里每天 100～600 个 commit、十几个 tag）。留在这里的不是日志本身，而是复盘反复捞出来的模式。本 fork 没有 nightly 复盘、没有 release 和 tag、没有 issue 队列和社区 PR，所以下文引用的版本号、tag、issue 编号和社区贡献者都只是上游当时的事实，留着当证据；要照做的是规则本身，由改动者对照执行，`make test` 就是关口。

复盘里反复出现的是这几类：

- **跑得不够全**：只跑自己改的包，把别的包里守规矩的测试弄红；只跑自己那一页的 GUI 测试，把其他页面弄红。
- **看到红就当成负载或「main 上也一样」**，然后带着它继续往下做。
- **修报告里的那一个，而不是那一类**：同一个 bug 的兄弟位置（别的 agent、别的路由、别的 provider）没跟着一起修。
- **时间**：用固定时长去等状态、用挂钟时间做断言、把日期写死到「明天」。
- **隔离**：测试里起的进程或 goroutine 没在测试结束时收掉；一个 checkout 或 worktree 被两个 session 共用。
- **安全**：按字段名而不是按值在协议里的位置做豁免；文档里写明的洞没人跟。

## 从报告到修复

**先照着报告人在他那台机器、那个界面上的具体情况复现出来，再说修好了。** 用他们的 provider、套餐、agent 和布局，和他们用的 GUI / TUI / CLI。核对的是他们想要的结果（能拖动、标题显示出来、原因可读），不是通往结果途中的某一步。

- #834 返工了 4 次（v0.1.920 → .925 → .931 → .938），每轮只修了截图里那一个 agent；#792、#743、#791 和 #933 在几小时内被关掉又重开。
- 4788cf2b 把 gnayiab 的 Cursor 列表报错做进了 GUI；报告人用的是 WSL 里的 TUI，f3c05b5e 才对。
- 60b910b7 优化的是热启动的 /api/state，而报告说的是冷启动（约 8.5s 的 SyncCatalog）；2a4042a9 才对。
- 10-13：def3a41e3 在一个报告人（Fallmonkey）已经喊停（「先别做」）的请求上开工，被 2c30e5cee 回退。动手前把整条讨论读到最后一条。

**fixture 用报告人给的原样字节，不要自己编一个像的。**

- #823：878a8489 用一个自己编的 `<tool_call>{json}`「验证」了 Trae 的情况，而截图里根本没有 JSON；报告人 c353f7bd 又回来了，之后解析器又多支持了两种格式。
- 3f76105b 的测试用了一个短的 check-in reason，真实的那个被省略号截断了（#821，eb5edced）。
- 26706c33 用的 skills 目录结构和 #791 的不一样。
- 给模型输出写解析器时，先收集几段真实的失败回合；截断的和空的 body 也要进测试。

**厂商拒绝 magpie、却在自己的客户端上服务同一个账号时，先把失败请求的每个 header 和官方客户端比一遍，再考虑加重试或兜底。**

- Copilot Auto（#256）用了四个版本（719a6820、026158b0、251ef218，最后 4660fd69），每次都多加一层兜底；真正的原因是少了 Copilot-Session-Token 旁边的 X-GitHub-Api-Version。

**把一个账号停用之前，先分清这次拒绝关于账号、模型还是请求内容。**

- 5353ed54 把 WorkBuddy 的「unapproved channel」（其实是 agent 的 system prompt）当成账号故障，把每个 WorkBuddy AI 账号停了 5 天（2033df0f）。
- 换个账号发同样的请求，看失败方式是否一样。
- 正面例子（10-07）：bed306ae（#1062）把 Google 对不支持的 thinking level 的 400 和 thinking_config 被拒分开，记下来的是「这个模型拒绝关掉 reasoning」，不是「这个厂商拒绝思考」。

**修错误的实质，不只是它的措辞。**

- e63fbb0e（Discord 上的 kkgg，「GLM 直接 429 了」）：智谱对发到按量付费端点的 GLM Coding Plan key 回了 429 1113「余额不足」；这个 commit 只把 429 重新标成余额不足，而 magpie 里没有任何地方告诉用户这个 key 该用在 Coding Plan 端点上，那才是让他们的请求能跑通的事。
- 报告指出标签不对时，也问一句请求为什么失败：把那个修掉，或者在消息里直接给用户指路。
- 10-10：1134c7a8 只是改了「重启 codex」这句话的措辞；luci 在下一个版本又撞上同一个卡住的 app-server 守护进程，e611fc65 才让 magpie 去重启它。

## Fix the class, not the sample

**Scope a vendor rule to that vendor.**
- e950eb08 capped every model at 272K over one DeepSeek report. Claude [1m]
  models were capped too (531dc0aa).
- 71d2da1f priced Anthropic's 1-hour cache write onto OpenAI models
  (3a30ac87).
- Check the claim about the vendor's behaviour against its source or docs.
  Add a test that another vendor's model is unchanged.
- Seen 1× (2026-10-05).

**A restriction covers every route that reaches the thing it guards.**
- 46f03154 (#882) held keys to some models. count_tokens and System One's
  decision model weren't covered until d7a8ddc8.
- Done right on 10-07: 6b6113aa let a gateway key take the user's own value.
  It found that a local request with such a value would skip key limits, and
  moved managedKey onto access.Named, with a test that fails on the old
  check. c83c0d5f (#1112) kept a pinned MAGPIE_ADDR host while sharing, and
  checked that requests behind Tailscale Serve still count as remote.
- Seen 1× (2026-10-05).

**Scope a privacy or security exemption by where the value sits in the
protocol, never by a key's name.**
- 7137feb4 kept any object holding a "signature" or "encrypted_content" key,
  and any `*_id` key, unmasked. A tool call's input is written by the model,
  so `{"signature": …, "body": "DB_PASSWORD=… 13800138000"}` or a `user_id`
  in tool_use input went to the vendor unmasked. 1965e1f0 limited the
  exemption to thinking/reasoning blocks and Gemini's thoughtSignature, and
  never keeps anything under a tool call's arguments.
- Test the exemption with the protected key placed where the user's data
  goes: tool arguments, message text, a nested object.
- 10-28: 3e96197da let an sk- value with no capital and no run of 16
  between hyphens go unmasked, so SK hynix article addresses are no key.
  Its tests held four key shapes, none of them the closest to a slug: sk-
  and a UUID in lower case passed as words and went to the vendor
  (bad05e1b7). An exemption by shape is tested with the real secret that
  looks most like what it lets through.
- Seen 2× (2026-10-09, 2026-10-28).

**A security gap a doc names is an open bug, not a description.**
- docs/subsystems/gateway-routing.md said "There is no `Host` check, so a
  page whose own name resolves to 127.0.0.1 (DNS rebinding) counts as
  same-origin". On 10-10 the review reproduced it on main. A rebound page
  got 200 on /v1/models, /v1/chat/completions and /v1/magpie/quotas without
  a key. Fixed in c431225a.
- A same-origin exemption needs the Host checked too. A rebound page's GET
  carries no Origin at all.
- 写下这种句子时，要么在同一个 commit 里把它修掉，要么明确记下来——本 fork 没有 issue 可开。
- Seen 1× (2026-10-10).

**An origin exemption judges every Origin a browser can send, not only
the http(s) names it expects.**
- c20bb76c4 (#2242, JasonBuildAI): `foreignPage` judged only http and https
  origins, so `Origin: null`, which a sandboxed frame sends, passed
  corsGuard without a key and spent the user's subscription. Null now needs
  a gateway key.
- d182294be (#2256, ggbdpq): every `*.localhost` counted as this computer
  because "browsers resolve it to loopback". Chrome and Firefox do; WebKit
  before macOS 26 asks the system resolver, so a hostile network's DNS
  serves such a page from anywhere. Now it needs a key too, except
  tauri.localhost and wails.localhost on Windows, where those webviews
  live.
- List what can arrive: null, each scheme, each engine's resolution of the
  name, and a missing Origin (the 10-10 rebinding case). Test each one
  without a key.
- Seen 2× (2026-10-10, 2026-10-14).

**A file another process rewrites is read as possibly half-written.**
- #1928's host.js `mdev()` read models.json while catalog.Sync rewrote it
  in place, and could drop the catalog on a half-written read (194b2fd3c).
- Done right: d5847f198 writes Codex's auth.json to a flushed temp file
  and renames it over the old one.
- Write through temp-and-rename, and keep the last good read when a parse
  fails.
- Seen 1× (2026-10-14).

**A pinned hash or a new download source is checked against the vendor,
and trusted only as far as who can write it.**
- 4e9335c96 pinned Bun's windows-aarch64 SHA-256. The review checked it
  against Bun's own SHASUMS256.txt, not the commit's word.
- 118f4f28b installs a plugin npm doesn't have from the plugins repo's
  `dist` branch. Its sha512 comes from the same branch, so it only guards
  against a bad mirror. The trust is in who can push `dist`: publish.yml
  on a push to main (pull_request runs get no write token).
- Seen 1× (2026-10-14).

**Text magpie adds to a prompt that goes to a vendor names neither magpie
nor the vendor's limits.**
- 5d33f060b (10-12) headed the models it added to Codex's spawn_agent
  description "(Codex names only five above; magpie serves these too)".
  That text goes upstream, to OpenAI too. 3c4f8f9ae made it neutral, and
  its test fails when the text names magpie, Codex or "five". The cost is
  ban risk, so a prompt change gets the same care as a header change.
- Seen 1× (2026-10-12).

**A new reader of a live object reads each field the way its writer
writes it.**
- 7f827b3b0 (10-27) added /v1/magpie/claude-runs, which lists every
  run and calls pid() on each. pid() read cmd.Process without a lock
  while a run's launch was still in cmd.Start writing it. It was red
  under -race on ubuntu CI at 6104e88aa only (run 40698575099), since
  most runs were cancelled by the next push. 983fff23d reads the run's
  tree under mu first; it was red with a 50ms sleep injected at launch,
  and not in 30 runs without it.
- Before adding a list or status route, find who writes each field it
  reads and under which lock. Run its test under -race with a delay
  injected into the writer.
- The fix moved when the pid shows, and the test waiting on it wasn't
  re-read: TestClaudeRunsNamesEachProcess took a listing, then read the
  fake's hang.pid, and could end on a list made before the tree was set
  (PID 0), red on CI at 5bfd76cd8. 3dd59428e waits for a run listed
  with that pid; red 3 of 3 with a sleep injected in the listing before.
  A change to when a value appears re-reads every wait on it.
- Seen 1× (2026-10-28).

**A bit or enum value has one owner.**
- d4c2512d2 (#1874) gave a usage row's Flags bit 256 to rowOwnCost while
  a rebase of #1463 gave it to rowReasoningHidden, so every reported cost
  read back as hidden reasoning. 8179ce768's TestRowFlagsApart fails when
  a bit is used twice. After a rebase, grep the values both sides claim.
- Seen 1× (2026-10-13).

**A command never takes a flag, or a value it doesn't know, as data to
write.**
- `magpie snow --help` took "--help" as a model: it deleted
  profiles/magpie.json and wrote "--help" into the user's profile. 76db4c6c2
  (#1457) made --help print usage on every command, and Snow and Gemini CLI
  refuse an unknown value. Try each command with --help and a bad value in
  a sandbox HOME.
- Seen 1× (2026-10-11).

**正文里提到、却没动的兄弟位置，要在同一个 commit 里一起处理或明确记下来。**

- d4a1b9baa（#2634）让 think block 不再在第一个 `</think>` 处结束，同时写了「未改动：plugins 仓库里 think-tags 中间件」用的是同一条规则；直到评审提了 plugins#176 才在半小时后补上。
- Seen 1× (2026-10-17).

**A fix that holds only for new data says what happens to the old, for
every user.**
- dccfefdf7 (#2635) made an imported skill follow the app's versioned
  folder. Skills imported before keep the stale link, and only the
  reporter was told to import again.
- Seen 1× (2026-10-17).

## The user's own files and settings

**Never let magpie's default override a value the user set themselves**
is in the code standards since 10-18. See
[Moved to the code standards](#moved-to-the-code-standards).

**Before deleting or overwriting a live credential, find every record that
could match the same key.**
- 43a65950 matched Codex accounts by display name. Two Team seats of one
  email share it, so removing one deleted auth.json for both (c13f3bfb). The
  sign-out rule was then rewritten again (4c35c1b8).
- Seen 1× (2026-10-05).

**When you hand users a writable copy, test "user edits it, then sync".**
- 3c7ceb68's "Give skills as Copies" undid the user's own edits on the next
  start (20bdf1e9).
- Seen 1× (2026-10-05).

## Verification

**A fixed date in a test is checked against every clock the code reads.**
- 3c4b4dc97 (#1591) held usage's clock at 2026-10-15 12:00 and wrote its
  rollouts then, but /api/sessions/overview counts seven days up to the
  real today. In UTC+8 it passed; on CI, in UTC on 10-14, the fixture was
  tomorrow and main went red (21aa40285). From 10-23 it would have been
  red everywhere.
- Hold every clock the path reads, or write the fixture at time.Now(). Run
  it once with TZ=UTC and once in a far zone.
- Seen 1× (2026-10-15).

**加在「每个请求或每次轮询都会走」的路径上的工作，要按这个频率和最大的那份输入来算成本。**

- 644f4316f 让 Codex 的模型/思考档位在每 15s 一次的 Sessions 轮询里被重新读取；019199e0f 改成只在调用、价格或身份有变化时才重读。
- b14784c03（10-18）把 `failure(hw.code(), hw.errBody())` 放进 serve 里 if 的 init，于是每次尝试都会跑，包括成功那次；JSON 回复是整体持有的，对一份 24MB 的回复调用 `failure` 要 1m45s，`TestPluginStreamLargeReplies` 的 JSON 用例因此在 ubuntu 和 macOS CI 上等过了 client 的超时。7ac20247a 改成只在确定这次尝试失败后才读 body，和 serve 里其他 `failure` 调用一致。
- 把 body 扫描放在能排除它的廉价检查之后，并用测试里最大的那份回复计时。
- Seen 2× (2026-10-14, 2026-10-18).

**A full run gives the slow packages room.** `go test ./...` at the default
10m timeout times out in internal/gateway (#2108), and under load in
internal/provider and internal/agent. Use -timeout 45m, so "every package
ok except gateway" stops being a normal run record.
- 194b2fd3c, 2fbbd1694, 3e812ebde and 3ec45e715 each recorded a timed-out
  package.
- Seen 1× (2026-10-14).

**One full suite runs on a machine at a time.**
- On 10-16 one session ran three suites at once (a 150m agent and
  gateway run, a full ./... run and an agent-only run) beside others, at
  load 300 to 400. Every full suite timed out, so no record said the
  suite passed, and the Cursor mover's one-line min waited ~3h behind
  them (#2557).
- Done right from the evening on: a751f5282 and later commits ran
  "through suite-lock", one suite per machine, and their records say ok.
- 10-17: at 10:07 the box had three `go test ./...` runs, ~35 GUI
  runners and over 100 browsers from several sessions, at load 313.
  d4a1b9baa's GUI run was killed at its 30s bar, ebf3f48f7's shared Go
  cache had files trimmed mid-run by another run, internal/agent took
  50 to 58 minutes (#2544), and dccfefdf7's eight AppKit tests were
  killed (#2645). The rule lives in this file only; a lock every suite
  goes through would hold it.
- Seen 2× (2026-10-16, 2026-10-17).

**A suite's log is kept whole until its reds are named.**
- 5b12407e8 (10-17) piped a full run through tail, lost which
  internal/gateway test failed at 2559s, and shipped with an unnamed red.
  `tee` the log to a file of your own and grep it.
- 10-28: ca9b5048e (#3764) recorded "531 ok and 5 red when this was
  written (the run goes on)". Its 200px steps box, which scrolls on its
  own, took reader.cjs's wheel, and routing-model-rest went 20 of 20 red,
  which isn't among the five it names (a8098a886). Write the record once
  the run has ended. A change that adds a box that scrolls on its own
  runs every GUI file that wheels the page (`reach`, `wheelTo`).
- Seen 2× (2026-10-17, 2026-10-28).

**Windows CI only compiles the tests, so a Windows-only red shows
nowhere.** Run the package on the Windows box before calling a Windows
failure "the same on main".
- TestCursor was red on Windows for 3 days, from 585f7f7d until #1248.
- 5d0c1dca's 16 and 76 Windows failures were called the same as main.
  Neither was filed. #923 is the open work to run more of the suite there.
- Seen 1× (2026-10-08).

**What telemetry sends is an allow-list, and a change to what is sent
re-derives every place that discloses it.**
- 169c23c1 sent `omp#` profile ids and the user's own model ids, which
  aren't in the public catalog (fixed in 2cdae80a: only known ids are sent).
- 7d663a27 sent each partner's daily counts, while the READMEs' Privacy and
  the site's "What does magpie send about me?" still listed what was sent
  before (b4aa62af).
- Grep the READMEs (en, zh) and site/public/docs (en, zh, ja) for the
  privacy text in the same commit.
- Seen 1× (2026-10-08).

**A test that reads a dependency's source needs the dependency on disk.**
- 884dbdb2's TestTrayMenuOpenFrameIsWails read Wails' source through
  `go list -m` Dir. CI's fresh module cache hasn't unpacked it, so main was
  red on macOS and ubuntu for ~25 minutes (9b6b9966).
- Run `go mod download` for it in the test, or keep the bytes it checks in
  testdata.
- Seen 1× (2026-10-10).

**A check that a value is gone looks past text magpie generates.**
- 6c099edd's redact test checked that "ops" was gone by substring. The
  placeholder's random suffix spelled it ({{HOSTNAME_mlopsiy3}}) on macOS
  CI. f0453192 strips placeholders before the check, in its sibling
  TestMask too.
- Seen 1× (2026-10-10).

**Playwright's WebKit is not WebKitGTK.** A GUI change with motion or a new
browser API is tried in the real Linux app too.
- 18e82adc6 (10-11) traded the layouts in a view transition. The GUI suite
  passed in WebKit, but under Wayland magpie turns WebKitGTK's compositing
  off, and WebKitGTK 2.52 crashed in the transition and froze the window
  (f5dd4d604, a reporter on X).
- Seen 1× (2026-10-12).

**A path that differs by OS is tested with each OS's value.**
- ee7a9b24a (10-11) read Grok App's folder from $XDG_DATA_HOME on Linux.
  The test sandbox set HOME, XDG_CONFIG_HOME and XDG_CACHE_HOME but not
  XDG_DATA_HOME, so the drift test was red on ubuntu CI (f38f65030). Force
  the OS switch in a test, and give the sandbox every variable the code
  reads.
- Seen 1× (2026-10-11).

**Reproduce on CI's Go version.**
- #1184 couldn't be reproduced on go1.27.1 locally. CI ran 1.26.x, and the
  cause was a Go 1.26.8 segfault. Docker `golang:1.26.8` with
  `GOTOOLCHAIN=local` matches CI.
- Seen 1× (2026-10-08).

## Concurrency and tests

**A fake or child process a test starts ends when the test does**, and
**a timing test leaves room on both sides**, are in the code standards
since 10-11. See [Moved to the code standards](#moved-to-the-code-standards).
Two habits from them:
- After a test times out, check `ps` for its binary. An orphaned
  gateway.test spun at 96% CPU for 30 minutes. Size -count to -timeout; a
  timeout panic is not a hang until its stacks show one.
- Reproduce a timing flake by injecting the delay, not by rerunning until
  it fails (0f8e4ebc, 229ce19a, 9e35eef3).
- Wait for the state, or count what the test is about, never a duration.
  On 10-14 five tests went red on CI for a fixed wait:
  TestClaudeRunEndsAfterStructuredOutput (c4c3cafa2),
  TestAgentGoneInTheRetryPause's 100ms (b8070cc6c),
  TestCanceledRequestRestsNobody's 50ms (685521888),
  TestProviderListReadsSettingsOnce's 2s bar, now a count of parses
  (a36319d60), and TestCursorEditorCopiedOncePerChange's 100ms linger
  (2efb71ea0).

## 红测试

**flaky 测试要找到成因。**「main 上失败的测试现在就修」是代码规范里的规则。评审在这里的发现：

- TestPluginSOCKSProxy 在 ubuntu CI 上 60s 超时，被当成「负载抖动」重跑。成因（9a852ae9d，10-15）：测试释放了一个已死 SOCKS 代理的端口，netproxy 桥接的 `:0` listen 正好拿到同一个端口，桥接在一分钟读超时下拨号给自己。靠注入这个端口复用找到（注入后 60.03s 红、2.4s 绿），不是靠重跑。测试释放的端口随时可能被别的东西拿到：d0ccbbebc 因为同样原因修了网关的 proxy-down 测试。
- TestUnreadLoginsNotWrittenOver 需要同一个挂钟秒内两次写入（`.bad-<second>` 名字），在 Linux CI 上失败（237d216b）。用 time.Now() 拼名字的测试要跨秒边界试一次。
- 修一个红之前先 `git log`，看有没有 commit 提到这个测试：85fd35ab 和 e34e53a1 曾同时修掉同一处丢尾。
- 「在 main 上也一样」指的是刚 fetch 下来的 origin/main：先 `git fetch`，再说清你跑的是哪个 sha。10-07 07e246e5 把 24 个 GUI 失败称作「origin/main 上一样」，可单独跑它们所在的 8 个文件全都通过——它们只在整套 run 下失败，而 CI 从不跑 GUI 套件，所以没人看得出来。
- 负载下才红的测试，是用户在忙碌机器上也会遇到的时序假设：连输出一起记录下来，单独一个 commit。
- 一个红把整个包打死，就会把它之后每一个新红都藏起来。internal/provider 从 10-25 起死在 TestUnreadLoginsWriteErrorsKeepCredentials（#3632，synctest fatal），三个 TestFetch* 红一直躲在它后面，直到 4842f69be 修掉它（759b3b8c4、ed49d1b38），这个包才第一次整套通过。
- 一个红的步骤会藏住它之后的每一步。CI 的 Race 步骤只在 Test 通过后才跑，所以 9a888323a 的分配上限（#3472，每次 -race 都红）直到 Test 变绿才第一次露出来（fafce6545）。给字节数设上限的测试，落地前先用 -race 跑一次：sync.Pool 在 -race 下会丢掉投进去的四分之一，regexp 和 zstd 也从池里取状态。
- 一个失败的断言会藏住它之后的每个断言：一个红的测试在被修之前，仍然是一个「第一次失败之后什么都不再检查」的测试。
- 被取消的 run 什么都没测。10-14 十分钟里九次 push 互相取消，3c4b4dc97 从来没有过属于自己的 run，它的红到 84f14e555 才第一次出现。给分配量或池化收益设上限的测试先查 `raceOn`（race_on_test.go），并在 push 前用 -race 跑一次。
- 正面例子：2bd49cc5 的 race 在 25 分钟内从成因修掉（28049bd2，-race -count=40 -cpu 1,2）；60f87223、b1cba654、443f1cbc 和 395c4bc5 都是从成因修 flake 而不是重试；06420a71 从成因修了 macOS 首次运行的检查。

## 落地一次改动

**用户无法撤销的改动，落地前要按厂商真跑一遍。**

- 9fcf6a6e7、f9ceac162 和 7d7dba31a（10-16）把所有废弃内置订阅的账号一次性搬到各自的 plugin 上，去掉了「有模型在用就先别搬」的检查，也拿掉了回头路。owner 要求这么做，正文里有单元测试和 GUI 测试、手动破坏、整套跑通，但没有一次真实账号的搬迁，也没有「未尝试」的说明。#2596 要的是每个订阅在沙箱里搬一次、列出 plugin 缺哪些模型、Factory 的 min（npm 上已有 0.1.32 而 min 停在 0.1.31）和回退方案；v0.1.1276 一个都没回答就发给了所有用户。
- 「没有回头路」会把门槛抬高：在沙箱 HOME 里搬一次真实账号，列出用户会失去什么，把未决的问题回答掉，再落地。

**自己新加的测试失败，或者评审列出的已知问题还在，就先别落地。**

- #885 和 #826 在自带的新测试失败的情况下被合并；#846 带着四处已知错误的翻译被合并。先修掉，或者明确记下来。

**上限只要一碰到就被抬高，就等于没有上限。**

- app.js 的预算在 2.5 天里被抬了四次，最后一次由 85eef5d87 抬到 1,269,000，期间 app.js 长了 53KB 而什么都没搬出去（#2710）；17557132c 没抬预算也满足了同一个上限。
- 要抬就先搬点东西出去，或者按 owner 定的增长速率来。

**提交信息不要求干净、原子；改写历史要经授权。** 得到授权后 `commit --amend`、`rebase` 随意，推送用 `--force-with-lease`（不要用 `--force`），改写前不用额外备份；信息用中文写清改了什么、怎么验证的，就够了。

**两个 session 永远不要在同一个 checkout 里提交** 自 10-18 起在代码规范里，范围已扩到一个 worktree 和它的日志，见 [Moved to the code standards](#moved-to-the-code-standards)。

## Moved to the code standards

- **A mover's min is npm's version when the change lands** (10-16,
  10-18, 10-24). On 10-16 19e9fc47f raised Cursor's min a version behind
  npm, and 53009f81a left Factory one behind (#2557). On 10-18 zed 0.1.9
  was published with no min raised until the review's ccb2eea15.
  On 10-24 factory 0.1.38 (plugins #349, an option a user asked for)
  was published and the min stayed 0.1.37 for four days, until
  490c0a4ad. The rule now also says a plugin version raises the min the
  same day.
这些规则被看到三天以上才移出去；规则本身和证据在 [docs/code-standards.md](docs/code-standards.md)。在 fork 里由改动者自查时逐条对照。

- **Never let magpie's default override a value the user set themselves**
  (10-05, 10-10, 10-17). On 10-17 5a2414acd brought every plugins.yml
  without `settled` up once, Essentials to All. A user who had run
  `magpie plugin preset essentials` themselves wrote the same file, and
  the body doesn't name them (#2749).
- **A checkout, worktree or log belongs to the session that made it**
  (10-09, 10-12, 10-17). On 10-17 another session checked out
  origin/main in 7660399a1's worktree mid-run, and another deleted the
  first part of 17557132c's GUI log.

- **A fix reaches every sibling of the bug** (10-05, 10-06, 10-07). Seen
  six times on 10-05. On 10-07 cd8d64a9's sub2api balance URL was left out
  of the hint shown after a failed read.
- **A change re-derives everything built on what it changes** (10-05,
  10-06, 10-07). On 10-07: click-scroll red since 5d871723, four GUI tests
  left red by page-only test runs, and ee2588c2's test race (3e38bd76).
- **A test that fails on main is a bug to fix now** (10-05, 10-06, 10-07).
  On 10-07 dcbae2ef, 76d82528, b2345078, 07e246e5 and e95852e3 each shipped
  past "fails the same on origin/main".
- **落地前把「跑了什么」写下来**（10-05、10-06、10-07）。10-07 的 #1037 就是没有记录地进去的。
- **Real use before building on it, or telling users it works** (10-05,
  10-07, 10-08). Acceptance criterion 5. On 10-08 bbf99143 "not tried on
  Linux" broke Linux vet with the WSL2 distro there, and #1185 was reviewed
  on macOS only.
- **GUI tests in both engines, at narrow widths, in every language**
  (10-05, 10-06, 10-08). Acceptance criterion 4. On 10-08 aff4f9f2's zh-TW
  missed later strings, and usage-ledger was red ~7h after 586f2bce.
- **A fix reaches every sibling** was missed again on 10-08: #1239 fixed
  Air 9h after a8290d27, and 173ab71e fixed Gemini bodies after #950.
  Done right on 10-08: a8290d27 itself, 9fcd332b (cmd.exe quoting at one
  choke point, tried on the Windows box), 74a809dc with 84f37ac9
  (re-derived account keys), #1271/#1275 (built-in and plugin together),
  3aeb7d1b (a refusal scoped to the model) and #1288.
- **10-09/10-10, criteria still missed.**
  - Sibling: 12c0550a said "Only aBlock had this" while #1445 (open for an
    hour) listed the class. 64179e73, 13356b9d and d7186e51 followed.
  - The suite: 2da8fbe4 ran six packages, not `go test ./...`. Its testenv
    exec broke internal/proc's TestNoCommandBypassesProc, red ~50 min until
    b934d64a.
  - Real use: a3a8e257 shipped GitHub plugin icons without loading the real
    list, and the owner found none showing (52f6b3a3). aa82288f's Volcengine
    plan windows went out "not tried against the real API". It was said
    honestly, and #1427 stays open.
- **Whatever a test starts ends when the test does** (10-06, 10-08,
  10-11). On 10-11 a CLI-identity ask outliving its test wrote into the
  next test's folder (#1524). 4ee3a76b fixed it in the gateway's TestMain
  only; 9c377231 fixed it for every binary through testenv's marker, but
  the gateway isolates itself without testenv and never set the marker, so
  #1524 came back on CI (a349de82). A guard test now fails if the gateway's
  TestMain doesn't set it.
- **A timing test leaves room on both sides** (10-08, 10-09, 10-11). On
  10-10 8424a004 assumed two concurrent handlers let go in order
  (3a1ade97). On 10-11 TestMaxRPM and the queued-stream tests (above).
- **A failed read, parse or hash means "unknown"** (10-05, 10-11, 10-12,
  10-13). On 10-12 7a9490638's IP allow list let every address in when
  settings.json couldn't be read (7d9382db2). On 10-13 #2017's patch read an
  unreadable codex-autoreset.json as "no reset spent" (e297a8ab2). When a
  shared reader is wrong, fix it, not a strict copy beside it.
- **Nothing that can block runs under a lock its reader needs** (10-06,
  10-08, 10-11, 10-13). 7cba316b9's timer went red under -race
  (a2afc1828); a fake Codex appended from two goroutines (a75de4c21).
- **Another app's values come from that app** (10-05, 10-06, 10-13).
  accc8c090 sent 127.0.0.1 where Claude Code sends localhost (e0ecf0161).
- **A test named for a guarantee fails when it breaks** (10-08, 10-12,
  10-13). bbe8825c0 (9dd5917a4) and ggbdpq's 44b5b2b96 and e21b1dbc1
  (cc93b566e) passed on the old code. Break it by hand, watch it go red.
- **A test never reaches the network** (10-08, 10-11, 10-13). TestPiPackage
  tested npm's latest pi (f230fa23b); tests waited 30s on models.dev
  (bde11c778).
- **把插件版本写进 mover 的 `min`、或写进给用户的回复之前，先 `npm view --prefer-online` 确认它真的发布了**（10-05、10-08、10-12、10-13）。上游曾有抢发的 v0.1.1213 和 v0.1.1218 始终没发布出去（#1846）。
- **大 commit 的正文要写清跑了什么**（10-08、10-12、10-13）。ea3d480ed 和 1cd814004（社区提交）没有记录；3ccbe6bc1 把结果塞进「push notes」，藏住了两个红的 GUI 测试（2dcc51417、ba0712888）。
- **10-11 to 10-13, criteria still missed.**
  - The suite: 6fa3109ea, 43d8a5633, 5617281f5 and cdb7b5ff7 ran chosen
    packages and broke guard tests elsewhere (494609866, 24146c031,
    c6de0d2a5).
  - GUI: 18e82adc6 left 8 GUI files red after a run cut short (054bdb8bb);
    e3a497d7a left gui-ja red ~3h (28aac86bc).
  - Sibling: 4ed379f11 left three deciders on the raw body (0c6752dbd);
    90ac1f038 mended StepCode only (cb003877f).
  - Timing: #1874's TestUsageIngestTouchesNoLimit stamped its calls a
    minute ago and went red a minute after midnight UTC (1acdf3a8f).
  - Whatever a test starts: Devin's held installer (2ff4ecb42) and a
    Claude sign-in's `claude auth login` run (ebbe76420, #1802) outlived
    their tests.
- **10-14, criteria still missed.**
  - A large commit has a body with what was run: 509328ccb and c1e354245
    pointed to "the push" for it. A pointer is not a record.
  - 抬了版本不等于发布出去：zed 0.1.7 和 zen-free 0.1.2 到 0.1.4 都抬了版本却始终没到 npm（plugins#56）。正面例子：10-14 每个 mover 的 min（0337ce4bc、50929661f、bd4cb7a26、2c18c697c、aae49d086）写的都是 npm 上真有的版本。
- **10-15, criteria still missed.**
  - A large commit has a body with what was run: 113 of the 120 commits
    pushed at 23:08 (728cb2d29 to a7a012202) end "Full suite:
    SUITE_LINE", a placeholder no one filled in. The batch's real record
    is in 386d341e7 alone. Before pushing, grep the bodies for a
    template's placeholder.
  - A rerun's green hides the first try: a1f7b8c13's run is green on
    attempt 2, its attempt 1 red (#2390, fixed at its cause in
    4a6bf80f4). Read `attempt` before calling a run green.
  - GUI tests in every file a change can reach: three changes ran the
    GUI files they chose and left others red on main, which CI never
    runs. 64b0f3a20 (10-15) had the sidebar ask /api/plugin-pages, and
    menu-scroll's strict fixture threw on it, 24 of 24 red until
    a61a6f954 the next day. 8f55c27ad (#2396) held Settings' tabs at the
    top, and text-size's click landed under them, red ~5h until
    d3ca90afc. 94942f9f3 ran only the i18n files, and
    agent-connect-no-models went 8 of 16 red until cf21b71ff (#2435). A
    new API call or a layout change runs the whole GUI suite.
  - A Windows rule needs each test of that agent judged for the right
    system: 6e2aa8e32 (#2300) made ~\.dsh never gone on Windows, and two
    Mac-app dsh tests that didn't force goneOS went red on Windows CI,
    which now runs the Dsh tests, until ce1251cc9.
- **10-16, criteria still missed.**
  - GUI tests in every file a change can reach: 9b04c4e20 (#2118 hooks,
    v0.1.1273) ran the plugin GUI files and four more. plugins.js used a
    core word as its own, so i18n-keys was red under the tag until
    a4fa7bbd8 (#2586) 35 minutes later.
  - What was run at the pushed head: 1978eabe5's suite ran at a751f5282.
    1d6f461a9 and the 22:58 batch had added ~2.5KB of core script since,
    so TestCoreScriptBudget passed at the base and failed at the pushed
    head (1,426,102 > 1,426,000), red on CI for two runs until 81313b912
    (#2612). Run the size budgets again after a rebase.
  - Each commit's record is its own: 61ca3924c and 83f3316cf carry the
    same body word for word, so neither says which test guards which
    change.
  - A cancelled run tests nothing: 6b3ee5a03 and e243937ca never had a
    run of their own; the next push's run covered them.
- **10-17, criteria still missed.**
  - What was run at the pushed head: d4a1b9baa ran "this change plus the
    next commit's library edit". 252bc61ce said it was rebased on
    cb05dc2d1, but its parent 84cd686af changed internal/agent three
    minutes before, and the pair first ran together on CI. bad4508c4
    and bf931f82c ran at older bases too.
  - Each citation is checked: 04e8aa8f1 cites #2710 for a GUI red that
    is #2552.
- **Done right on 10-17.** The retire stack (0f1666b38 to de671719a)
  diffed staticcheck's U1000 against its base for dead code, b98f906b1
  was red on the old code for an own-account gap, and 8 subscriptions
  were moved with real accounts. Kiro, Factory and Zed were not, and
  Qoder answers 401 (plugins#181); both said. df3734b95 (#2627) fixed
  the shared reader with the reporter's fish_variables and ran real fish
  3.7.1. f550d3699 tried Bun's Claude Code with a real SOCKS proxy.
  48aae83b8 found an unmasked route to Jev by reading callers. 9f9bfc160
  scoped Codex's 272K window to Codex and checked an OpenAI model
  unchanged. c4aeaec74 checked npm before the Cursor min.
  2042123f4 (timonwong) and 992f288e2 (JJ-Lin) were ported with credit.
- **Done right on 10-16.** a751f5282 (#2567) found its 408 by injecting a
  250ms stall and was red with renewal turned off. 9b04c4e20 ran a real
  Codex Pro sign-in on every protocol. #1717 (deephbz) took four review
  rounds, each with a probe that lost a 1h cache write, and diffed the
  outgoing request against main through a recording proxy. 6641e1b0a
  fixed #2449 at its cause, red 3 of 3 with an injected pause.
  0cad76cd9 ran the whole GUI suite and filed each red. a15e57656 read
  OpenPencil's keys from its own source and ran its real binary.
  ee2a7c7e8 (ggbdpq) has a test red on the old code.
- **Done right on 10-14.** 86cc7ac56 (hhh2210) ran -race -count=20 and
  says its ordering was injected, not captured. f074996d9 named its load
  red's issue (#2066). bfef5d51b checked the reverted page's screenshots
  against v0.1.1231's assets. 21aa40285 ran the fixed test in four time
  zones.
- **Done right on 10-11 to 10-13.** 2dcc51417 found 3ccbe6bc1's reds the
  same evening. 5241de909 guards a caller's image URL at the one place all
  three draw paths download it. 86b2f4d05 fixed revoked sign-ins for every
  built-in at once. 8179ce768 says what it broke by hand. 097479dab fixed
  #1543 at its cause, and ebbe76420 forced each failure by hand instead of
  rerunning.
- **Done right on 10-10/10-11.**
  - 9e35eef3 fixed #1469 half an hour after it was filed, reproducing CI's
    numbers with an injected pause.
  - ede1e32a (#1508) audited all six pickers of the same kind and added a
    guard test that every one can be narrowed.
  - 64262a19 (Prime Agent), 9c11abbd (jcode) and b72e7d4a (#1539) were tried
    with the real binary in a sandbox, and each says what was broken by hand.
  - #1197 scoped Kimi's sampling rule to Kimi Code's endpoints and models.
- **Done right on 10-09/10-10.**
  - 229ce19a, 570b8fdb and ab72c8eb reproduced CI flakes by injecting a
    delay and fixed their cause.
  - 7f62dbf3 named the siblings the reporter's patch missed (Cursor, Muse,
    GUI, CLI) and covered them.
  - 9b51428e 在 Factory 的列表里找到了同一个漏掉的项。
