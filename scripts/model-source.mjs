#!/usr/bin/env node
/**
 * Read a provider's declared model catalogue and compare it with the static list in its registry
 * entry.
 *
 * This is a reference tool, not a runtime path: the static `models[]` stays authoritative, and this
 * only tells you what the upstream offers right now so that list can be updated deliberately.
 * A declaration is `modelSource` on a registry entry (see open-sse/services/modelCatalogSource.js).
 *
 * usage:
 *   node scripts/model-source.mjs --list
 *   node scripts/model-source.mjs <provider> [--connection <connectionId>] [--json] [--limit <n>]
 *
 * Every import here is relative on purpose: the app's `@/` and `open-sse/` aliases do not resolve
 * under a plain `node`, and the existing scripts follow the same rule.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import REGISTRY from "../open-sse/providers/registry/index.js";
import {
  diffModelSource,
  findModelSource,
  listModelSources,
  resolveModelSource,
} from "../open-sse/services/modelCatalogSource.js";

function parseArgs(argv) {
  const options = { provider: null, connection: null, json: false, limit: null, list: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--list") options.list = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--connection") options.connection = argv[++i] ?? null;
    else if (arg === "--limit") options.limit = Number.parseInt(argv[++i] ?? "", 10);
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else options.provider = arg;
  }
  return options;
}

/**
 * One connection row, straight from SQLite.
 *
 * The app's own db layer resolves its imports through the `@/` alias, which this script cannot use
 * (see the header). A single-row read is not worth adding an alias loader for, so the query lives
 * here — with the caveat that it must track `providerConnections` in src/lib/db/schema.js.
 */
async function readConnection(id) {
  const dataDir = process.env.DATA_DIR || join(homedir(), ".9router");
  const file = join(dataDir, "db", "data.sqlite");
  if (!existsSync(file)) {
    throw new Error(`No database at ${file}. Run 9router once, or pass no --connection for a source that needs none.`);
  }
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare("SELECT id, provider, authType, data FROM providerConnections WHERE id = ?").get(id);
    if (!row) throw new Error(`No connection ${id} in ${file}.`);
    // `data` is a JSON blob that already holds providerSpecificData, accessToken and friends.
    return { id: row.id, provider: row.provider, authType: row.authType, ...JSON.parse(row.data) };
  } finally {
    db.close();
  }
}

function printDiff(providerId, models, entries) {
  const { added, missing } = diffModelSource(models, entries);
  const lines = [];

  if (added.length) {
    lines.push(`+ ${added.length} in the catalogue but not declared — candidates for registry/${providerId}.js models[]:`);
    for (const entry of added) {
      const upstream = entry.upstreamModelId && entry.upstreamModelId !== entry.id ? `  → upstream ${entry.upstreamModelId}` : "";
      const endpoints = entry.endpoints?.length ? `  [${entry.endpoints.join(", ")}]` : "";
      lines.push(`    ${entry.id}${upstream}  (${entry.name})${endpoints}`);
    }
  }
  if (missing.length) {
    // A non-LLM entry being absent usually says nothing: these catalogues are chat catalogues, and
    // the registry also declares the provider's embedding/tts/image/video models. Say which is which
    // rather than presenting 18 harmless absences as 18 problems.
    const media = missing.filter((model) => (model.kind || model.type) && (model.kind || model.type) !== "llm");
    const chat = missing.filter((model) => !media.includes(model));
    if (chat.length) {
      lines.push(`- ${chat.length} declared but absent upstream — review or drop:`);
      for (const model of chat) lines.push(`    ${model.id}`);
    }
    if (media.length) {
      lines.push(`- ${media.length} declared media models absent from this chat catalogue (expected unless the catalogue serves them):`);
      for (const model of media) lines.push(`    ${model.id}  [${model.kind || model.type}]`);
    }
  }
  if (!added.length && !missing.length) lines.push("= the declared list matches the catalogue exactly.");
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.list) {
    const ids = listModelSources();
    console.log(ids.length ? ids.join("\n") : "(no provider declares a modelSource)");
    return;
  }
  if (!options.provider) {
    console.log("usage: node scripts/model-source.mjs <provider> [--connection <id>] [--json] [--limit <n>]\n       node scripts/model-source.mjs --list");
    process.exitCode = 2;
    return;
  }

  const found = findModelSource(options.provider);
  if (!found) {
    console.log(`${options.provider} declares no modelSource. Declared: ${listModelSources().join(", ") || "(none)"}`);
    process.exitCode = 1;
    return;
  }

  const credentials = options.connection ? await readConnection(options.connection) : null;
  let result;
  try {
    result = await resolveModelSource(options.provider, { credentials, log: null });
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const entries = Number.isFinite(options.limit) ? result.entries.slice(0, options.limit) : result.entries;
  const models = found.entry.models || [];
  const { added, missing } = diffModelSource(models, entries);

  if (options.json) {
    console.log(JSON.stringify({ provider: result.provider, url: result.url, format: result.format, declared: models.length, entries, added, missing }, null, 2));
    return;
  }

  console.log(`${options.provider} — ${result.url}`);
  console.log(`  format ${result.format}, auth ${found.entry.modelSource.auth || "none"}${credentials ? ` (connection ${credentials.id})` : ""}`);
  console.log(`  catalogue ${result.entries.length} models, declared ${models.length}`);
  console.log("");
  console.log(printDiff(options.provider, models, entries));
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exitCode = 1;
});
