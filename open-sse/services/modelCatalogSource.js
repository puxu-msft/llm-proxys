import REGISTRY from "../providers/registry/index.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { resolveWamToken } from "../shared/wamToken.js";
import { FILTERS } from "./modelCatalogFilters.js";

/**
 * A provider's declared model catalogue, read for reference.
 *
 * This is not the runtime override the dashboard's model picker uses (`modelsFetcher`, whose route
 * fetches anonymously). It answers a different question — "what does this endpoint actually offer
 * right now?" — so that the static `models[]` in a registry entry can be updated deliberately, by
 * a person, instead of drifting or being replaced at request time. `scripts/model-source.mjs` is
 * the reader.
 *
 * Everything here uses relative imports on purpose: this module must run under a plain
 * `node scripts/...`, where the app's `@/` and `open-sse/` path aliases do not resolve.
 */

/** The `modelSource` declaration a provider carries, if any. */
export function findModelSource(providerId) {
  const entry = REGISTRY.find((candidate) => candidate.id === providerId);
  if (!entry?.modelSource) return null;
  return { entry, source: entry.modelSource };
}

/** Every provider that declares one. */
export function listModelSources() {
  return REGISTRY.filter((entry) => entry.modelSource).map((entry) => entry.id);
}

/**
 * Headers that carry whatever credential the declaration asks for.
 *
 * `bearer` takes it off the connection; `wam` obtains it the same way a model request does, so a
 * catalog read exercises the identical path the models will use — which is the point of reading it
 * before trusting the static list.
 */
async function authHeaders(source, credentials, { log, proxyOptions, fetchFn }) {
  const kind = source.auth || "none";
  if (kind === "none") return {};

  const header = source.authHeader || "Authorization";
  const prefix = source.authPrefix ?? "Bearer ";

  if (kind === "bearer") {
    const token = credentials?.accessToken || credentials?.apiKey;
    if (!token) {
      throw new Error(
        "This modelSource needs a credential. Pass --connection <id> so one can be read from the database.",
      );
    }
    return { [header]: `${prefix}${token}` };
  }

  if (kind === "wam") {
    // The token is obtained the same way a model request obtains it — including the outbound fetch,
    // so a caller that injects one gets it honoured here rather than reaching the real network.
    const { accessToken } = await resolveWamToken(credentials, { log, proxyOptions, fetchFn });
    return { [header]: `${prefix}${accessToken}` };
  }

  throw new Error(`Unknown modelSource.auth ${JSON.stringify(kind)}; expected none, bearer or wam.`);
}

/**
 * The catalogue bodies in this fleet arrive in three shapes and a normalizer always gets an array.
 * Object-shaped ones (minimax-code's `{providers:[…]}`) ride in as a single-element array, which is
 * the same contract the suggested-models route applies.
 */
export function unwrapCatalog(payload) {
  if (Array.isArray(payload)) return payload;
  const inner = payload?.data ?? payload?.models ?? payload?.results;
  if (Array.isArray(inner)) return inner;
  if (inner && typeof inner === "object") return [inner];
  if (payload && typeof payload === "object") return [payload];
  return [];
}

/**
 * Read a provider's declared catalogue.
 *
 * @param {string} providerId
 * @param {object} [opts]
 * @param {object} [opts.credentials] - Connection credentials, for a declaration that needs one.
 * @param {function} [opts.fetchFn] - Outbound fetch; proxyAwareFetch by default.
 * @param {object} [opts.proxyOptions] - Connection egress proxy, as executors receive it.
 * @param {AbortSignal} [opts.signal]
 * @param {object} [opts.log]
 * @returns {Promise<{provider, url, format, entries: object[]}>}
 */
export async function resolveModelSource(
  providerId,
  { credentials = null, fetchFn = proxyAwareFetch, proxyOptions = null, signal = null, log = null } = {},
) {
  const found = findModelSource(providerId);
  if (!found) {
    throw new Error(
      `${providerId} declares no modelSource. Declared: ${listModelSources().join(", ") || "(none)"}`,
    );
  }
  const { source } = found;
  if (!source.url) throw new Error(`${providerId}'s modelSource has no url.`);

  const normalize = FILTERS[source.format];
  if (typeof normalize !== "function") {
    throw new Error(
      `${providerId}'s modelSource.format ${JSON.stringify(source.format)} has no normalizer in open-sse/services/modelCatalogFilters.js.`,
    );
  }

  const headers = {
    Accept: "application/json",
    ...(source.headers || {}),
    ...(await authHeaders(source, credentials, { log, proxyOptions, fetchFn })),
  };

  const response = await fetchFn(source.url, { method: "GET", headers, signal }, proxyOptions);
  if (!response.ok) {
    const error = new Error(`${providerId} model catalogue at ${source.url} answered HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const entries = normalize(unwrapCatalog(await response.json()));
  return { provider: providerId, url: source.url, format: source.format, entries };
}

/**
 * Compare a declared static list with what the source offers.
 *
 * Matched on the UPSTREAM id, not the client-facing one, so a deliberate alias is not reported as
 * an addition on every run: loki declares `claude-opus-5-5` for upstream `claude-opus-5.5`, and the
 * catalogue only ever names the upstream id.
 *
 * `missing` returns the declared model entries (not bare ids) because whether an absence matters
 * depends on the entry: a chat catalogue legitimately omits the embedding/tts/image entries a
 * provider also declares, and only the caller knows to say so.
 *
 * @returns {{added: object[], missing: object[]}}
 */
export function diffModelSource(models = [], entries = []) {
  const upstreamKey = (model) => model?.upstreamModelId || model?.id;

  const declared = new Map();
  for (const model of models) {
    if (model?.id) declared.set(upstreamKey(model), model);
  }

  const seen = new Set();
  const added = [];
  for (const entry of entries) {
    if (!entry?.id) continue;
    const key = upstreamKey(entry);
    seen.add(key);
    if (!declared.has(key)) added.push(entry);
  }

  const missing = models.filter((model) => model?.id && !seen.has(upstreamKey(model)));
  return { added, missing };
}

export const __test__ = { authHeaders };
