// Hand-picked API keys: a weak value (e.g. "sk-dummy") may be stored at create
// or edit time. Strength is not enforced — only values that cannot travel as an
// HTTP credential (empty / whitespace) are refused, and duplicates are rejected.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateCustomApiKey } from "@/shared/utils/apiKey";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

async function boot() {
  delete global._dbAdapter;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  const keysRoute = await import("../../src/app/api/keys/route.js");
  const keyIdRoute = await import("../../src/app/api/keys/[id]/route.js");
  return { db, keysRoute, keyIdRoute };
}

const jsonReq = (method, body) =>
  new Request("http://localhost/api/keys", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-custom-key-"));
  process.env.DATA_DIR = tempDir;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("validateCustomApiKey", () => {
  it("accepts short, low-entropy values and trims surrounding space", () => {
    expect(validateCustomApiKey("sk-dummy")).toEqual({ ok: true, value: "sk-dummy" });
    expect(validateCustomApiKey("a")).toEqual({ ok: true, value: "a" });
    expect(validateCustomApiKey("  sk-trim  ")).toEqual({ ok: true, value: "sk-trim" });
  });

  it("rejects values that cannot travel in an HTTP header", () => {
    expect(validateCustomApiKey("")).toMatchObject({ ok: false });
    expect(validateCustomApiKey("   ")).toMatchObject({ ok: false });
    expect(validateCustomApiKey("has space")).toMatchObject({ ok: false });
    expect(validateCustomApiKey("tab\there")).toMatchObject({ ok: false });
    expect(validateCustomApiKey(123)).toMatchObject({ ok: false });
    expect(validateCustomApiKey("x".repeat(257))).toMatchObject({ ok: false });
  });
});

describe("apiKeysRepo with a hand-picked key", () => {
  it("stores it without a machine binding and validates it", async () => {
    const { db } = await boot();
    const created = await db.createApiKey("Internal", "machine-xyz", { key: "sk-dummy" });
    expect(created.key).toBe("sk-dummy");
    expect(created.machineId).toBe(null);
    expect(await db.validateApiKey("sk-dummy")).toBe(true);
    expect((await db.getApiKeyByKey("sk-dummy")).name).toBe("Internal");
  });

  it("still generates a machine-bound key when none is supplied", async () => {
    const { db } = await boot();
    const created = await db.createApiKey("Gen", "machine-xyz");
    expect(created.key.startsWith("sk-machine-xyz-")).toBe(true);
    expect(created.machineId).toBe("machine-xyz");
  });

  it("edits name and key value in place", async () => {
    const { db } = await boot();
    const created = await db.createApiKey("Old", "machine-xyz");
    const updated = await db.updateApiKey(created.id, { name: "New", key: "sk-custom" });
    expect(updated).toMatchObject({ name: "New", key: "sk-custom" });
    expect(await db.validateApiKey("sk-custom")).toBe(true);
    expect(await db.validateApiKey(created.key)).toBe(false);
  });
});

describe("/api/keys route accepts hand-picked keys", () => {
  it("creates a weak custom key and refuses a duplicate value", async () => {
    const { keysRoute } = await boot();
    const res = await keysRoute.POST(jsonReq("POST", { name: "Internal", key: "sk-dummy" }));
    expect(res.status).toBe(201);
    expect((await res.json()).key).toBe("sk-dummy");

    const dup = await keysRoute.POST(jsonReq("POST", { name: "Other", key: "sk-dummy" }));
    expect(dup.status).toBe(409);
  });

  it("refuses a value that cannot be a credential", async () => {
    const { keysRoute } = await boot();
    const res = await keysRoute.POST(jsonReq("POST", { name: "Bad", key: "has space" }));
    expect(res.status).toBe(400);
  });

  it("edits name and key via PUT, and refuses a clash with another key", async () => {
    const { db, keyIdRoute } = await boot();
    const a = await db.createApiKey("A", "m");
    const b = await db.createApiKey("B", "m");

    const ok = await keyIdRoute.PUT(
      jsonReq("PUT", { name: "A2", key: "sk-edit" }),
      { params: Promise.resolve({ id: a.id }) },
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).key).toMatchObject({ name: "A2", key: "sk-edit" });

    const clash = await keyIdRoute.PUT(
      jsonReq("PUT", { key: b.key }),
      { params: Promise.resolve({ id: a.id }) },
    );
    expect(clash.status).toBe(409);
  });
});
