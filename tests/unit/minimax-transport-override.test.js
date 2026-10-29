/**
 * 连接级 transport 覆盖：base url（中转站/自建网关）与报文格式锁定。
 * registry 的 connectionFields 声明能改什么，open-sse/services/transportOverride.js 负责生效。
 */
import { describe, expect, it } from "vitest";

import { normalizeBaseRoot, normalizeWireFormat, resolveOverrideTransport, resolveProbeTransport } from "../../open-sse/services/transportOverride.js";

function credentials(providerSpecificData = {}) {
  return { apiKey: "sk-test", providerSpecificData };
}

describe("MiniMax connection-level transport override", () => {
  it("returns null when the connection overrides nothing", () => {
    expect(resolveOverrideTransport("minimax-cn", "openai", credentials())).toBeNull();
  });

  it("keeps the official endpoints when only the wire format is pinned", () => {
    const transport = resolveOverrideTransport("minimax-cn", "openai", credentials({ wireFormat: "claude" }));
    expect(transport.format).toBe("claude");
    expect(transport.baseUrl).toBe("https://api.minimaxi.com/anthropic/v1/messages");
    expect(transport.urlSuffix).toBe("?beta=true");
  });

  it("switches to the OpenAI endpoint when the wire format is pinned", () => {
    const transport = resolveOverrideTransport("minimax-cn", "claude", credentials({ wireFormat: "openai" }));
    expect(transport.format).toBe("openai");
    expect(transport.baseUrl).toBe("https://api.minimaxi.com/v1/chat/completions");
    expect(transport.auth).toEqual({ combined: true, header: "Authorization", scheme: "bearer" });
  });

  it("re-points the endpoint at a relay base url", () => {
    const transport = resolveOverrideTransport("minimax-cn", "openai", credentials({ baseUrl: "https://relay.example.com" }));
    expect(transport.baseUrl).toBe("https://relay.example.com/v1/chat/completions");
  });

  it("re-composes the endpoint per wire format when both are overridden", () => {
    const transport = resolveOverrideTransport("minimax-cn", "openai", credentials({ baseUrl: "https://relay.example.com", wireFormat: "claude" }));
    expect(transport.baseUrl).toBe("https://relay.example.com/anthropic/v1/messages");
  });

  it("accepts a pasted full endpoint and reduces it to the site root", () => {
    const transport = resolveOverrideTransport("minimax-cn", "openai", credentials({ baseUrl: "https://relay.example.com/v1/chat/completions" }));
    expect(transport.baseUrl).toBe("https://relay.example.com/v1/chat/completions");
  });

  it("keeps a relay path prefix", () => {
    const transport = resolveOverrideTransport("minimax-cn", "claude", credentials({ baseUrl: "https://relay.example.com/minimax" }));
    expect(transport.baseUrl).toBe("https://relay.example.com/minimax/anthropic/v1/messages");
  });

  it("applies the base url to the plan lane as well", () => {
    const transport = resolveOverrideTransport("minimax-code", "claude", credentials({ baseUrl: "https://relay.example.com" }));
    expect(transport.baseUrl).toBe("https://relay.example.com/mavis/api/v1/llm/v1/messages");
  });

  it("ignores a nonsense base url", () => {
    expect(resolveOverrideTransport("minimax-cn", "openai", credentials({ baseUrl: "not a url" }))).toBeNull();
    expect(resolveOverrideTransport("minimax-cn", "openai", credentials({ baseUrl: "file:///etc/passwd" }))).toBeNull();
  });

  it("normalizes the wire format value", () => {
    expect(normalizeWireFormat("auto")).toBeNull();
    expect(normalizeWireFormat("")).toBeNull();
    expect(normalizeWireFormat("Claude")).toBe("claude");
    expect(normalizeWireFormat("gemini")).toBeNull();
  });

  it("normalizes a pasted root", () => {
    expect(normalizeBaseRoot("https://relay.example.com/", [])).toBe("https://relay.example.com");
    expect(normalizeBaseRoot("https://relay.example.com/v1", [])).toBe("https://relay.example.com/v1");
  });

  it("gives the probe path the overridden endpoint", () => {
    const probe = resolveProbeTransport("minimax-cn", { baseUrl: "https://relay.example.com", wireFormat: "openai" });
    expect(probe.baseUrl).toBe("https://relay.example.com/v1/chat/completions");
    expect(probe.format).toBe("openai");
  });

  it("falls back to the registry endpoint for the probe when nothing is overridden", () => {
    const probe = resolveProbeTransport("minimax-cn", {});
    expect(probe.baseUrl).toBe("https://api.minimaxi.com/anthropic/v1/messages");
    expect(probe.format).toBe("claude");
  });
});
