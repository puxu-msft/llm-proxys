import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __test__,
  diffModelSource,
  findModelSource,
  listModelSources,
  resolveModelSource,
  unwrapCatalog,
} from "../../open-sse/services/modelCatalogSource.js";
import { FILTERS } from "../../open-sse/services/modelCatalogFilters.js";
import { clearWamTokenCache } from "../../open-sse/shared/wamToken.js";
import { LOKI } from "../../open-sse/config/lokiConstants.js";

const { authHeaders } = __test__;

const CATALOGUE_URL = "https://openrouter.ai/api/v1/models";
const LOKI_CATALOGUE_URL = `${LOKI.baseUrl}${LOKI.modelsPath}`;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function wamConnection() {
  return {
    authType: "wam",
    providerSpecificData: {
      wamTokenEndpoint: "http://127.0.0.1:8317/token",
      wamClientId: "loki-ghcp-proxy",
      wamClientSecret: "s3cret",
      wamScope: `${LOKI.resourceId}/.default`,
    },
  };
}

describe("model source (catalogue → static definitions)", () => {
  afterEach(() => {
    clearWamTokenCache();
    vi.restoreAllMocks();
  });

  describe("declarations", () => {
    it("finds a provider's declaration and lists the declaring providers", () => {
      expect(findModelSource("loki").source).toMatchObject({ url: LOKI_CATALOGUE_URL, format: "loki", auth: "wam" });
      expect(findModelSource("openai")).toBeNull();
      expect(listModelSources()).toEqual(expect.arrayContaining(["loki", "openrouter"]));
    });

    it("is separate from modelsFetcher, which is the runtime picker's anonymous override", () => {
      // openrouter declares both, and they mean different things: the fetcher is the free-tier list
      // the dashboard offers, the source is the full catalogue a person reads to update `models[]`.
      const entry = findModelSource("openrouter").entry;
      expect(entry.modelsFetcher).toMatchObject({ type: "openrouter-free" });
      expect(entry.modelSource).toMatchObject({ format: "openai" });
    });
  });

  describe("catalogue shapes", () => {
    it("unwraps the three shapes the fleet's catalogues arrive in", () => {
      expect(unwrapCatalog([{ id: "a" }])).toEqual([{ id: "a" }]);
      expect(unwrapCatalog({ data: [{ id: "b" }] })).toEqual([{ id: "b" }]);
      expect(unwrapCatalog({ models: [{ id: "c" }] })).toEqual([{ id: "c" }]);
      // Object-shaped catalogues (minimax-code) ride in as one element, as the picker route does.
      expect(unwrapCatalog({ providers: [{ providerId: "x" }] })).toEqual([{ providers: [{ providerId: "x" }] }]);
      expect(unwrapCatalog(null)).toEqual([]);
    });

    it("normalizes an OpenAI-shaped body without filtering anything out", () => {
      const entries = FILTERS.openai([
        { id: "vendor/model", name: "Vendor Model", context_length: 128000 },
        { id: "vendor/other", context_length: 4096 },
        { name: "no id" },
      ]);
      expect(entries).toEqual([
        { id: "vendor/model", name: "Vendor Model", contextLength: 128000 },
        { id: "vendor/other", name: "vendor/other", contextLength: 4096 },
      ]);
    });

    it("keeps the upstream id and the endpoint list for loki's catalogue", () => {
      const entries = FILTERS.loki([
        { id: "claude-opus-5.5", name: "Claude Opus 5.5", supported_endpoints: ["v1/messages"] },
      ]);
      expect(entries).toEqual([
        { id: "claude-opus-5.5", name: "Claude Opus 5.5", upstreamModelId: "claude-opus-5.5", endpoints: ["v1/messages"] },
      ]);
    });
  });

  describe("fetching", () => {
    it("reads an unauthenticated catalogue and returns normalized entries", async () => {
      const fetchFn = vi.fn(async () => json({ data: [{ id: "vendor/model", name: "Vendor Model", context_length: 200000 }] }));

      const result = await resolveModelSource("openrouter", { fetchFn });

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(fetchFn.mock.calls[0][0]).toBe(CATALOGUE_URL);
      expect(fetchFn.mock.calls[0][1].headers.Authorization).toBeUndefined();
      expect(result).toMatchObject({
        provider: "openrouter",
        url: CATALOGUE_URL,
        format: "openai",
        entries: [{ id: "vendor/model", name: "Vendor Model", contextLength: 200000 }],
      });
    });

    it("obtains a wam token, sends the fingerprint, and reads the catalogue with it", async () => {
      const calls = [];
      const fetchFn = vi.fn(async (url, options) => {
        calls.push({ url: String(url), options });
        if (String(url).endsWith("/token")) return json({ access_token: "tok-1", expires_in: 3600, broker: "windows-wam" });
        return json({ data: [{ id: "claude-opus-5.5", supported_endpoints: ["v1/messages"] }] });
      });

      const result = await resolveModelSource("loki", { credentials: wamConnection(), fetchFn });

      expect(calls[0].url).toBe("http://127.0.0.1:8317/token");
      expect(calls[1].url).toBe(LOKI_CATALOGUE_URL);
      expect(calls[1].options.headers.Authorization).toBe("Bearer tok-1");
      // The same application identity the model requests carry, from the shared builder.
      expect(calls[1].options.headers["X-ClientType"]).toBe("Copilot");
      expect(calls[1].options.headers["User-Agent"]).toMatch(/^copilot\//);
      expect(result.entries).toEqual([
        { id: "claude-opus-5.5", name: "claude-opus-5.5", upstreamModelId: "claude-opus-5.5", endpoints: ["v1/messages"] },
      ]);
    });

    it("reports a refusal instead of pretending the catalogue is empty", async () => {
      const fetchFn = vi.fn(async () => json({ error: "nope" }, 403));
      const error = await resolveModelSource("openrouter", { fetchFn }).catch((e) => e);
      expect(error.message).toMatch(/HTTP 403/);
      expect(error.status).toBe(403);
    });

    it("names the two ways to be unconfigured", async () => {
      await expect(resolveModelSource("openai", { fetchFn: vi.fn() })).rejects.toThrow(/declares no modelSource/);
      // loki needs a connection; without one the wam client says exactly what is missing.
      const log = null;
      await expect(resolveModelSource("loki", { fetchFn: vi.fn(), log })).rejects.toThrow(/no wam-proxy token endpoint/);
    });
  });

  describe("auth", () => {
    it("reads a bearer token off the connection, and refuses without one", async () => {
      const source = { auth: "bearer" };
      await expect(authHeaders(source, { accessToken: "at" }, {})).resolves.toEqual({ Authorization: "Bearer at" });
      await expect(authHeaders(source, { apiKey: "sk" }, {})).resolves.toEqual({ Authorization: "Bearer sk" });
      await expect(authHeaders(source, {}, {})).rejects.toThrow(/needs a credential/);
    });

    it("sends no credential for auth none, and names an unknown kind", async () => {
      await expect(authHeaders({}, null, {})).resolves.toEqual({});
      await expect(authHeaders({ auth: "carrier-pigeon" }, null, {})).rejects.toThrow(/Unknown modelSource.auth/);
    });
  });

  describe("diff against the static list", () => {
    const declared = [
      { id: "claude-opus-5-5", upstreamModelId: "claude-opus-5.5" },
      { id: "claude-sonnet-5-5", upstreamModelId: "claude-sonnet-5.5" },
      { id: "openai/text-embedding-3-small", kind: "embedding" },
    ];

    it("matches on the upstream id, so a deliberate alias is not an addition", () => {
      const { added, missing } = diffModelSource(declared, [
        { id: "claude-opus-5.5", upstreamModelId: "claude-opus-5.5" },
        { id: "claude-sonnet-5.5", upstreamModelId: "claude-sonnet-5.5" },
      ]);
      expect(added).toEqual([]);
      expect(missing.map((m) => m.id)).toEqual(["openai/text-embedding-3-small"]);
    });

    it("reports what the catalogue has and the registry does not", () => {
      const { added, missing } = diffModelSource(declared, [
        { id: "claude-opus-5.5", upstreamModelId: "claude-opus-5.5" },
        { id: "claude-haiku-5.5", upstreamModelId: "claude-haiku-5.5" },
      ]);
      expect(added.map((e) => e.id)).toEqual(["claude-haiku-5.5"]);
      // Objects, not ids: whether an absence matters depends on the entry's kind.
      expect(missing.map((m) => m.id)).toEqual(["claude-sonnet-5-5", "openai/text-embedding-3-small"]);
      expect(missing[1].kind).toBe("embedding");
    });

    it("treats an empty catalogue as everything-missing rather than everything-added", () => {
      expect(diffModelSource(declared, [])).toEqual({ added: [], missing: declared });
      expect(diffModelSource([], [])).toEqual({ added: [], missing: [] });
    });
  });
});
