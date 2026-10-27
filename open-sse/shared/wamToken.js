import {
  WAM_GRANT_TYPE,
  WAM_MIN_EXPIRES_FIRST_MS,
  WAM_MIN_EXPIRES_MAX,
  WAM_PROMPT_NONE,
  WAM_SCOPE_SUFFIX,
  WAM_SHORT_TOKEN_FLOOR_MS,
  WAM_TOKEN_REFRESH_LEAD_MS,
  WAM_TOKEN_TIMEOUT_MS,
  WAM_FIELD,
} from "../config/wamConstants.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

/**
 * Access tokens from a wam-proxy instance, for connections whose authType is "wam".
 *
 * wam-proxy holds the platform broker (WAM on Windows) and one signed-in account, and hands out
 * that account's Entra access token over an OAuth 2.0 client-credentials endpoint. There is no
 * refresh token: a caller that wants a newer token just asks again, optionally with
 * `min_expires_in`. So freshness is entirely this module's business, and the shared refresh
 * machinery in tokenRefresh.js is deliberately not involved — it requires a refreshToken, and the
 * background scheduler only looks at authType "oauth".
 *
 * Resolution happens on the request path, inside the executor, the way Bedrock's does: the token
 * that matters is the one valid when the request is sent, not the one that was valid when the
 * connection was saved.
 */

// cacheKey → { promise } while resolving, then the settled token entry.
const tokenCache = new Map();

// Cert material is read per (ca|cert|key|password) and the resulting dispatcher shared.
const dispatcherCache = new Map();

/** Test seam: drop cached tokens between cases. */
export function clearWamTokenCache() {
  tokenCache.clear();
}

/** A refusal from wam-proxy, or a local configuration problem. Never carries a secret. */
export class WamTokenError extends Error {
  constructor(message, { code = null, status = 0, retryAfterSeconds = 0 } = {}) {
    super(message);
    this.name = "WamTokenError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Normalize a scope. wam-proxy names a resource as `<uuid>/.default`, and an operator knows the
 * UUID, so a bare one is completed rather than rejected.
 */
function normalizeScope(raw) {
  return raw.includes("/") ? raw : raw + WAM_SCOPE_SUFFIX;
}

/**
 * The wam settings off a connection. Every field arrives as unschema'd providerSpecificData, so
 * each is validated here rather than trusted; the endpoint in particular becomes a request target.
 *
 * @returns {{endpoint, clientId, clientSecret, scope, cacheKey}}
 */
export function readWamConfig(credentials) {
  const psd = credentials?.providerSpecificData || {};
  const read = (key) => (typeof psd[key] === "string" ? psd[key].trim() : "");

  const endpoint = read(WAM_FIELD.endpoint);
  const clientId = read(WAM_FIELD.clientId);
  const clientSecret = read(WAM_FIELD.clientSecret);
  const rawScope = read(WAM_FIELD.scope);

  if (!endpoint) {
    throw new WamTokenError(
      `This connection has no wam-proxy token endpoint (${WAM_FIELD.endpoint}). Set it to the wam-proxy /token URL, for example http://127.0.0.1:8317/token.`,
    );
  }
  let parsed = null;
  try { parsed = new URL(endpoint); } catch { parsed = null; }
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    throw new WamTokenError(
      `The wam-proxy token endpoint ${JSON.stringify(endpoint)} is not an absolute http or https URL. wam-proxy serves plain HTTP on loopback only; reach a remote one over HTTPS.`,
    );
  }
  if (!clientId) {
    throw new WamTokenError(
      `This connection has no wam-proxy client id (${WAM_FIELD.clientId}). Register one with "wam-proxy new-client" on the machine running wam-proxy and paste its id and secret here.`,
    );
  }
  if (!clientSecret) {
    throw new WamTokenError(
      `This connection has no wam-proxy client secret (${WAM_FIELD.clientSecret}). Run "wam-proxy new-client" on the machine running wam-proxy and paste the secret here.`,
    );
  }
  if (!rawScope) {
    throw new WamTokenError(
      `This connection has no wam-proxy scope (${WAM_FIELD.scope}). Set it to the resource to authenticate for, either the UUID on its own or as <uuid>${WAM_SCOPE_SUFFIX}.`,
    );
  }

  const scope = normalizeScope(rawScope);
  return { endpoint, clientId, clientSecret, scope, cacheKey: `wam:${endpoint}|${clientId}|${scope}` };
}

/**
 * application/x-www-form-urlencoded encoding, as RFC 6749 §2.3.1 requires for each half of the
 * Basic credential. `encodeURIComponent` leaves ! ' ( ) * alone, so they are escaped on top of it
 * — wam-proxy encodes the same way, and an id containing one of them would otherwise mismatch.
 */
function formEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildBasicAuth(clientId, clientSecret) {
  const raw = `${formEncode(clientId)}:${formEncode(clientSecret)}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

/**
 * A dispatcher carrying the connection's CA and client certificate, when it names any.
 *
 * proxyAwareFetch passes the options object straight through on the direct path, so a dispatcher
 * set here survives; it is dropped when an egress proxy is configured, because that path builds
 * its own. Mutual TLS to a wam-proxy reached over a proxy is therefore not supported — reach it
 * directly for client-certificate authentication.
 */
async function getTlsDispatcher(psd) {
  const read = (key) => (typeof psd?.[key] === "string" ? psd[key].trim() : "");
  const caFile = read(WAM_FIELD.caFile);
  const certFile = read(WAM_FIELD.clientCertFile);
  const keyFile = read(WAM_FIELD.clientCertKeyFile);
  const password = read(WAM_FIELD.clientCertPassword);

  if (!caFile && !certFile) return undefined;

  const key = [caFile, certFile, keyFile, password ? "with-password" : "no-password"].join("|");
  if (!dispatcherCache.has(key)) {
    const promise = (async () => {
      const fs = await import("node:fs/promises");
      const { Agent } = await import("undici");
      const connect = {};
      if (caFile) connect.ca = await fs.readFile(caFile);
      if (certFile) connect.cert = await fs.readFile(certFile);
      if (keyFile) connect.key = await fs.readFile(keyFile);
      if (password) connect.passphrase = password;
      return new Agent({ connect });
    })();
    dispatcherCache.set(key, promise);
    promise.catch(() => dispatcherCache.delete(key));
  }

  try {
    return await dispatcherCache.get(key);
  } catch (error) {
    throw new WamTokenError(`Could not load the TLS material configured for wam-proxy: ${error.message}`);
  }
}

const REFUSAL_HINTS = {
  invalid_client: "The client id or secret is wrong, or was removed from wam-proxy's clients list.",
  unauthorized_client: "This client is not allowed to do that.",
  interaction_required: "wam-proxy needs an account window, and this acquisition was not allowed to open one.",
  temporarily_unavailable: "wam-proxy could not acquire a token in time, or the machine running it is offline.",
  invalid_scope: "wam-proxy or the identity platform refused this resource. Check the scope, and whether this client may ask for it.",
  invalid_grant: "The account on the machine running wam-proxy is not authorized for this resource, or the device does not meet policy.",
  server_error: "wam-proxy reported an internal failure.",
};

function buildRefusal(status, payload, headers) {
  const code = typeof payload?.error === "string" ? payload.error : null;
  const description = typeof payload?.error_description === "string" ? payload.error_description : "";
  const retryAfterSeconds = parseInt(headers?.get?.("retry-after") || "", 10);

  const hint = code ? REFUSAL_HINTS[code] : null;
  const message =
    `wam-proxy refused the token request (HTTP ${status}${code ? ` ${code}` : ""})` +
    (description ? `: ${description}` : "") +
    (hint ? ` ${hint}` : "");

  return new WamTokenError(message, {
    code,
    status,
    retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 0,
  });
}

async function acquire(config, psd, { fetchFn, proxyOptions, minExpiresIn, prompt, signal, now }) {
  const body = new URLSearchParams();
  body.set("grant_type", WAM_GRANT_TYPE);
  body.set("scope", config.scope);

  // wam-proxy rejects anything above 3600 with invalid_request, so the ask is clamped rather
  // than passed through.
  const requested = Math.max(0, Math.min(Math.round(minExpiresIn), WAM_MIN_EXPIRES_MAX));
  if (requested > 0) body.set("min_expires_in", String(requested));
  if (prompt === WAM_PROMPT_NONE) body.set("prompt", WAM_PROMPT_NONE);

  const dispatcher = await getTlsDispatcher(psd);
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: buildBasicAuth(config.clientId, config.clientSecret),
    },
    body: body.toString(),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(WAM_TOKEN_TIMEOUT_MS)]) : AbortSignal.timeout(WAM_TOKEN_TIMEOUT_MS),
    ...(dispatcher ? { dispatcher } : {}),
  };

  let res;
  try {
    res = await fetchFn(config.endpoint, options, proxyOptions);
  } catch (error) {
    throw new WamTokenError(`Could not reach wam-proxy at ${config.endpoint}: ${error.message}`, { code: "transport_error" });
  }

  const payload = await res.json().catch(() => null);
  if (!res.ok) throw buildRefusal(res.status, payload, res.headers);

  const accessToken = payload?.access_token;
  const expiresIn = Number(payload?.expires_in);
  if (typeof accessToken !== "string" || !accessToken || !Number.isFinite(expiresIn)) {
    throw new WamTokenError(`wam-proxy answered ${res.status} without a usable access_token and expires_in.`);
  }

  const ttlMs = Math.max(0, expiresIn * 1000);
  const acquiredAt = now();
  return {
    accessToken,
    // Serve until here: the lead makes sure a stream cannot outlive the token that authorized it.
    expiresAt: acquiredAt + Math.max(ttlMs - WAM_TOKEN_REFRESH_LEAD_MS, 0),
    // A token that arrived shorter than the lead is held, not re-requested, until this passes —
    // capped by the token's own life so it is never served past its real expiry.
    minRetryAt: acquiredAt + Math.min(ttlMs, WAM_SHORT_TOKEN_FLOOR_MS),
    broker: typeof payload?.broker === "string" ? payload.broker : null,
    scope: config.scope,
  };
}

/** Drop the internal bookkeeping fields from a cached entry. */
function present(entry) {
  return { accessToken: entry.accessToken, expiresAt: entry.expiresAt, broker: entry.broker, scope: entry.scope };
}

/**
 * Get a usable token for a `wam` connection.
 *
 * Concurrent callers on the same scope share one acquisition, successes and failures alike, so a
 * burst of requests does not become a burst of broker round trips.
 *
 * @param {object} credentials - 9router connection credentials.
 * @param {object} [opts]
 * @param {object} [opts.log]
 * @param {function} [opts.now] - Test seam for the clock.
 * @param {function} [opts.fetchFn] - Outbound fetch; proxyAwareFetch by default.
 * @param {object} [opts.proxyOptions] - Connection egress proxy, as executors receive it.
 * @param {number} [opts.minExpiresIn] - How much life to ask for, in seconds.
 * @param {string} [opts.prompt] - WAM_PROMPT_NONE to forbid an account window.
 * @param {AbortSignal} [opts.signal]
 * @param {boolean} [opts.force] - Skip the cache (used by the connection probe).
 * @returns {Promise<{accessToken, expiresAt, broker, scope}>}
 */
export async function resolveWamToken(
  credentials,
  {
    log = null,
    now = () => Date.now(),
    fetchFn = proxyAwareFetch,
    proxyOptions = null,
    minExpiresIn = WAM_MIN_EXPIRES_FIRST_MS,
    prompt = null,
    signal = null,
    force = false,
  } = {},
) {
  const config = readWamConfig(credentials);
  const psd = credentials?.providerSpecificData || {};

  if (!force) {
    const cached = tokenCache.get(config.cacheKey);
    if (cached?.promise) return present(await cached.promise);
    if (cached) {
      const currentTime = now();
      if (cached.expiresAt > currentTime || cached.minRetryAt > currentTime) return present(cached);
    }
  }

  // Publish the in-flight promise before the first await, so a burst collapses into one request.
  // The settled entry is written by this caller below; writing it from inside the promise would
  // let a fast resolution be overwritten by the in-flight marker and never expire again.
  const promise = acquire(config, psd, { fetchFn, proxyOptions, minExpiresIn, prompt, signal, now });
  tokenCache.set(config.cacheKey, { promise });

  let settled;
  try {
    settled = await promise;
  } catch (error) {
    // Never cache a failure: the next attempt should retry, not replay the refusal.
    tokenCache.delete(config.cacheKey);
    log?.warn?.("WAM", `token acquisition failed: ${error.message}`);
    throw error;
  }

  tokenCache.set(config.cacheKey, settled);
  const usableSeconds = Math.max(0, Math.round((settled.expiresAt - now()) / 1000));
  log?.debug?.(
    "WAM",
    `acquired a token for scope ${settled.scope}${settled.broker ? ` from ${settled.broker}` : ""}, ${usableSeconds}s of usable life`,
  );
  return present(settled);
}

/**
 * Check a wam connection by asking for one token, for the dashboard's validate and Test paths.
 * Nothing is cached, so the check reflects the configuration as it is right now.
 *
 * @returns {Promise<{valid: boolean, error: string|null}>}
 */
export async function probeWamCredentials(credentials, { fetchFn = proxyAwareFetch, proxyOptions = null } = {}) {
  try {
    await resolveWamToken(credentials, {
      fetchFn,
      proxyOptions,
      minExpiresIn: WAM_MIN_EXPIRES_FIRST_MS,
      force: true,
    });
    return { valid: true, error: null };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

export const __test__ = { formEncode, normalizeScope, buildBasicAuth, tokenCache, dispatcherCache };
