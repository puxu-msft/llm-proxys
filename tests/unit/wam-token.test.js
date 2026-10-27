import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WamTokenError,
  __test__,
  clearWamTokenCache,
  probeWamCredentials,
  readWamConfig,
  resolveWamToken,
} from "../../open-sse/shared/wamToken.js";

const { formEncode, normalizeScope, buildBasicAuth } = __test__;

// The reference deployment's values (open-sse/config/lokiConstants.js).
const ENDPOINT = "http://127.0.0.1:8317/token";
const SCOPE_UUID = "42c8f7bd-c7a8-4ba9-bc1c-91edfb716247";

function connection(overrides = {}) {
  return {
    authType: "wam",
    providerSpecificData: {
      wamTokenEndpoint: ENDPOINT,
      wamClientId: "loki-ghcp-proxy",
      wamClientSecret: "s3cret-value",
      wamScope: `${SCOPE_UUID}/.default`,
      ...overrides,
    },
  };
}

function tokenResponse({ accessToken = "tok-1", expiresIn = 3600, broker = "windows-wam" } = {}) {
  return new Response(
    JSON.stringify({ access_token: accessToken, token_type: "Bearer", expires_in: expiresIn, broker }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function refusal(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

/** Parse the form body a fetch mock received into a plain object. */
function bodyOf(call) {
  return Object.fromEntries(new URLSearchParams(call[1].body));
}

describe("wam token client", () => {
  afterEach(() => {
    clearWamTokenCache();
    vi.restoreAllMocks();
  });

  describe("protocol encoding", () => {
    it("percent-encodes each half of the Basic credential per RFC 6749 §2.3.1", () => {
      // encodeURIComponent leaves ! ' ( ) * alone; the form encoder must not.
      expect(formEncode("a b/c+d:e@f")).toBe("a%20b%2Fc%2Bd%3Ae%40f");
      expect(formEncode("it's*ok(ish)!")).toBe("it%27s%2Aok%28ish%29%21");
      expect(formEncode("plain-id_1.0~")).toBe("plain-id_1.0~");
    });

    it("takes the endpoint and never the secret into the error path", () => {
      const header = buildBasicAuth("client", "s3cret");
      expect(header.startsWith("Basic ")).toBe(true);
      const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
      expect(decoded).toBe("client:s3cret");
    });

    it("completes a bare resource UUID into the /.default scope wam-proxy expects", () => {
      expect(normalizeScope(SCOPE_UUID)).toBe(`${SCOPE_UUID}/.default`);
      expect(normalizeScope(`${SCOPE_UUID}/.default`)).toBe(`${SCOPE_UUID}/.default`);
      expect(normalizeScope("api://thing/.default")).toBe("api://thing/.default");
    });
  });

  describe("configuration", () => {
    it("reads the wam settings off a connection", () => {
      expect(readWamConfig(connection())).toMatchObject({
        endpoint: ENDPOINT,
        clientId: "loki-ghcp-proxy",
        scope: `${SCOPE_UUID}/.default`,
      });
    });

    it("names the missing field, and never a value, when the connection is incomplete", () => {
      for (const [missing, pattern] of [
        ["wamTokenEndpoint", /no wam-proxy token endpoint/],
        ["wamClientId", /no wam-proxy client id/],
        ["wamClientSecret", /no wam-proxy client secret/],
        ["wamScope", /no wam-proxy scope/],
      ]) {
        const credentials = connection({ [missing]: "" });
        expect(() => readWamConfig(credentials)).toThrow(WamTokenError);
        expect(() => readWamConfig(credentials)).toThrow(pattern);
      }
    });

    it("rejects an endpoint that is not an absolute http or https URL", () => {
      expect(() => readWamConfig(connection({ wamTokenEndpoint: "127.0.0.1:8317/token" }))).toThrow(
        /not an absolute http or https URL/,
      );
    });
  });

  describe("acquisition", () => {
    it("posts a client-credentials request to the configured endpoint", async () => {
      const fetchFn = vi.fn().mockResolvedValue(tokenResponse());
      const token = await resolveWamToken(connection(), { fetchFn, minExpiresIn: 600 });

      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [url, options] = fetchFn.mock.calls[0];
      expect(url).toBe(ENDPOINT);
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
      expect(options.headers.Authorization).toBe(buildBasicAuth("loki-ghcp-proxy", "s3cret-value"));
      expect(bodyOf(fetchFn.mock.calls[0])).toEqual({
        grant_type: "client_credentials",
        scope: `${SCOPE_UUID}/.default`,
        min_expires_in: "600",
      });
      expect(token).toMatchObject({ accessToken: "tok-1", broker: "windows-wam" });
    });

    it("sends prompt=none only when asked, and clamps the requested life", async () => {
      const fetchFn = vi.fn().mockResolvedValue(tokenResponse());
      await resolveWamToken(connection(), { fetchFn, minExpiresIn: 99999, prompt: "none" });
      const body = bodyOf(fetchFn.mock.calls[0]);
      expect(body.min_expires_in).toBe("3600");
      expect(body.prompt).toBe("none");

      clearWamTokenCache();
      const fetchFn2 = vi.fn().mockResolvedValue(tokenResponse());
      await resolveWamToken(connection(), { fetchFn: fetchFn2, minExpiresIn: 180 });
      expect(bodyOf(fetchFn2.mock.calls[0]).prompt).toBeUndefined();
    });

    it("holds a token for its reported life less the refresh lead", async () => {
      const now = 1_000_000_000_000;
      const fetchFn = vi.fn().mockResolvedValue(tokenResponse({ expiresIn: 3600 }));
      const token = await resolveWamToken(connection(), { fetchFn, now: () => now });
      expect(token.expiresAt).toBe(now + (3600 - 120) * 1000);
    });

    it("serves from cache without a second request, and shares one in-flight acquisition", async () => {
      const fetchFn = vi.fn().mockResolvedValue(tokenResponse());
      const [a, b] = await Promise.all([
        resolveWamToken(connection(), { fetchFn }),
        resolveWamToken(connection(), { fetchFn }),
      ]);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(a.accessToken).toBe(b.accessToken);

      await resolveWamToken(connection(), { fetchFn });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it("re-acquires once the cached token has run out", async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(tokenResponse({ accessToken: "tok-1", expiresIn: 3600 }))
        .mockResolvedValueOnce(tokenResponse({ accessToken: "tok-2", expiresIn: 3600 }));

      let now = 1_000_000_000_000;
      await resolveWamToken(connection(), { fetchFn, now: () => now });
      now += 3600 * 1000 + 1;
      const second = await resolveWamToken(connection(), { fetchFn, now: () => now });

      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(second.accessToken).toBe("tok-2");
    });

    it("serves a too-short token for a floor instead of re-requesting it forever", async () => {
      // wam-proxy hands back the same token while another caller holds it, so asking again would
      // return the same short token and turn into a request storm. A factory, not a fixed value:
      // a Response body can only be read once.
      const fetchFn = vi.fn().mockImplementation(() => tokenResponse({ expiresIn: 100 }));
      let now = 1_000_000_000_000;

      await resolveWamToken(connection(), { fetchFn, now: () => now });
      now += 5 * 1000;
      await resolveWamToken(connection(), { fetchFn, now: () => now });
      expect(fetchFn).toHaveBeenCalledTimes(1);

      // Past the floor, and still inside the token's real life.
      now += 30 * 1000;
      await resolveWamToken(connection(), { fetchFn, now: () => now });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("never caches a refusal", async () => {
      const fetchFn = vi.fn().mockResolvedValue(refusal(401, { error: "invalid_client" }));
      await expect(resolveWamToken(connection(), { fetchFn })).rejects.toThrow(WamTokenError);
      await expect(resolveWamToken(connection(), { fetchFn })).rejects.toThrow(WamTokenError);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });
  });

  describe("refusals", () => {
    it("maps the documented error codes, and keeps the secret out of the message", async () => {
      const cases = [
        [401, "invalid_client", /invalid_client/],
        [403, "interaction_required", /interaction_required/],
        [400, "invalid_scope", /invalid_scope/],
        [500, "server_error", /server_error/],
      ];
      for (const [status, code, pattern] of cases) {
        clearWamTokenCache();
        const fetchFn = vi.fn().mockResolvedValue(
          refusal(status, { error: code, error_description: "from wam-proxy" }),
        );
        const error = await resolveWamToken(connection(), { fetchFn }).catch((e) => e);
        expect(error).toBeInstanceOf(WamTokenError);
        expect(error.message).toMatch(pattern);
        expect(error.message).toContain("from wam-proxy");
        expect(error.message).not.toContain("s3cret-value");
        expect(error.status).toBe(status);
        expect(error.code).toBe(code);
      }
    });

    it("carries Retry-After through a temporarily_unavailable", async () => {
      const fetchFn = vi.fn().mockResolvedValue(
        refusal(503, { error: "temporarily_unavailable" }, { "Retry-After": "5" }),
      );
      const error = await resolveWamToken(connection(), { fetchFn }).catch((e) => e);
      expect(error.retryAfterSeconds).toBe(5);
    });

    it("reports a transport failure without echoing the endpoint's credentials", async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      const error = await resolveWamToken(connection(), { fetchFn }).catch((e) => e);
      expect(error.code).toBe("transport_error");
      expect(error.message).toContain(ENDPOINT);
      expect(error.message).not.toContain("s3cret-value");
    });

    it("treats a 200 without a usable token as a failure", async () => {
      const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ broker: "windows-wam" }), { status: 200 }));
      await expect(resolveWamToken(connection(), { fetchFn })).rejects.toThrow(/without a usable access_token/);
    });
  });

  describe("connection probe", () => {
    it("validates by asking for one token, uncached", async () => {
      const fetchFn = vi.fn().mockResolvedValue(tokenResponse());
      expect(await probeWamCredentials(connection(), { fetchFn })).toEqual({ valid: true, error: null });
      expect(bodyOf(fetchFn.mock.calls[0]).min_expires_in).toBe("180");

      // force:true — a second probe must not be answered from the cache.
      await probeWamCredentials(connection(), { fetchFn });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("returns the refusal as the error rather than throwing", async () => {
      const fetchFn = vi.fn().mockResolvedValue(refusal(401, { error: "invalid_client" }));
      const result = await probeWamCredentials(connection(), { fetchFn });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid_client/);
    });
  });
});
