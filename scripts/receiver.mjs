// Local stand-in for the agent's webhook endpoint. Captures every request.
//   POST /jira/events      captured; answers 202 (or a forced failure status)
//   GET  /__requests       everything captured so far
//   POST /__control        {"fail": 2, "status": 503} makes the next 2 webhooks fail
//   POST /__reset          clears captures and forced failures
// Usage: RECEIVER_PORT=4123 node scripts/receiver.mjs
import http from "node:http";

const port = Number(process.env.RECEIVER_PORT ?? 4123);
let captured = [];
let failNext = 0;
let failStatus = 503;

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();

    if (req.url === "/__requests") return json(res, 200, captured);
    if (req.url === "/__reset") {
      captured = [];
      failNext = 0;
      return json(res, 200, { ok: true });
    }
    if (req.url === "/__control") {
      const body = JSON.parse(raw || "{}");
      failNext = body.fail ?? 0;
      failStatus = body.status ?? 503;
      return json(res, 200, { ok: true, failNext, failStatus });
    }

    const status = failNext > 0 ? (failNext--, failStatus) : 202;
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {}
    captured.push({ at: new Date().toISOString(), method: req.method, path: req.url, headers: req.headers, body, respondedWith: status });
    json(res, status, status === 202 ? { accepted: true } : { error: "forced failure" });
  })
  .listen(port, "127.0.0.1", () => console.log(`receiver on :${port}`));
