# llm-proxys

我的 LLM 代理项目集合：一个项目一条分支，`main` 只作入口索引。

## 9router — [`9router/master`](https://github.com/puxu-msft/llm-proxys/tree/9router/master)

本地 AI 路由网关 + Next.js 面板：对外只暴露一个 OpenAI 兼容端点（`/v1/*`），在 40+ 上游提供商之间路由，支持报文格式转换、模型组合回退、多账号回退、OAuth/API Key 凭据管理、token 刷新、额度/用量统计，以及可选的云端同步。

## magpie — [`magpie/main`](https://github.com/puxu-msft/llm-proxys/tree/magpie/main)

“每个 agent 的模型，都在一处。” 本地网关 + 菜单栏应用：给任意 agent（Claude Code、Codex、Gemini CLI、OpenCode 等）从同一份列表里挑任意模型，由一个本地网关统一承接；某个账号的额度用尽时自动切到下一个。上游：https://github.com/yetone/magpie

## 克隆

```bash
git clone -b 9router/master git@github.com:puxu-msft/llm-proxys.git
git clone -b magpie/main   git@github.com:puxu-msft/llm-proxys.git
```
