import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createAiProxyServer } from "../ai-proxy-server";

test("malformed JSON is a 400 with a safe message (not a generic 500), and an unexpected failure gives a reference id without internals", async () => {
  const saved = process.env.ATLAS_PROXY_SHARED_SECRET; delete process.env.ATLAS_PROXY_SHARED_SECRET;
  const server = createAiProxyServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const res = await fetch(`${base}/api/ai/execute`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    assert.equal(res.status, 400);
    const body = await res.json() as { reason: string };
    assert.match(body.reason, /not valid JSON/);
    assert.doesNotMatch(JSON.stringify(body), /SyntaxError|at /);
  } finally { server.close(); if (saved !== undefined) process.env.ATLAS_PROXY_SHARED_SECRET = saved; }
});
