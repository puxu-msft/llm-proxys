import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import { getExecutor } from "../../open-sse/executors/index.js";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";

/**
 * Live check of the loki provider's real request path.
 *
 * Skipped unless a wam-proxy client is configured, in the same spirit as the other `*.real.test.js`
 * files: it makes live model calls, so it must never be part of a plain checkout's green build.
 *
 *   WAM_CLIENT_ID=client-… WAM_CLIENT_SECRET=… npx vitest run unit/loki-live.real.test.js
 *
 * Two lanes, because they are different code paths and only one of them is the one Claude Code
 * uses: a dash alias (Claude Code's spelling) through the Messages wire, and a catalogue id through
 * the Responses wire.
 */
const ENDPOINT = process.env.WAM_TOKEN_ENDPOINT || "http://127.0.0.1:8317/token";
const CLIENT_ID = process.env.WAM_CLIENT_ID;
const CLIENT_SECRET = process.env.WAM_CLIENT_SECRET;
// The reference deployment's resource; override for another service.
const SCOPE = process.env.WAM_SCOPE || "42c8f7bd-c7a8-4ba9-bc1c-91edfb716247/.default";

const configured = Boolean(CLIENT_ID && CLIENT_SECRET);

function credentials() {
  return {
    authType: "wam",
    providerSpecificData: {
      wamTokenEndpoint: ENDPOINT,
      wamClientId: CLIENT_ID,
      wamClientSecret: CLIENT_SECRET,
      wamScope: SCOPE,
    },
  };
}

/** Run one turn and return the re-emitted OpenAI SSE, assembled. */
async function callModel(clientModel) {
  const upstreamModel = getModelUpstreamId("lk", clientModel);
  const result = await getExecutor("loki").execute({
    model: clientModel,
    body: {
      model: upstreamModel,
      messages: [{ role: "user", content: "Reply with the single word OK and nothing else." }],
      max_tokens: 64,
      stream: true,
    },
    stream: true,
    credentials: credentials(),
    providerSessionId: crypto.randomUUID(),
    log: null,
  });

  if (!result.response.ok) {
    return { ok: false, status: result.response.status, body: (await result.response.text()).slice(0, 300) };
  }

  const raw = await result.response.text();
  const chunks = raw.split("\n").filter((line) => line.startsWith("data:") && !line.includes("[DONE]"));
  let text = "";
  let echoedModel;
  for (const line of chunks) {
    try {
      const json = JSON.parse(line.slice(5).trim());
      if (json.model) echoedModel = json.model;
      text += json.choices?.[0]?.delta?.content ?? "";
    } catch {
      // A line the translator deliberately skipped.
    }
  }
  return { ok: true, status: result.response.status, upstreamModel, echoedModel, text: text.trim(), chunks: chunks.length };
}

describe.skipIf(!configured)("loki provider — live upstream", () => {
  it("answers a Claude model through the messages lane, keeping the client-facing name", async () => {
    const result = await callModel("claude-sonnet-5-5");
    expect(result.ok, `upstream said ${result.status}: ${result.body}`).toBe(true);
    // The dash alias is what the client asked for; the wire carried the dotted upstream id.
    expect(result.upstreamModel).toBe("claude-sonnet-5.5");
    expect(result.chunks).toBeGreaterThan(0);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.echoedModel).toBe("claude-sonnet-5-5");
  }, 120_000);

  it("answers a catalogue model through the responses lane", async () => {
    const result = await callModel("gpt-6-sol");
    expect(result.ok, `upstream said ${result.status}: ${result.body}`).toBe(true);
    expect(result.upstreamModel).toBe("gpt-6-sol");
    expect(result.chunks).toBeGreaterThan(0);
    expect(result.text.length).toBeGreaterThan(0);
  }, 120_000);
});
