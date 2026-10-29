// MiniMax 思考深度在两种报文下的形状：
//   OpenAI 兼容接口 → reasoning_effort（low|medium|high|xhigh|max，"none" 会被上游拒）
//   Anthropic 兼容接口 → thinking.adaptive + output_config.effort（M3.1-Flash 收，M3 不收）
import { describe, it, expect } from "vitest";
import "./registerAll.js";

import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";
import { translateRequest } from "../../open-sse/translator/index.js";

const apply = (targetFormat, model, body, provider) => {
  const b = JSON.parse(JSON.stringify(body));
  applyThinking(targetFormat, model, b, provider);
  return b;
};

describe("MiniMax thinking on the OpenAI-compatible wire", () => {
  it("M3.1-Flash sends reasoning_effort", () => {
    const out = apply("openai", "MiniMax-M3.1-Flash", { reasoning_effort: "high" }, "minimax-cn");
    expect(out.reasoning_effort).toBe("high");
  });

  it("M3.1-Flash never asks to stop thinking (upstream rejects none)", () => {
    const out = apply("openai", "MiniMax-M3.1-Flash", { reasoning_effort: "none" }, "minimax-cn");
    expect(out.reasoning_effort).not.toBe("none");
    expect(out.reasoning_effort).toBe("low");
  });

  it("auto leaves the field alone (upstream default is max)", () => {
    const out = apply("openai", "MiniMax-M3.1-Flash", { reasoning_effort: "auto" }, "minimax-cn");
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("M3 can stop thinking", () => {
    const out = apply("openai", "MiniMax-M3", { reasoning_effort: "none" }, "minimax-cn");
    expect(out.thinking).toEqual({ type: "disabled" });
    expect(out.reasoning_effort).toBeUndefined();
  });
});

describe("MiniMax thinking on the Anthropic-compatible wire", () => {
  it("M3.1-Flash uses adaptive thinking plus output_config.effort", () => {
    const out = apply("claude", "MiniMax-M3.1-Flash", { reasoning_effort: "high" }, "minimax-cn");
    expect(out.output_config).toEqual({ effort: "high" });
  });

  it("M3 switches thinking on with adaptive", () => {
    const out = apply("claude", "MiniMax-M3", { reasoning_effort: "high" }, "minimax-cn");
    expect(out.thinking).toEqual({ type: "adaptive" });
  });

  it("M3.1-Flash keeps output_config (the upstream accepts it)", () => {
    const body = prepareClaudeRequest({ model: "MiniMax-M3.1-Flash", output_config: { effort: "high" } }, "minimax-cn");
    expect(body.output_config).toEqual({ effort: "high" });
  });

  it("M3 drops output_config (the upstream rejects it with a 400)", () => {
    const body = prepareClaudeRequest({ model: "MiniMax-M3", output_config: { effort: "high" } }, "minimax-cn");
    expect(body.output_config).toBeUndefined();
  });
});

describe("MiniMax request translation", () => {
  it("keeps the depth knob on the Claude wire end to end", () => {
    const body = {
      model: "MiniMax-M3.1-Flash",
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "xhigh",
    };
    const out = translateRequest("openai", "claude", "MiniMax-M3.1-Flash", body, true, { apiKey: "sk-test" }, "minimax-cn");
    expect(out.output_config).toEqual({ effort: "xhigh" });
  });

  it("keeps the depth knob on the OpenAI wire end to end", () => {
    const body = {
      model: "MiniMax-M3.1-Flash",
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "max",
    };
    const out = translateRequest("openai", "openai", "MiniMax-M3.1-Flash", body, true, { apiKey: "sk-test" }, "minimax-cn");
    expect(out.reasoning_effort).toBe("max");
  });
});
