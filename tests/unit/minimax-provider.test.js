/**
 * MiniMax 厂商聚合：api（开放平台）+ plan（MiniMax Code）两条通道共用一个目录，
 * 模型清单、站点地址、报文格式都从 providers/minimax/ 一处出。
 */
import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS, PROVIDER_CONNECTION_FIELDS } from "../../open-sse/providers/index.js";
import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { MINIMAX_SITES, MINIMAX_WIRE_FORMATS } from "../../open-sse/providers/minimax/constants.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

const API_IDS = ["minimax", "minimax-cn"];
const PLAN_IDS = ["minimax-code", "minimax-code-global"];

describe("MiniMax provider directory", () => {
  it("registers all four MiniMax lanes", () => {
    const ids = REGISTRY.map((entry) => entry.id);
    for (const id of [...API_IDS, ...PLAN_IDS]) expect(ids).toContain(id);
  });

  it("keeps every registry id unique", () => {
    const ids = REGISTRY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points the api lanes at their own site", () => {
    expect(PROVIDERS["minimax"].baseUrl).toBe("https://api.minimax.io/anthropic/v1/messages");
    expect(PROVIDERS["minimax-cn"].baseUrl).toBe("https://api.minimaxi.com/anthropic/v1/messages");
  });

  it("points the plan lanes at their own agent gateway", () => {
    expect(PROVIDERS["minimax-code"].baseUrl).toBe("https://agent.minimax.cn/mavis/api/v1/llm/v1/messages");
    expect(PROVIDERS["minimax-code-global"].baseUrl).toBe("https://agent.minimax.io/mavis/api/v1/llm/v1/messages");
  });

  it("offers both wire formats on the api lanes", () => {
    for (const id of API_IDS) {
      const formats = PROVIDERS[id].transports.map((t) => t.format);
      expect(formats).toEqual(expect.arrayContaining(["openai", "claude"]));
      for (const transport of PROVIDERS[id].transports) {
        expect(transport.baseUrl).toBe(`${transport.baseRoot}${transport.path}`);
      }
    }
  });

  it("derives the transport paths from the shared constants", () => {
    expect(MINIMAX_WIRE_FORMATS.openai.path).toBe("/v1/chat/completions");
    expect(MINIMAX_WIRE_FORMATS.claude.path).toBe("/anthropic/v1/messages");
    for (const id of API_IDS) {
      const claude = PROVIDERS[id].transports.find((t) => t.format === "claude");
      expect(claude.path).toBe(MINIMAX_WIRE_FORMATS.claude.path);
    }
  });

  it("lists M3.1-Flash and M3 on every lane", () => {
    for (const id of [...API_IDS, ...PLAN_IDS]) {
      const ids = getModelsByProviderId(id).map((m) => m.id);
      expect(ids).toContain("MiniMax-M3.1-Flash");
      expect(ids).toContain("MiniMax-M3");
    }
  });

  it("keeps the retired Preview id working as an alias", () => {
    for (const id of [...API_IDS, ...PLAN_IDS]) {
      const alias = getModelsByProviderId(id).find((m) => m.id === "MiniMax-M3.1-Flash-Preview");
      expect(alias?.upstreamModelId).toBe("MiniMax-M3.1-Flash");
    }
  });

  it("declares M3.1-Flash as a 1M-context reasoning model that cannot stop thinking", () => {
    for (const id of API_IDS) {
      const caps = getCapabilitiesForModel(id, "MiniMax-M3.1-Flash");
      expect(caps.reasoning).toBe(true);
      expect(caps.vision).toBe(true);
      expect(caps.thinkingCanDisable).toBe(false);
      expect(caps.contextWindow).toBe(1000000);
      expect(caps.supportsOutputConfig).toBe(true);
    }
  });

  it("offers the upstream thinking depths on M3.1-Flash", () => {
    for (const id of API_IDS) {
      expect(getThinkingLevels(id, "MiniMax-M3.1-Flash")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    }
  });

  it("keeps the media models of the api lane", () => {
    const intl = getModelsByProviderId("minimax").map((m) => m.id);
    expect(intl).toContain("speech-2.8-hd");
    expect(intl).toContain("minimax-image-01");
    const cn = getModelsByProviderId("minimax-cn").map((m) => m.id);
    expect(cn).toContain("speech-2.8-hd");
    expect(cn).not.toContain("minimax-image-01");
  });

  it("exposes the plan quota endpoints per site", () => {
    expect(PROVIDERS["minimax"].usage.urls).toEqual(MINIMAX_SITES.global.usageUrls);
    expect(PROVIDERS["minimax-cn"].usage.urls).toEqual(MINIMAX_SITES.cn.usageUrls);
  });

  it("declares the connection-level knobs (base url, wire format) on the api lanes", () => {
    for (const id of API_IDS) {
      const fields = PROVIDER_CONNECTION_FIELDS[id];
      expect(fields.map((f) => f.id)).toEqual(["baseUrl", "wireFormat"]);
      expect(fields.find((f) => f.id === "wireFormat").options.map((o) => o.value)).toEqual(["auto", "openai", "claude"]);
    }
  });

  it("only exposes a base url knob on the plan lane (it speaks the Claude wire only)", () => {
    const fields = PROVIDER_CONNECTION_FIELDS["minimax-code"];
    expect(fields.map((f) => f.id)).toEqual(["baseUrl"]);
  });
});
