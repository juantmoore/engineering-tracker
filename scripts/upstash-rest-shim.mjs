// Minimal Upstash Redis REST API in front of a local redis-server, so the real
// @upstash/redis client and RedisStore can be exercised without cloud credentials.
// Usage: REDIS_URL=redis://127.0.0.1:6390 SHIM_PORT=8079 SHIM_TOKEN=x node scripts/upstash-rest-shim.mjs
import http from "node:http";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
const port = Number(process.env.SHIM_PORT ?? 8079);
const token = process.env.SHIM_TOKEN ?? "";

const encode = (v, b64) => {
  if (!b64) return v;
  if (typeof v === "string") return v === "OK" ? v : Buffer.from(v).toString("base64");
  if (Array.isArray(v)) return v.map((x) => encode(x, b64));
  return v;
};

async function run(cmd, b64) {
  try {
    const [name, ...args] = cmd.map(String);
    return { result: encode(await redis.call(name, ...args), b64) };
  } catch (e) {
    return { error: String(e.message ?? e) };
  }
}

http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: "unauthorized" });
    const b64 = req.headers["upstash-encoding"] === "base64";
    const body = JSON.parse(Buffer.concat(chunks).toString() || "null");
    if (req.url === "/pipeline" || req.url === "/multi-exec") {
      const out = [];
      for (const cmd of body) out.push(await run(cmd, b64));
      return send(200, out);
    }
    const out = await run(body, b64);
    send(out.error ? 400 : 200, out);
  })
  .listen(port, "127.0.0.1", () => console.log(`upstash shim on :${port}`));
