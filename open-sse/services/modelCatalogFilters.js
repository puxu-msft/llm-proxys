import { normalizeNousFreeModels } from "./nous.js";

// Catalog normalizers, keyed by the `format` a registry `modelSource` (or a `modelsFetcher`
// `type`) names. Each turns one upstream catalogue body into `{ id, name, contextLength? }`
// entries. They are shared by two consumers with different jobs: the dashboard's suggested-model
// picker fetches anonymously, and `scripts/model-source.mjs` reads the same declarations with a
// connection's credentials to produce a reference for the static registry lists.

// Free OpenCode models that don't use the "-free" id suffix
const KNOWN_FREE_OPENCODE_MODELS = ["big-pickle"];

// Upstream returns "Model is unavailable" for this id (2026-09-02) — re-enable when fixed
const DEAD_FREE_OPENCODE_MODELS = new Set(["deepseek-v4-flash-free"]);

export const FILTERS = {
  "openrouter-free": (models) =>
    models
      .filter(
        (m) =>
          m.pricing?.prompt === "0" &&
          m.pricing?.completion === "0" &&
          m.context_length >= 200000
      )
      .map((m) => ({ id: m.id, name: m.name, contextLength: m.context_length }))
      .sort((a, b) => b.contextLength - a.contextLength),

  "opencode-free": (models) =>
    models
      .filter((m) => (m.id?.endsWith("-free") || KNOWN_FREE_OPENCODE_MODELS.includes(m.id)) && !DEAD_FREE_OPENCODE_MODELS.has(m.id))
      .map((m) => ({ id: m.id, name: m.id })),

  // Go subscription catalogue — every /models id is selectable; the endpoint lane
  // per model is resolved by the family regex (see open-sse/providers/models/helpers.js)
  "opencode-go": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => typeof m?.id === "string")
      .map((m) => ({ id: m.id, name: m.id })),

  // models.dev returns a large catalog; keep only mimo models
  "mimo-free": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => m.id?.startsWith("mimo") || m.name?.toLowerCase().includes("mimo"))
      .map((m) => ({ id: m.id, name: m.name || m.id })),

  // MiniMax Code (mcode) live catalog: {providers:[{providerId:"minimax",
  // config:{models:{<id>:{name, limit, modalities, thinking_config}}}}]} —
  // arrives wrapped in a single-element array (see route normalization).
  "minimax-code": (raw) => {
    const env = Array.isArray(raw) ? raw[0] : raw;
    const p = (Array.isArray(env?.providers) ? env.providers : []).find((x) => x?.providerId === "minimax");
    const ms = p?.config?.models;
    if (!ms || typeof ms !== "object") return [];
    return Object.entries(ms)
      .filter(([id, m]) => typeof id === "string" && id.trim() !== "" && m && typeof m === "object")
      .map(([id, m]) => ({ id, name: m?.name || id, contextLength: Number(m?.limit?.context) || undefined }))
      .sort((a, b) => (b.contextLength || 0) - (a.contextLength || 0));
  },

  "airforce-free": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => (m.tier === "free" || m.id?.endsWith(":free")) && m.supports_chat === true && (!m.media_type || m.media_type === "chat" || m.media_type === "text"))
      .map((m) => ({ id: m.id, name: m.name || m.id, contextLength: m.context_length }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),

  "nous-free": normalizeNousFreeModels,

  // A plain OpenAI-shaped /models body, unfiltered. Used as a reference source ("what does this
  // endpoint offer?") rather than to seed a picker, so nothing is filtered out.
  openai: (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => typeof m?.id === "string" && m.id.trim() !== "")
      .map((m) => ({
        id: m.id,
        name: m.name || m.id,
        contextLength: m.context_length ?? m.contextLength ?? undefined,
      })),

  // loki's catalogue: { data: [{ id, name?, supported_endpoints: [...] }] }, where the ids are the
  // UPSTREAM ids. A declared client-facing alias therefore keeps the same upstream id, which is why
  // `upstreamModelId` is filled in here: it is the key the registry diff matches on. The endpoint
  // list is carried through as a hint for whoever writes the static entry, since the wire lane is
  // chosen by model name upstream.
  loki: (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => typeof m?.id === "string" && m.id.trim() !== "")
      .map((m) => ({
        id: m.id,
        name: m.name || m.id,
        upstreamModelId: m.id,
        endpoints: Array.isArray(m.supported_endpoints) ? m.supported_endpoints : undefined,
      })),
};
