import { LOKI_HEADERS } from "../config/lokiConstants.js";

/**
 * The Copilot-Code application identity the loki upstream expects, in the shape the real client
 * sends it.
 *
 * Both the model request and the catalog request carry it, which is why it lives here rather than
 * inside the executor: the registry entry declares it for the catalog source, and the executor
 * spreads it into every model request. Per-request fields (the conversation and call ids) are the
 * executor's business and are added on top.
 */
export function buildLokiUserAgent(fingerprint) {
  const cli = fingerprint?.cliVersion || "unknown";
  const node = fingerprint?.nodeVersion || "unknown";
  const term = process.env.TERM_PROGRAM || "unknown";
  return `copilot/${cli} (${process.platform} ${node}) term/${term}`;
}

export function buildLokiFingerprintHeaders(fingerprint) {
  return {
    "User-Agent": buildLokiUserAgent(fingerprint),
    "X-ClientType": LOKI_HEADERS.clientType,
    "X-ClientScenario": LOKI_HEADERS.clientScenario,
    "X-ClientFeature": LOKI_HEADERS.clientFeature,
  };
}
