// MiniMax 同一家厂商，两条通道、两个站点。
//
//   api  — 开放平台：既可用按量付费的 API Key，也可用 M Plan 的订阅 Key
//          （两者不通用，但共用下面的 host 与端点）。
//            国内 : https://api.minimaxi.com
//            国际 : https://api.minimax.io
//   plan — MiniMax Code 代理网关（M Plan 额度，OAuth 设备码登录）。
//            国内 : https://agent.minimax.cn
//            国际 : https://agent.minimax.io
//
// 厂商相关的常量全部集中在这里，两条通道不会再各写一份而走样：
// host、各报文格式的端点路径、模型清单、额度查询地址。
// registry/minimax*.js 只是 api.js / plan.js 的薄封装，本文件是唯一真源。

export const MINIMAX_SITES = {
  cn: {
    id: "cn",
    label: "中国大陆 (China)",
    apiRoot: "https://api.minimaxi.com",
    agentRoot: "https://agent.minimax.cn",
    accountRoot: "https://account.minimax.cn",
    platformRoot: "https://www.minimaxi.com",
    apiKeyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    consoleUrl: "https://platform.minimaxi.com/console/plan",
    // M Plan / Token Plan / Coding Plan 额度：先控制台域名，再 API 域名。
    usageUrls: [
      "https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains",
      "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains",
    ],
  },
  global: {
    id: "global",
    label: "Global (国际版)",
    apiRoot: "https://api.minimax.io",
    agentRoot: "https://agent.minimax.io",
    accountRoot: "https://account.minimax.io",
    platformRoot: "https://www.minimax.io",
    apiKeyUrl: "https://platform.minimax.io/user-center/basic-information/interface-key",
    consoleUrl: "https://platform.minimax.io/console/plan",
    usageUrls: [
      "https://www.minimax.io/v1/token_plan/remains",
      "https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
    ],
  },
};

// 开放平台支持的报文格式。path 拼在站点根地址后面，
// 所以连接可以指向镜像了同样路径的中转站。
export const MINIMAX_WIRE_FORMATS = {
  openai: {
    id: "openai",
    label: "OpenAI (/v1/chat/completions)",
    path: "/v1/chat/completions",
  },
  claude: {
    id: "claude",
    label: "Claude (/anthropic/v1/messages)",
    path: "/anthropic/v1/messages",
  },
};

// MiniMax Code 网关路径 —— 只有 Anthropic 报文，没有 OpenAI 兼容端点。
export const MINIMAX_PLAN_PATH = "/mavis/api/v1/llm/v1/messages";

// 开放平台当前在售的语言模型（platform.minimax.io/docs/guides/models-intro）。
// M3.1-Flash 是最新一代（1M 上下文、思考深度可调），M3 是上一代。
// M2.x 属于旧型号：上游只在 OpenAI 兼容接口上还认，不再列出。
export const MINIMAX_LANGUAGE_MODELS = [
  { id: "MiniMax-M3.1-Flash", name: "MiniMax M3.1 Flash", targetFormat: "claude" },
  { id: "MiniMax-M3", name: "MiniMax M3", targetFormat: "claude" },
  // "MiniMax-M3.1-Flash-Preview" 上游已下线，旧名由 MiniMax-M3.1-Flash 接管；
  // 保留为别名，改名之前写好的配置不会因为模型校验失败而失效。
  { id: "MiniMax-M3.1-Flash-Preview", name: "MiniMax M3.1 Flash (legacy Preview id)", upstreamModelId: "MiniMax-M3.1-Flash" },
];

// 开放平台上的图片模型（仅国际版登记，国内版未开放）。
export const MINIMAX_IMAGE_MODELS = [
  { id: "minimax-image-01", name: "Minimax Image 01", params: ["n", "size", "response_format"], kind: "image" },
];

// 开放平台上的语音合成模型。
export const MINIMAX_TTS_MODELS = [
  { id: "speech-2.8-hd", name: "Speech 2.8 HD", kind: "tts" },
  { id: "speech-2.8-turbo", name: "Speech 2.8 Turbo", kind: "tts" },
  { id: "speech-2.6-hd", name: "Speech 2.6 HD", kind: "tts" },
  { id: "speech-2.6-turbo", name: "Speech 2.6 Turbo", kind: "tts" },
  { id: "speech-02-hd", name: "Speech 02 HD", kind: "tts" },
  { id: "speech-02-turbo", name: "Speech 02 Turbo", kind: "tts" },
  { id: "speech-01-hd", name: "Speech 01 HD", kind: "tts" },
  { id: "speech-01-turbo", name: "Speech 01 Turbo", kind: "tts" },
];

// MiniMax Code 与开放平台共用同一批语言模型，另外还留着网关自己目录里的 M2.7 一对
// （mcode 的实时目录仍列着它们，静态清单要跟得上，否则模型选择器能选、请求却会被校验挡下）。
export const MINIMAX_PLAN_MODELS = [
  ...MINIMAX_LANGUAGE_MODELS.map((model) => ({ ...model })),
  { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
  { id: "MiniMax-M2.7-highspeed", name: "MiniMax M2.7 Highspeed" },
];

// 上游接受的思考深度（low → max）。"none" 会被上游拒绝（模型总是思考），所以不提供。
export const MINIMAX_THINKING_LEVELS = ["low", "medium", "high", "xhigh", "max"];
