// MiniMax 开放平台通道：按量付费 API Key 与 M Plan 订阅 Key 都走这里。
import { CLAUDE_API_HEADERS } from "../shared.js";
import { MINIMAX_IMAGE_MODELS, MINIMAX_LANGUAGE_MODELS, MINIMAX_SITES, MINIMAX_TTS_MODELS, MINIMAX_WIRE_FORMATS } from "./constants.js";

/**
 * 生成开放平台的 registry entry。
 * baseRoot + path 拆开写：连接可以把 baseRoot 改成中转站/自建网关，
 * 请求时由 providers/index.js 合成完整 URL（见 baseRoot/path 约定）。
 */
export function buildMinimaxApiEntry({ id, alias, siteId, display, serviceKinds, media = {} }) {
  const site = MINIMAX_SITES[siteId];
  const claudePath = MINIMAX_WIRE_FORMATS.claude.path;
  const openaiPath = MINIMAX_WIRE_FORMATS.openai.path;

  return {
    id,
    priority: siteId === "cn" ? 190 : 90,
    alias,
    display: {
      ...display,
      notice: {
        apiKeyUrl: site.apiKeyUrl,
        text: "Accepts a pay-as-you-go API key or an M Plan subscription key — they are not interchangeable, but both use the same endpoints.",
      },
    },
    category: "apikey",
    hasProviderSpecificData: true,
    // 连接级可调项：换 base url（中转站/自建网关）、锁定报文格式。
    connectionFields: [
      {
        id: "baseUrl",
        label: "Base URL",
        type: "text",
        placeholder: site.apiRoot,
        hint: "Leave blank for the official host; enter a relay or self-hosted gateway instead — the endpoint path is appended automatically",
      },
      {
        id: "wireFormat",
        label: "Wire Format",
        type: "select",
        defaultValue: "auto",
        options: [
          { value: "auto", label: "Auto (follow the client)" },
          { value: "openai", label: MINIMAX_WIRE_FORMATS.openai.label },
          { value: "claude", label: MINIMAX_WIRE_FORMATS.claude.label },
        ],
      },
    ],
    transport: {
      baseRoot: site.apiRoot,
      path: claudePath,
      format: "claude",
      urlSuffix: "?beta=true",
      headers: { ...CLAUDE_API_HEADERS },
      quirks: {
        // M3 不接受 output_config（400）；M3.1-Flash 接受，见 capabilities 的 supportsOutputConfig。
        dropOutputConfig: true,
        requireClaudeToolType: true,
      },
      reasoningInject: {
        scope: "all",
      },
      auth: {
        combined: true,
        header: "x-api-key",
        scheme: "raw",
      },
      usage: {
        urls: site.usageUrls,
      },
    },
    // 多端点：按客户端 sourceFormat 选同格式端点，省掉一次有损翻译。
    transports: [
      {
        format: "openai",
        baseRoot: site.apiRoot,
        path: openaiPath,
        // OpenAI 兼容接口用 reasoning_effort 表达思考深度。
        thinkingFormat: "minimax-effort",
        auth: { combined: true, header: "Authorization", scheme: "bearer" },
      },
      {
        format: "claude",
        baseRoot: site.apiRoot,
        path: claudePath,
        urlSuffix: "?beta=true",
        headers: { ...CLAUDE_API_HEADERS },
        // Anthropic 兼容接口用 thinking.adaptive + output_config.effort。
        thinkingFormat: "claude-adaptive",
        auth: { combined: true, header: "x-api-key", scheme: "raw" },
      },
    ],
    models: [
      ...MINIMAX_LANGUAGE_MODELS.map((model) => ({ ...model })),
      ...(media.image ? MINIMAX_IMAGE_MODELS.map((model) => ({ ...model })) : []),
      ...MINIMAX_TTS_MODELS.map((model) => ({ ...model })),
    ],
    serviceKinds,
    ttsConfig: { baseUrl: `${site.apiRoot}/v1/t2a_v2`, authType: "apikey", authHeader: "bearer", format: "minimax-tts" },
    ...(media.image
      ? {
          // 图片通道还是老样子（端点与模型名都没跟上上游：上游是
          // POST /v1/image_generation + model image-01）。本次只收敛语言模型，
          // 图片通道保持原样，别在这里顺手改。
          imageConfig: { baseUrl: "https://api.minimaxi.com/v1/images/generations" },
          searchViaChat: {
            defaultModel: "MiniMax-M3.1-Flash",
            endpoint: `${site.apiRoot}/v1/text/chatcompletion_v2`,
            pricingUrl: `${site.platformRoot}/document/price`,
          },
        }
      : {}),
    features: {
      usage: true,
      usageApikey: true,
    },
  };
}

// 国际版：API Key + 图片/搜索/语音。
export const minimaxApiEntry = buildMinimaxApiEntry({
  id: "minimax",
  alias: "minimax",
  siteId: "global",
  display: {
    name: "Minimax Coding",
    icon: "memory",
    color: "#7C3AED",
    textIcon: "MM",
    website: "https://www.minimax.io",
  },
  serviceKinds: ["llm", "image", "imageToText", "webSearch", "tts"],
  media: { image: true },
});

// 国内版：API Key + 语音。
export const minimaxCnApiEntry = buildMinimaxApiEntry({
  id: "minimax-cn",
  alias: "minimax-cn",
  siteId: "cn",
  display: {
    name: "Minimax (China)",
    icon: "memory",
    color: "#DC2626",
    textIcon: "MC",
    website: "https://www.minimaxi.com",
  },
  serviceKinds: ["llm", "tts"],
});

export default minimaxApiEntry;
