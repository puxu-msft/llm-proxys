// === loki / Copilot-models service ===
// A first-party, internally-hosted model service reached with a platform-broker token. The
// endpoint and the resource UUID are private connection information, not secrets: they are kept
// in one place here so a deployment can point at another instance without hunting through the
// registry entry and the executor. Public builds simply do not use this provider.
export const LOKI = {
  // Relative references resolve against this base, so its trailing slash is load-bearing.
  baseUrl: "https://df.loki.delve.office.com/api/v1/llmapi/",
  messagesPath: "v1/messages",
  responsesPath: "responses",
  modelsPath: "models",
  // The resource the broker token must be issued for. wam-proxy asks for it as `<uuid>/.default`.
  resourceId: "42c8f7bd-c7a8-4ba9-bc1c-91edfb716247",
  scopeSuffix: "/.default",
};

// The Copilot Code runtime versions the upstream expects to see in the request fingerprint. A
// snapshot a real `show-fingerprint --json` produced on 2026-10-19. Phase 2 replaces this with
// discovery from a local runtime directory plus a refresh/status endpoint; until then, upgrading
// the upstream's expected version means editing this block.
export const LOKI_FINGERPRINT = {
  runtimeVersion: "0.1.317.0",
  cliVersion: "1.0.80",
  nodeVersion: "v24.18.1",
};

// The service rejects a request carrying no recognizable Copilot-Code application identity, and
// the identity is enforced through these headers rather than the token. Values are fixed strings;
// only User-Agent interpolates the versions above.
export const LOKI_HEADERS = {
  clientType: "Copilot",
  clientScenario: "Code",
  clientFeature: "LlmApiProxy",
};

// Terminal event of a well-formed Anthropic stream. Tracking it is what separates a finished
// answer from an upstream that hung up cleanly halfway through one (phase 2 uses it for the
// failure record; the translators already depend on the event itself).
export const LOKI_TERMINAL_EVENT = "message_stop";

// Credential defaults a loki connection form is pre-filled with, mirroring the reference
// loki-ghcp-proxy deployment. Spread over WAM_DEFAULTS, which supplies the token endpoint.
export const LOKI_CREDENTIAL_DEFAULTS = {
  wamClientId: "loki-ghcp-proxy",
  wamScope: `${LOKI.resourceId}${LOKI.scopeSuffix}`,
};
