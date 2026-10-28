// Minimal Upstash Redis REST API in front of a local redis-server, so the real
// @upstash/redis client and RedisStore can be exercised without cloud credentials.
// Usage: REDIS_URL=redis://127.0.0.1:6390 SHIM_PORT=8079 SHIM_TOKEN=x node scripts/upstash-rest-shim.mjs
//
// Talks raw RESP to Redis on purpose. Upstash relays Redis replies unchanged (HGETALL is a flat
// [field, value, ...] array), and client libraries such as ioredis reshape some replies, which
// would hide bugs that only show up against real Upstash.
import http from "node:http";
import net from "node:net";

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
const port = Number(process.env.SHIM_PORT ?? 8079);
const token = process.env.SHIM_TOKEN ?? "";

class SimpleString {
  constructor(value) {
    this.value = value;
  }
}
class ReplyError {
  constructor(message) {
    this.message = message;
  }
}

/** Parses one RESP2 reply at `i`. Returns [value, nextOffset], or null if the buffer is incomplete. */
function parse(buf, i) {
  const end = buf.indexOf("\r\n", i);
  if (end < 0) return null;
  const type = String.fromCharCode(buf[i]);
  const line = buf.toString("utf8", i + 1, end);
  const next = end + 2;
  switch (type) {
    case "+":
      return [new SimpleString(line), next];
    case "-":
      return [new ReplyError(line), next];
    case ":":
      return [Number(line), next];
    case "$": {
      const n = Number(line);
      if (n < 0) return [null, next];
      if (buf.length < next + n + 2) return null;
      return [buf.toString("utf8", next, next + n), next + n + 2];
    }
    case "*": {
      const n = Number(line);
      if (n < 0) return [null, next];
      const items = [];
      let at = next;
      for (let k = 0; k < n; k++) {
        const r = parse(buf, at);
        if (!r) return null;
        items.push(r[0]);
        at = r[1];
      }
      return [items, at];
    }
    default:
      throw new Error(`unexpected RESP type ${type}`);
  }
}

const socket = net.connect(Number(redisUrl.port || 6379), redisUrl.hostname);
const waiting = [];
let pending = Buffer.alloc(0);
socket.on("data", (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  for (let r = parse(pending, 0); r; r = pending.length ? parse(pending, 0) : null) {
    pending = pending.subarray(r[1]);
    waiting.shift()(r[0]);
  }
});

function send(args) {
  const parts = [Buffer.from(`*${args.length}\r\n`)];
  for (const a of args) {
    const b = Buffer.from(String(a));
    parts.push(Buffer.from(`$${b.length}\r\n`), b, Buffer.from("\r\n"));
  }
  return new Promise((resolve) => {
    waiting.push(resolve);
    socket.write(Buffer.concat(parts));
  });
}

// Upstash JSON: bulk strings (base64 when asked), simple strings as-is, integers, nulls, arrays.
const toJson = (v, b64) => {
  if (v instanceof SimpleString) return v.value;
  if (typeof v === "string") return b64 ? Buffer.from(v).toString("base64") : v;
  if (Array.isArray(v)) return v.map((x) => toJson(x, b64));
  return v;
};

async function run(cmd, b64) {
  const reply = await send(cmd);
  return reply instanceof ReplyError ? { error: reply.message } : { result: toJson(reply, b64) };
}

http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const reply = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${token}`) return reply(401, { error: "unauthorized" });
    const b64 = req.headers["upstash-encoding"] === "base64";
    const body = JSON.parse(Buffer.concat(chunks).toString() || "null");
    if (req.url === "/pipeline" || req.url === "/multi-exec") {
      const out = [];
      for (const cmd of body) out.push(await run(cmd, b64));
      return reply(200, out);
    }
    const out = await run(body, b64);
    reply(out.error ? 400 : 200, out);
  })
  .listen(port, "127.0.0.1", () => console.log(`upstash shim on :${port}`));
