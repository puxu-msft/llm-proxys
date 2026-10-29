// 连接级 transport 覆盖：base url 与报文格式。
// registry 的 connectionFields 声明连接能改什么，这里负责在请求前生效。

import { PROVIDERS, PROVIDER_CONNECTION_FIELDS } from "../config/providers.js";

// 上游通用的报文格式（与 translator/formats.js 的 FORMATS 对齐）。
const WIRE_FORMATS = new Set(["openai", "claude", "openai-responses"]);

export function normalizeWireFormat(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw || raw === "auto") return null;
  return WIRE_FORMATS.has(raw) ? raw : null;
}

/**
 * 归一成站点根地址。
 * 允许直接粘完整端点（.../v1/chat/completions、.../anthropic/v1/messages）
 * 或 OPENAI_BASE_URL 风格的 ".../v1"，方便用户从中转站文档里复制地址。
 */
export function normalizeBaseRoot(value, transports) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const paths = (transports || [])
    .map((t) => t.path)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  let pathname = url.pathname.replace(/\/+$/, "");
  for (const p of paths) {
    if (pathname.toLowerCase().endsWith(p.toLowerCase())) {
      pathname = pathname.slice(0, pathname.length - p.length);
      break;
    }
  }
  // 粘的是 ".../v1" 时，只有当某条 path 自带 /v1 前缀才剥掉，
  // 否则会拼出 ".../v1/v1/chat/completions"。
  if (pathname.toLowerCase().endsWith("/v1") && paths.some((p) => p.toLowerCase().startsWith("/v1/"))) {
    pathname = pathname.slice(0, -3);
  }
  return `${url.origin}${pathname.replace(/\/+$/, "")}`;
}

function composeUrl(root, transport) {
  if (!transport?.path) return root;
  return `${root}${transport.path}`;
}

/**
 * 算出本次请求实际使用的 transport（可能带连接级覆盖）。
 * 返回 null = 没有覆盖，按原来的「按客户端格式选端点」逻辑走。
 */
export function resolveOverrideTransport(provider, sourceFormat, credentials) {
  const fields = PROVIDER_CONNECTION_FIELDS[provider];
  if (!fields?.length) return null;

  const psd = credentials?.providerSpecificData || {};
  const pinnedFormat = normalizeWireFormat(psd.wireFormat);
  const config = PROVIDERS[provider];
  const transports = Array.isArray(config?.transports) ? config.transports : [];
  const baseRoot = normalizeBaseRoot(psd.baseUrl, transports);
  if (!pinnedFormat && !baseRoot) return null;

  let chosen = pinnedFormat ? transports.find((t) => t.format === pinnedFormat) : null;
  if (!chosen) chosen = transports.find((t) => t.format === sourceFormat) || null;
  if (!chosen) {
    // 没有同格式端点：退回 provider 默认 transport（只有覆盖 base url 时才走到这）。
    if (!baseRoot) return null;
    chosen = { ...(config || {}) };
  }
  if (!baseRoot) return chosen;
  return { ...chosen, baseUrl: composeUrl(baseRoot, chosen) };
}

/**
 * 探测/测试用的有效端点：连接级覆盖优先，否则用 registry 默认。
 * 返回 { baseUrl, urlSuffix, format, headers }。
 */
export function resolveProbeTransport(provider, providerSpecificData = null, preferredFormat = null) {
  const config = PROVIDERS[provider];
  if (!config) return null;
  const override = resolveOverrideTransport(provider, preferredFormat || config.format, { providerSpecificData });
  const transport = override || config;
  return {
    baseUrl: transport.baseUrl,
    urlSuffix: transport.urlSuffix || "",
    format: transport.format,
    headers: transport.headers || {},
  };
}
