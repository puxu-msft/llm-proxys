import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { openaiToOpenAIResponsesRequest } from "../translator/request/openai-responses.js";
import { openaiResponsesToOpenAIResponse } from "../translator/response/openai-responses.js";
import { initState, translateRequest, translateResponse } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { parseSSELine, formatSSE } from "../utils/streamHelpers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { SSE_DONE } from "../utils/sseConstants.js";
import { ANTHROPIC_API_VERSION } from "../providers/shared.js";
import { buildLokiFingerprintHeaders } from "../shared/lokiHeaders.js";
import crypto from "crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function newUuid() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Keep the client-facing model name on a chunk.
 *
 * The Claude→OpenAI translator takes the model name from the upstream's own `message_start` once
 * it sees one, so without this the upstream id (`claude-sonnet-5.5`) would leak back to a client
 * that asked for an alias (`claude-sonnet-5-5`). Restoring it here is provider-local on purpose:
 * doing it for every provider is a broader change (it alters what every response reports) and is
 * tracked separately.
 */
function withClientModel(chunk, model) {
  return chunk && chunk.model !== undefined ? { ...chunk, model } : chunk;
}

/**
 * Executor for the loki provider: a first-party model service with one endpoint per wire format.
 *
 * Like GithubExecutor, it does not send an OpenAI-shaped request to a single endpoint. Claude
 * models go to the Anthropic Messages endpoint, everything else to the Responses endpoint, and
 * the choice is made by model NAME rather than a registry targetFormat — a static per-model field
 * would miss models the live catalogue adds later and would double-translate the ones it lists.
 *
 * Both lanes force stream:true upstream and re-emit OpenAI SSE for chatCore to translate onward,
 * which is why the registry entry sets `forceStream`.
 *
 * Neither lane calls super.execute(), so the wam credential is resolved here explicitly.
 * (resolveExternalCredentials is idempotent, so a lane that did call it would be safe too.)
 */
export class LokiExecutor extends BaseExecutor {
  constructor(providerId = "loki") {
    super(providerId, PROVIDERS[providerId]);
  }

  isClaudeModel(model) {
    return /claude/i.test(model || "");
  }

  buildHeaders(credentials, stream = true, url, model) {
    const headers = {
      // The application identity, shared with the catalog source declaration.
      ...buildLokiFingerprintHeaders(this.config?.fingerprint),
      Authorization: `Bearer ${credentials.accessToken}`,
      "Content-Type": "application/json",
      Accept: stream ? "text/event-stream" : "application/json",
      // Stays the same across the retries of one request; the upstream uses it to group them.
      "X-ConversationId": credentials.__lokiConversationId || newUuid(),
      // A fresh id per send, including each retry, exactly as the real client does.
      "X-ClientCallId": newUuid(),
    };
    // Required by the Messages wire; harmless on Responses.
    if (this.isClaudeModel(model)) headers["anthropic-version"] = ANTHROPIC_API_VERSION;
    return headers;
  }

  async execute(options) {
    const { model, credentials, log, proxyOptions = null, providerSessionId } = options;

    // The token comes from wam-proxy and is not stored on the connection, so it is fetched on the
    // request path. Failures throw, and chatCore reports them as a 502.
    await this.resolveExternalCredentials(credentials, { log, proxyOptions });

    // One conversation id for the whole request — retries included. chatCore's session seed is
    // used when it is a real UUID, which is what makes the upstream group a session's requests;
    // anything else would be rejected, so a fresh UUID stands in.
    if (!UUID_PATTERN.test(String(credentials.__lokiConversationId || ""))) {
      credentials.__lokiConversationId = UUID_PATTERN.test(String(providerSessionId || ""))
        ? providerSessionId
        : newUuid();
    }

    if (this.isClaudeModel(model)) {
      log?.debug?.("LOKI", `Using the messages lane for ${model}`);
      return this.executeWithMessagesEndpoint(options);
    }
    log?.debug?.("LOKI", `Using the responses lane for ${model}`);
    return this.executeWithResponsesEndpoint(options);
  }

  async executeWithResponsesEndpoint({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const url = this.config.responsesUrl;
    const headers = this.buildHeaders(credentials, stream, url, model);
    // chatCore already resolved the client's model id to the upstream one and wrote it onto the
    // body; the local `model` is still the id the client asked for.
    const upstreamModel = body?.model || model;

    const transformedBody = openaiToOpenAIResponsesRequest(upstreamModel, body, stream, credentials);
    transformedBody.model = upstreamModel;

    log?.debug?.("LOKI", "Sending translated request to the responses endpoint");

    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal,
    }, proxyOptions);

    if (!response.ok) return { response, url, headers, transformedBody };

    const state = initState(FORMATS.OPENAI_RESPONSES);
    state.model = model;

    const decoder = new TextDecoder();
    let buffer = "";

    const transformStream = new TransformStream({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const parsed = parseSSELine(trimmed);
          if (!parsed) continue;

          if (parsed.done && stream === true) {
            controller.enqueue(new TextEncoder().encode(SSE_DONE));
            continue;
          }
          const converted = openaiResponsesToOpenAIResponse(parsed, state);
          if (converted) controller.enqueue(new TextEncoder().encode(formatSSE(withClientModel(converted, model), "openai")));
        }
      },
      flush(controller) {
        if (!buffer.trim()) return;
        const parsed = parseSSELine(buffer.trim());
        if (parsed && !parsed.done) {
          const converted = openaiResponsesToOpenAIResponse(parsed, state);
          if (converted) controller.enqueue(new TextEncoder().encode(formatSSE(withClientModel(converted, model), "openai")));
        }
      },
    });

    return wrapStream(response, transformStream, url, headers, transformedBody);
  }

  async executeWithMessagesEndpoint({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const url = this.config.messagesUrl;
    const headers = this.buildHeaders(credentials, stream, url, model);
    const upstreamModel = body?.model || model;

    // Force stream:true upstream regardless of what the client asked for: the non-streaming
    // handler buffers SSE into one JSON reply, and the fetch path never has to guess.
    const transformedBody = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, upstreamModel, body, true, credentials, "loki");
    // The wire model must be the upstream id, not the id the client used.
    transformedBody.model = upstreamModel;
    // Internal bookkeeping from the translator. chatCore normally lifts it into the response
    // state to restore original tool names; here that is this executor's job, and leaving it in
    // the body would be rejected by the upstream's strict schema.
    const toolNameMap = transformedBody._toolNameMap;
    delete transformedBody._toolNameMap;

    log?.debug?.("LOKI", "Sending translated request to the messages endpoint");

    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal,
    }, proxyOptions);

    if (!response.ok) return { response, url, headers, transformedBody };

    const state = initState(FORMATS.CLAUDE);
    state.model = model;
    if (toolNameMap) state.toolNameMap = toolNameMap;

    const decoder = new TextDecoder();
    let buffer = "";

    const emitAll = (controller, chunks) => {
      for (const raw of chunks) {
        controller.enqueue(new TextEncoder().encode(formatSSE(withClientModel(raw, model), "openai")));
      }
    };

    const transformStream = new TransformStream({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const parsed = parseSSELine(trimmed);
          if (!parsed) continue;

          if (parsed.done && stream === true) {
            controller.enqueue(new TextEncoder().encode(SSE_DONE));
            continue;
          }
          emitAll(controller, translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI, parsed, state));
        }
      },
      flush(controller) {
        if (!buffer.trim()) return;
        const parsed = parseSSELine(buffer.trim());
        if (parsed && !parsed.done) {
          emitAll(controller, translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI, parsed, state));
        }
      },
    });

    return wrapStream(response, transformStream, url, headers, transformedBody);
  }
}

/** Share the "no body" and header-copy handling between the two lanes. */
function wrapStream(response, transformStream, url, headers, transformedBody) {
  if (!response.body) {
    return {
      response: new Response("", { status: response.status, headers: response.headers }),
      url,
      headers,
      transformedBody,
    };
  }
  const convertedStream = response.body.pipeThrough(transformStream);
  return {
    response: new Response(convertedStream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
    url,
    headers,
    transformedBody,
  };
}

export const __test__ = { UUID_PATTERN, newUuid };

export default LokiExecutor;
