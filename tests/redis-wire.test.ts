import { afterEach, describe, expect, it, vi } from "vitest";
import { seedIssues } from "@/lib/seed";
import { RedisStore } from "@/lib/store/redis";

/**
 * Fake Upstash REST endpoint behind the real @upstash/redis client. Replies the way Upstash does:
 * raw Redis replies (HGETALL is a flat [field, value, ...] array), bulk strings base64 encoded
 * when the client sends `Upstash-Encoding: base64`, and pipelines as an array of results.
 */
function fakeUpstash(hash: Map<string, string>) {
  const commands: string[] = [];
  const run = ([name, key, ...args]: string[]): { result?: unknown; error?: string } => {
    commands.push(name.toLowerCase());
    if (key !== "tracker:v1:issues") return { error: `ERR unexpected key ${key}` };
    switch (name.toLowerCase()) {
      case "exists":
        return { result: hash.size > 0 ? 1 : 0 };
      case "hgetall":
        return { result: [...hash.entries()].flat() };
      case "hvals":
        return { result: [...hash.values()] };
      case "hget":
        return { result: hash.get(args[0]) ?? null };
      default:
        return { error: `ERR unsupported command ${name}` };
    }
  };
  const encode = (v: unknown): unknown =>
    typeof v === "string" ? Buffer.from(v).toString("base64") : Array.isArray(v) ? v.map(encode) : v;

  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const b64 = new Headers(init?.headers).get("upstash-encoding") === "base64";
    const body = JSON.parse(String(init?.body));
    const reply = (r: { result?: unknown; error?: string }) => (r.error ? r : { result: b64 ? encode(r.result) : r.result });
    const isPipeline = new URL(String(url)).pathname.endsWith("/pipeline");
    const payload = isPipeline ? (body as string[][]).map((c) => reply(run(c))) : reply(run(body));
    const status = !isPipeline && (payload as { error?: string }).error ? 400 : 200;
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, commands };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RedisStore against the Upstash REST wire format", () => {
  const seeded = new Map(seedIssues().map((i) => [i.key, JSON.stringify(i)]));

  it("listIssues parses every issue when Upstash returns raw hash replies", async () => {
    const upstash = fakeUpstash(seeded);
    vi.stubGlobal("fetch", upstash.fetchImpl);
    const store = new RedisStore("https://fake-db.upstash.io", "fake-token-not-real");

    const issues = await store.listIssues();

    expect(issues.map((i) => i.key)).toEqual([...seeded.keys()]);
    expect(issues.find((i) => i.key === "WIT-12")).toMatchObject({ id: "10012", status: "In Review" });
  });

  it("getIssue reads a single issue", async () => {
    vi.stubGlobal("fetch", fakeUpstash(seeded).fetchImpl);
    const store = new RedisStore("https://fake-db.upstash.io", "fake-token-not-real");
    expect(await store.getIssue("WIT-13")).toMatchObject({ key: "WIT-13", status: "Blocked" });
  });
});
