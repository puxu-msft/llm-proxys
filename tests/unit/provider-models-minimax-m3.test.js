/**
 * Unit tests verifying MiniMax-M3 is registered as a first-class
 * built-in model for both the `minimax` (international) and
 * `minimax-cn` (China) providers, with `targetFormat: "claude"`.
 *
 * Run: cd tests && NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run tests/unit/provider-models-minimax-m3.test.js --reporter=verbose
 */

import { describe, it, expect } from "vitest";
import { PROVIDER_MODELS, getModelsByProviderId } from "../../open-sse/config/providerModels.js";

describe("MiniMax-M3 model registration", () => {
  it("includes MiniMax-M3 in PROVIDER_MODELS.minimax", () => {
    const models = PROVIDER_MODELS.minimax || [];
    const m3 = models.find((m) => m.id === "MiniMax-M3");
    expect(m3).toBeDefined();
    expect(m3).toMatchObject({
      id: "MiniMax-M3",
      name: "MiniMax M3",
      targetFormat: "claude",
    });
  });

  it("includes MiniMax-M3 in PROVIDER_MODELS['minimax-cn']", () => {
    const models = PROVIDER_MODELS["minimax-cn"] || [];
    const m3 = models.find((m) => m.id === "MiniMax-M3");
    expect(m3).toBeDefined();
    expect(m3).toMatchObject({
      id: "MiniMax-M3",
      name: "MiniMax M3",
      targetFormat: "claude",
    });
  });

  it("exposes MiniMax-M3 through getModelsByProviderId for both provider IDs", () => {
    const intlModels = getModelsByProviderId("minimax");
    const cnModels = getModelsByProviderId("minimax-cn");

    expect(intlModels.some((m) => m.id === "MiniMax-M3")).toBe(true);
    expect(cnModels.some((m) => m.id === "MiniMax-M3")).toBe(true);
  });

  it("lists the current language models (M3.1-Flash + M3) on both providers", () => {
    const intlIds = (PROVIDER_MODELS.minimax || []).map((m) => m.id);
    const cnIds = (PROVIDER_MODELS["minimax-cn"] || []).map((m) => m.id);

    for (const id of ["MiniMax-M3.1-Flash", "MiniMax-M3"]) {
      expect(intlIds).toContain(id);
      expect(cnIds).toContain(id);
    }
  });

  it("keeps the retired Preview id resolvable as an alias of M3.1-Flash", () => {
    const intl = (PROVIDER_MODELS.minimax || []).find((m) => m.id === "MiniMax-M3.1-Flash-Preview");
    const cn = (PROVIDER_MODELS["minimax-cn"] || []).find((m) => m.id === "MiniMax-M3.1-Flash-Preview");
    expect(intl?.upstreamModelId).toBe("MiniMax-M3.1-Flash");
    expect(cn?.upstreamModelId).toBe("MiniMax-M3.1-Flash");
  });

  it("no longer lists the legacy M2.x line", () => {
    const intlIds = (PROVIDER_MODELS.minimax || []).map((m) => m.id);
    const cnIds = (PROVIDER_MODELS["minimax-cn"] || []).map((m) => m.id);

    for (const id of ["MiniMax-M2.7", "MiniMax-M2.5", "MiniMax-M2.1"]) {
      expect(intlIds).not.toContain(id);
      expect(cnIds).not.toContain(id);
    }
  });
});
