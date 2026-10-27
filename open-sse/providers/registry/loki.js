import { LOKI, LOKI_FINGERPRINT, LOKI_CREDENTIAL_DEFAULTS } from "../../config/lokiConstants.js";
import { WAM_DEFAULTS } from "../../config/wamConstants.js";
import { buildLokiFingerprintHeaders } from "../../shared/lokiHeaders.js";

// A first-party, internally-hosted model service ("Loki"), reached with a platform-broker token.
//
// Two endpoints, one per wire format, and the executor picks between them by model name — the
// same shape as the github provider, for the same reason: a static per-model targetFormat would
// both miss models the live catalogue surfaces later and double-translate the ones it lists.
//
// The connection form has no API key. Credentials come from a wam-proxy instance, which holds the
// broker and the signed-in account, so `authType` is "wam" and the keyless gates key off
// `wamTokenEndpoint` — see the WAM_FIELD block in config/wamConstants.js.
export default {
  id: "loki",
  alias: "lk",
  uiAlias: "lk",
  category: "apikey",
  authType: "wam",
  credentialForm: "wam",
  apiKeyOptionalWith: "wamTokenEndpoint",
  hasProviderSpecificData: true,
  credentialDefaults: {
    ...WAM_DEFAULTS,
    ...LOKI_CREDENTIAL_DEFAULTS,
  },
  display: {
    name: "Loki",
    icon: "bolt",
    color: "#0F6CBD",
  },
  transport: {
    // Messages is the default lane; the executor replaces it with responsesUrl for non-Claude
    // models. Both are absolute rather than baseUrl-relative, matching how the github entry
    // declares its pair.
    baseUrl: `${LOKI.baseUrl}${LOKI.messagesPath}`,
    messagesUrl: `${LOKI.baseUrl}${LOKI.messagesPath}`,
    responsesUrl: `${LOKI.baseUrl}${LOKI.responsesPath}`,
    format: "openai",
    // Both lanes force stream:true upstream (the Anthropic Messages wire and the Responses wire
    // are SSE-first), so chatCore must know a non-streaming client still needs the sseToJson
    // path. Without this a `stream:false` request would be handed a raw SSE body to .json().
    forceStream: true,
    // The Messages endpoint refuses `cache_control.ttl` other than the 5-minute default, which the
    // OpenAI→Claude translator otherwise sets to 1h on the system block and the last tool.
    quirks: { dropLongCacheTtl: true },
    fingerprint: { ...LOKI_FINGERPRINT },
  },
  // The catalogue's ids are the UPSTREAM ids. The four dash spellings first are what Claude Code
  // asks for; each names the dotted upstream model beside it, which is why they are aliases rather
  // than duplicates. Everything after them carries the catalogue's own id verbatim.
  //
  // Kept current with `node scripts/model-source.mjs loki --connection <id>`, which reads the real
  // catalogue and reports what differs — not by resolving this list at request time.
  models: [
    { id: "claude-opus-5-5", upstreamModelId: "claude-opus-5.5", name: "Claude Opus 5.5" },
    { id: "claude-opus-4-8", upstreamModelId: "claude-opus-5.5", name: "Claude Opus 5.5 (4.8 alias)" },
    { id: "claude-sonnet-5-5", upstreamModelId: "claude-sonnet-5.5", name: "Claude Sonnet 5.5" },
    { id: "claude-haiku-5-5", upstreamModelId: "claude-sonnet-5.5", name: "Claude Sonnet 5.5 (Haiku alias)" },

    { id: "claude-opus-5.5", name: "Claude Opus 5.5" },
    { id: "claude-opus-5", name: "Claude Opus 5" },
    { id: "claude-opus-4.8", name: "Claude Opus 4.8" },
    { id: "claude-opus-4.7", name: "Claude Opus 4.7" },
    { id: "claude-opus-4.6", name: "Claude Opus 4.6" },
    { id: "claude-sonnet-5.5", name: "Claude Sonnet 5.5" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "claude-haiku-5.5", name: "Claude Haiku 5.5" },
    { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },

    // Served through the Responses wire, which is what the catalogue lists for them.
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { id: "gpt-6-luna", name: "GPT-6 Luna" },
    { id: "gpt-6-sol", name: "GPT-6 Sol" },
    { id: "gpt-61-sol", name: "GPT-6.1 Sol" },
  ],
  // Where this provider's catalogue can be read for reference.
  //
  // Deliberately not `modelsFetcher`: that field is a runtime override for the dashboard's model
  // picker, and its route fetches the URL with no credentials at all, which this endpoint cannot
  // accept. This declaration is read by `scripts/model-source.mjs`, which prints what the upstream
  // offers so the static `models` list above can be updated deliberately rather than at runtime.
  //
  // Reachable only where wam-proxy is: the catalogue needs the same bearer token the models do.
  modelSource: {
    url: `${LOKI.baseUrl}${LOKI.modelsPath}`,
    format: "loki",
    auth: "wam",
    headers: buildLokiFingerprintHeaders(LOKI_FINGERPRINT),
  },
};
