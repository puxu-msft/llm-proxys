// === wam-proxy token endpoint ===
// 9router obtains a broker token from a wam-proxy instance over its OAuth 2.0 client-credentials
// endpoint (RFC 6749 §4.4). The token's subject is the desktop account of the machine running
// wam-proxy, not the caller — the caller's credentials only prove it may ask. Protocol constants
// live here rather than in a registry entry, because they are fixed by wam-proxy, not by any
// one provider that happens to use the `wam` authType.
export const WAM_GRANT_TYPE = "client_credentials";

// How long the whole exchange may take. wam-proxy has its own, usually shorter, bound
// (broker.interactiveTimeoutSeconds / broker.acquisitionTimeoutSeconds) and answers first.
export const WAM_TOKEN_TIMEOUT_MS = 30 * 1000;

// Re-acquire this far before the reported expiry, so a token cannot die mid-stream. Matches
// loki-ghcp-proxy, where a token with under two minutes left counts as spent.
export const WAM_TOKEN_REFRESH_LEAD_MS = 2 * 60 * 1000;

// What to ask for. wam-proxy answers from its own cache when the token it holds is long enough
// and only forces a broker refresh otherwise, so asking for less than a fresh token's lifetime
// keeps the common path a cache hit (by default its background refresh keeps ~10 minutes on hand).
// The first acquisition asks for the smaller value: it has to survive a start while the centre is
// briefly unreachable. The request path asks for more, because the token it replaces is one the
// centre may already be handing to everyone else. wam-proxy rejects anything above 3600.
export const WAM_MIN_EXPIRES_FIRST_MS = 180;
export const WAM_MIN_EXPIRES_REQUEST_MS = 600;
export const WAM_MIN_EXPIRES_MAX = 3600;

// `prompt=none` forbids opening an account window. Used only for acquisitions nobody is waiting on.
export const WAM_PROMPT_NONE = "none";

// A token that arrives with less life than the refresh lead would be re-requested on every call,
// and wam-proxy's cache would answer each one with the very same token. Serving it for a short
// floor instead keeps a clock-skewed or nearly-expired token from turning into a request storm.
// The floor is capped by the token's own lifetime, so it is never served past its real expiry.
export const WAM_SHORT_TOKEN_FLOOR_MS = 30 * 1000;

// wam-proxy names a resource as `<uuid>/.default`. A scope given as a bare UUID is completed
// with this suffix rather than rejected, since the UUID is the part an operator knows.
export const WAM_SCOPE_SUFFIX = "/.default";

// providerSpecificData keys for a `wam` connection. Flat and prefixed so a provider can carry
// its own keys alongside them; `wamTokenEndpoint` is also what registry `apiKeyOptionalWith`
// names, which is how a keyless connection passes the create/validate gates.
export const WAM_FIELD = {
  endpoint: "wamTokenEndpoint",
  clientId: "wamClientId",
  clientSecret: "wamClientSecret",
  scope: "wamScope",
  caFile: "wamCaFile",
  clientCertFile: "wamClientCertFile",
  clientCertKeyFile: "wamClientCertKeyFile",
  clientCertPassword: "wamClientCertPassword",
};

// providerSpecificData keys that must never leave the server. `providerConnectionResponse`
// strips these from every provider API response, the way it strips Bedrock's sessionToken.
export const WAM_SECRET_FIELD = [WAM_FIELD.clientSecret, WAM_FIELD.clientCertPassword];

// Fields the dashboard may read back for a wam connection.
export const WAM_SAFE_FIELD = [
  WAM_FIELD.endpoint,
  WAM_FIELD.clientId,
  WAM_FIELD.scope,
  WAM_FIELD.caFile,
  WAM_FIELD.clientCertFile,
];

// Defaults a provider can pre-fill a wam connection form with, mirroring the reference
// loki-ghcp-proxy deployment. A registry entry declares these under `credentialDefaults`.
export const WAM_DEFAULTS = {
  [WAM_FIELD.endpoint]: "http://127.0.0.1:8317/token",
};
