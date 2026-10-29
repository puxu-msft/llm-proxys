// MiniMax Code 通道：M Plan 订阅额度，走 MiniMax 自己的代理网关（OAuth 设备码登录）。
import { MINIMAX_PLAN_MODELS, MINIMAX_PLAN_PATH, MINIMAX_SITES } from "./constants.js";

/**
 * 生成 MiniMax Code 的 registry entry。
 * 与开放平台共用模型清单，但端点、鉴权、OAuth 全是另一套。
 */
export function buildMinimaxPlanEntry({ id, alias, siteId, display }) {
  const site = MINIMAX_SITES[siteId];

  return {
    id,
    priority: 80,
    alias,
    display: {
      ...display,
      website: site.agentRoot,
      notice: {
        text: "MiniMax Code (M Plan) lane: sign in and spend plan credits instead of the pay-as-you-go balance.",
        signupUrl: site.consoleUrl,
      },
    },
    category: "oauth",
    authModes: ["oauth"],
    hasOAuth: true,
    hasProviderSpecificData: true,
    // 网关只有 Anthropic 报文这一条路，所以这里只放开 base url。
    connectionFields: [
      {
        id: "baseUrl",
        label: "Base URL",
        type: "text",
        placeholder: site.agentRoot,
        hint: "Leave blank for the official gateway; enter a relay or self-hosted gateway instead — the endpoint path is appended automatically",
      },
    ],
    features: { usage: true },
    modelsFetcher: { url: `${site.agentRoot}/mavis/api/v1/models?region=${siteId === "cn" ? "cn" : "en"}&buildEnv=prod`, type: "minimax-code" },
    transport: {
      baseRoot: site.agentRoot,
      path: MINIMAX_PLAN_PATH,
      format: "claude",
      thinkingFormat: "claude-adaptive",
      headers: {
        "User-Agent": "MiniMaxAgent",
        "X-Mavis-Agent-Id": "main",
      },
      auth: {
        combined: true,
        header: "Authorization",
        scheme: "bearer",
        anthropicVersion: true,
        hooks: ["minimaxHeaders"],
      },
    },
    oauth: {
      clientId: "mcode-public",
      deviceUrl: `${site.accountRoot}/oauth2/device/code`,
      tokenUrl: `${site.accountRoot}/oauth2/token`,
      scope: "agent.default",
      audience: "agent-backend",
      // mcode access token 有效期约 1h，提前续期（供 REFRESH_LEAD_MS 使用）。
      refreshLeadMs: 10 * 60 * 1000,
    },
    models: MINIMAX_PLAN_MODELS.map((model) => ({ ...model })),
  };
}

// MiniMax Code 国内站。
export const minimaxPlanEntry = buildMinimaxPlanEntry({
  id: "minimax-code",
  alias: "mm",
  siteId: "cn",
  display: {
    name: "MiniMax Code",
    icon: "smart_toy",
    color: "#FF4D4F",
    textIcon: "MM",
  },
});

// MiniMax Code 国际站：协议相同，只是换了 host，账号互不相通。
export const minimaxPlanGlobalEntry = buildMinimaxPlanEntry({
  id: "minimax-code-global",
  alias: "mmg",
  siteId: "global",
  display: {
    name: "MiniMax Code (Global)",
    icon: "smart_toy",
    color: "#FF4D4F",
    textIcon: "MM",
  },
});

export default minimaxPlanEntry;
