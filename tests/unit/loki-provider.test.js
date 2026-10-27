import { afterEach, describe, expect, it, vi } from "vitest";

// The executor, the wam client and the base executor all reach upstream through this module.
// Mocking it keeps the lanes offline and lets a test read exactly what was sent.
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getModelUpstreamId, getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { clearWamTokenCache } from "../../open-sse/shared/wamToken.js";
import { secretPsdFields, toProviderConnectionResponse } from "../../src/lib/providerConnectionResponse.js";
import { LOKI, LOKI_FINGERPRINT } from "../../open-sse/config/lokiConstants.js";

const WAM_ENDPOINT = "http://127.0.0.1:8317/token";
const SCOPE = `${LOKI.resourceId}${LOKI.scopeSuffix}`;
const SESSION_UUID = "11111111-2222-3333-4444-555555555555";

const entry = REGISTRY.find((candidate) => candidate.id === "loki");
const executor = getExecutor("loki");

function wamConnection() {
  return {
    authType: "wam",
    providerSpecificData: {
      wamTokenEndpoint: WAM_ENDPOINT,
      wamClientId: "loki-ghcp-proxy",
      wamClientSecret: "s3cret-value",
      wamScope: SCOPE,
    },
  };
}

function tokenResponse() {
  return new Response(
    JSON.stringify({ access_token: "tok-1", token_type: "Bearer", expires_in: 3600, broker: "windows-wam" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** One Anthropic Messages SSE stream, terminated the way the upstream terminates them. */
function anthropicSseResponse() {
  const events = [
    { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5.5", content: [], stop_reason: null, usage: { input_tokens: 3, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ];
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

/** Route the mocked fetch by URL substring; values are factories so each call gets a fresh body. */
function routeFetch(routes) {
  const calls = [];
  proxyAwareFetch.mockImplementation(async (url, options) => {
    const href = String(url);
    calls.push({ url: href, options });
    for (const [needle, make] of routes) {
      if (href.includes(needle)) return make();
    }
    throw new Error(`unexpected upstream call: ${href}`);
  });
  return calls;
}

describe("loki provider", () => {
  afterEach(() => {
    clearWamTokenCache();
    vi.restoreAllMocks();
  });

  it("is registered as a wam-authenticated provider whose keyless gate is the token endpoint", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(entry.alias).toBe("lk");
    expect(entry.authType).toBe("wam");
    expect(entry.credentialForm).toBe("wam");
    // This is what lets a connection with no API key pass the create and validate gates.
    expect(entry.apiKeyOptionalWith).toBe("wamTokenEndpoint");
    expect(entry.hasProviderSpecificData).toBe(true);
  });

  it("pre-fills the reference deployment's endpoint, client and scope", () => {
    expect(entry.credentialDefaults).toEqual({
      wamTokenEndpoint: WAM_ENDPOINT,
      wamClientId: "loki-ghcp-proxy",
      wamScope: SCOPE,
    });
  });

  it("declares the messages, responses and models paths off the private base", () => {
    const { baseUrl } = PROVIDERS.loki;
    expect(baseUrl).toBe(`${LOKI.baseUrl}${LOKI.messagesPath}`);
    expect(PROVIDERS.loki.messagesUrl).toBe(baseUrl);
    expect(PROVIDERS.loki.responsesUrl).toBe(`${LOKI.baseUrl}${LOKI.responsesPath}`);
    // Routing to the messages lane is decided by model name, never by a static targetFormat —
    // a per-model field would double-translate the models it lists (registry/github.js says why).
    for (const model of PROVIDER_MODELS.lk) {
      expect(getModelTargetFormat("lk", model.id)).toBeNull();
    }
  });

  it("forces streaming upstream so a non-streaming client still takes the sseToJson path", () => {
    expect(PROVIDERS.loki.forceStream).toBe(true);
  });

  it("maps the reference model names onto the ids the service expects", () => {
    expect(getModelUpstreamId("lk", "claude-opus-5-5")).toBe("claude-opus-5.5");
    expect(getModelUpstreamId("lk", "claude-opus-4-8")).toBe("claude-opus-5.5");
    expect(getModelUpstreamId("lk", "claude-sonnet-5-5")).toBe("claude-sonnet-5.5");
    expect(getModelUpstreamId("lk", "claude-haiku-5-5")).toBe("claude-sonnet-5.5");
  });

  it("registers a specialized executor under both the id and the alias", () => {
    expect(hasSpecializedExecutor("loki")).toBe(true);
    expect(hasSpecializedExecutor("lk")).toBe(true);
    expect(getExecutor("lk")).toBe(getExecutor("loki"));
  });

  describe("request fingerprint", () => {
    it("sends the Copilot Code application identity, with anthropic-version only on messages", () => {
      const credentials = { accessToken: "tok", __lokiConversationId: SESSION_UUID };
      const claude = executor.buildHeaders(credentials, true, PROVIDERS.loki.messagesUrl, "claude-opus-5.5");
      const other = executor.buildHeaders(credentials, true, PROVIDERS.loki.responsesUrl, "gpt-5.2");

      expect(claude.Authorization).toBe("Bearer tok");
      expect(claude["X-ClientType"]).toBe("Copilot");
      expect(claude["X-ClientScenario"]).toBe("Code");
      expect(claude["X-ClientFeature"]).toBe("LlmApiProxy");
      expect(claude["X-ConversationId"]).toBe(SESSION_UUID);
      expect(claude["anthropic-version"]).toBe("2023-06-01");
      expect(claude["User-Agent"]).toBe(
        `copilot/${LOKI_FINGERPRINT.cliVersion} (${process.platform} ${LOKI_FINGERPRINT.nodeVersion}) term/${process.env.TERM_PROGRAM || "unknown"}`,
      );

      expect(other["anthropic-version"]).toBeUndefined();
    });

    it("gives each send a fresh call id but reuses the conversation id", () => {
      const credentials = { accessToken: "tok", __lokiConversationId: SESSION_UUID };
      const first = executor.buildHeaders(credentials, true, PROVIDERS.loki.messagesUrl, "claude-opus-5.5");
      const second = executor.buildHeaders(credentials, true, PROVIDERS.loki.messagesUrl, "claude-opus-5.5");
      expect(first["X-ClientCallId"]).not.toBe(second["X-ClientCallId"]);
      expect(first["X-ConversationId"]).toBe(second["X-ConversationId"]);
    });
  });

  describe("lane routing", () => {
    it("sends Claude models to the messages lane and everything else to the responses lane", () => {
      expect(executor.isClaudeModel("claude-opus-5.5")).toBe(true);
      expect(executor.isClaudeModel("claude-sonnet-5.5")).toBe(true);
      expect(executor.isClaudeModel("gpt-5.2")).toBe(false);
      expect(executor.isClaudeModel("")).toBe(false);
    });
  });

  describe("messages lane", () => {
    it("fetches a wam token, translates to the Anthropic wire, and re-emits OpenAI chunks", async () => {
      const calls = routeFetch([
        ["/token", tokenResponse],
        [LOKI.messagesPath, anthropicSseResponse],
      ]);

      const credentials = wamConnection();
      const result = await executor.execute({
        // chatCore hands the executor the id the client asked for, and a body already rewritten
        // to the upstream id.
        model: "claude-opus-5-5",
        body: { model: "claude-opus-5.5", messages: [{ role: "user", content: "hi" }], stream: true },
        stream: true,
        credentials,
        providerSessionId: SESSION_UUID,
        log: null,
      });

      // 1) the wam acquisition, with the client's own credentials
      expect(calls[0].url).toBe(WAM_ENDPOINT);
      expect(calls[0].options.headers.Authorization).toMatch(/^Basic /);
      expect(calls[0].options.body).toContain("scope=");

      // 2) the model call, on the messages path, carrying the broker token and the fingerprint
      expect(calls[1].url).toBe(PROVIDERS.loki.messagesUrl);
      expect(calls[1].options.headers.Authorization).toBe("Bearer tok-1");
      expect(calls[1].options.headers["X-ConversationId"]).toBe(SESSION_UUID);

      const upstreamBody = JSON.parse(calls[1].options.body);
      expect(upstreamBody.model).toBe("claude-opus-5.5");
      expect(upstreamBody.stream).toBe(true);
      // Internal translator bookkeeping must not reach the upstream's strict schema.
      expect(upstreamBody._toolNameMap).toBeUndefined();

      const text = await result.response.text();
      expect(text).toContain("chat.completion.chunk");
      expect(text).toContain("hi");
    });

    it("passes the upstream error through untouched", async () => {
      routeFetch([
        ["/token", tokenResponse],
        [LOKI.messagesPath, () => jsonResponse({ error: { message: "invalid_model_family" } }, 400)],
      ]);

      const result = await executor.execute({
        model: "claude-opus-5-5",
        body: { model: "claude-opus-5.5", messages: [{ role: "user", content: "hi" }] },
        stream: true,
        credentials: wamConnection(),
        log: null,
      });

      expect(result.response.status).toBe(400);
    });

    it("fails the request when wam-proxy refuses, without calling the upstream", async () => {
      const calls = routeFetch([
        ["/token", () => jsonResponse({ error: "invalid_client" }, 401)],
        [LOKI.messagesPath, anthropicSseResponse],
      ]);

      const error = await executor
        .execute({
          model: "claude-opus-5-5",
          body: { model: "claude-opus-5.5", messages: [] },
          stream: true,
          credentials: wamConnection(),
          log: null,
        })
        .catch((e) => e);

      expect(error.message).toMatch(/invalid_client/);
      expect(error.message).not.toContain("s3cret-value");
      expect(calls).toHaveLength(1);
    });
  });

  describe("responses lane", () => {
    it("sends non-Claude models to the responses path with the upstream id", async () => {
      const calls = routeFetch([
        ["/token", tokenResponse],
        [LOKI.responsesPath, () => jsonResponse({ error: { message: "probe" } }, 400)],
      ]);

      await executor.execute({
        model: "gpt-5.2",
        body: { model: "gpt-5.2", messages: [{ role: "user", content: "hi" }], stream: true },
        stream: true,
        credentials: wamConnection(),
        log: null,
      });

      expect(calls[1].url).toBe(PROVIDERS.loki.responsesUrl);
      expect(JSON.parse(calls[1].options.body).model).toBe("gpt-5.2");
      expect(calls[1].options.headers["anthropic-version"]).toBeUndefined();
    });
  });

  describe("request shape", () => {
    const openAiBody = () => ({
      messages: [
        { role: "system", content: "Be terse." },
        { role: "user", content: "hi" },
      ],
      tools: [{ type: "function", function: { name: "ping", description: "ping", parameters: { type: "object", properties: {} } } }],
      max_tokens: 64,
    });

    it("drops a long cache_control ttl the messages endpoint refuses", () => {
      const translated = translateRequest(
        FORMATS.OPENAI,
        FORMATS.CLAUDE,
        "claude-sonnet-5.5",
        openAiBody(),
        true,
        {},
        "loki",
      );

      // The breakpoints stay — only the ttl the upstream rejects is gone.
      const caches = [...(translated.system || []), ...(translated.tools || [])]
        .map((block) => block?.cache_control)
        .filter(Boolean);
      expect(caches.length).toBeGreaterThan(0);
      for (const cache of caches) {
        expect(cache.type).toBe("ephemeral");
        expect(cache.ttl).toBeUndefined();
      }
    });

    it("leaves the ttl alone for a provider that does not declare the quirk", () => {
      // Same translator, different provider: the quirk is opt-in, so this must be untouched.
      const translated = translateRequest(
        FORMATS.OPENAI,
        FORMATS.CLAUDE,
        "claude-sonnet-4-5",
        openAiBody(),
        true,
        {},
        "claude",
      );
      const ttl = (translated.system || []).map((block) => block?.cache_control?.ttl).find(Boolean);
      expect(ttl).toBe("1h");
    });
  });

  describe("credential secrecy", () => {
    it("names the client secret and any certificate password as secret provider data", () => {
      expect(secretPsdFields("loki")).toEqual(["wamClientSecret", "wamClientCertPassword"]);
      expect(secretPsdFields("bedrock")).toEqual(["sessionToken"]);
      expect(secretPsdFields("openai")).toEqual([]);
    });

    it("strips the wam secret from a provider connection response", () => {
      const response = toProviderConnectionResponse({
        id: "c1",
        provider: "loki",
        authType: "wam",
        accessToken: "hidden",
        providerSpecificData: { wamTokenEndpoint: WAM_ENDPOINT, wamClientId: "loki-ghcp-proxy", wamClientSecret: "s3cret-value" },
      });

      expect(response.apiKey).toBeUndefined();
      expect(response.accessToken).toBeUndefined();
      expect(response.providerSpecificData.wamClientSecret).toBeUndefined();
      expect(response.providerSpecificData.wamTokenEndpoint).toBe(WAM_ENDPOINT);
      expect(response.providerSpecificData.wamClientId).toBe("loki-ghcp-proxy");
    });
  });
});
