import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT) || 4101;
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const MIN_DELAY = 1;
const MAX_DELAY = 3600;
const FETCH_MS = 8000;
const KEEP_MS = 30 * 60 * 1000;
const jobs = new Map();

const BLOCKED_HOSTS = new Set(["metadata.google.internal", "metadata.internal"]);

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  const type =
    headers["content-type"] ||
    (typeof body === "string" || Buffer.isBuffer(body)
      ? "text/plain; charset=utf-8"
      : "application/json; charset=utf-8");
  res.writeHead(status, {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "cache-control": "no-store",
    "content-type": type,
    ...headers,
  });
  res.end(payload);
}

function jsonError(res, status, error) {
  send(res, status, { error });
}

function readBody(req, limit = 32_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Request too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function originFrom(req) {
  const host = req.headers.host || `${HOST}:${PORT}`;
  const proto = req.headers["x-forwarded-proto"] || "http";
  return `${proto}://${host}`;
}

function ipv4ToInt(address) {
  return address.split(".").reduce((value, part) => (value << 8) + Number(part), 0) >>> 0;
}

function isLoopback(address) {
  if (address.startsWith("::ffff:")) return isLoopback(address.slice(7));
  if (address === "::1") return true;
  return isIP(address) === 4 && address.startsWith("127.");
}

function isBlockedPrivate(address) {
  if (address.startsWith("::ffff:")) return isBlockedPrivate(address.slice(7));
  if (isLoopback(address)) return false;
  if (address.includes(":")) {
    const normalized = address.toLowerCase();
    return normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd");
  }
  if (!isIP(address)) return true;
  const n = ipv4ToInt(address);
  return (
    n >>> 24 === 0 ||
    n >>> 24 === 10 ||
    (n >>> 16 >= ((172 << 8) | 16) && n >>> 16 <= ((172 << 8) | 31)) ||
    n >>> 16 === ((192 << 8) | 168) ||
    n >>> 16 === ((169 << 8) | 254)
  );
}

async function assertCallableUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw Object.assign(new Error("callback_url must be an absolute http(s) URL"), { status: 400 });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw Object.assign(new Error("Only http and https callback URLs are allowed"), { status: 400 });
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".internal")) {
    throw Object.assign(new Error("That host is not allowed"), { status: 400 });
  }
  const resolved = await lookup(url.hostname);
  if (isBlockedPrivate(resolved.address)) {
    throw Object.assign(new Error("That host resolves to a private address"), { status: 400 });
  }
  return url.href;
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    delay_seconds: job.delay_seconds,
    run_at: new Date(job.run_at).toISOString(),
    callback_url: job.callback_url,
    payload: job.payload,
    result: job.result,
    error: job.error,
  };
}

function prune() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.expires_at <= now) {
      clearTimeout(job.timer);
      jobs.delete(id);
    }
  }
}

async function runJob(job) {
  if (job.status !== "scheduled") return;
  if (!job.callback_url) {
    job.status = "ready";
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_MS);
  try {
    const response = await fetch(job.callback_url, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: { "content-type": "application/json", "user-agent": "call-later/1.0" },
      body: JSON.stringify({
        job_id: job.id,
        run_at: new Date(job.run_at).toISOString(),
        payload: job.payload,
      }),
    });
    const text = await response.text();
    job.status = "delivered";
    job.result = {
      status: response.status,
      body: text.slice(0, 4000),
    };
  } catch (error) {
    job.status = "failed";
    job.error = error?.name === "AbortError" ? "Callback timed out" : "Callback failed";
  } finally {
    clearTimeout(timer);
  }
}

async function createJob(input) {
  const delay = Number(input.delay_seconds);
  if (!Number.isInteger(delay) || delay < MIN_DELAY || delay > MAX_DELAY) {
    throw Object.assign(new Error(`delay_seconds must be an integer from ${MIN_DELAY} to ${MAX_DELAY}`), {
      status: 400,
    });
  }
  const payload = input.payload === undefined ? {} : input.payload;
  let callback_url = null;
  if (input.callback_url != null && input.callback_url !== "") {
    if (typeof input.callback_url !== "string") {
      throw Object.assign(new Error("callback_url must be a string"), { status: 400 });
    }
    callback_url = await assertCallableUrl(input.callback_url);
  }
  const id = randomBytes(6).toString("hex");
  const run_at = Date.now() + delay * 1000;
  const job = {
    id,
    status: "scheduled",
    delay_seconds: delay,
    run_at,
    expires_at: run_at + KEEP_MS,
    callback_url,
    payload,
    result: null,
    error: null,
    timer: null,
  };
  job.timer = setTimeout(() => {
    runJob(job).catch(() => {
      job.status = "failed";
      job.error = "Callback failed";
    });
  }, delay * 1000);
  if (typeof job.timer.unref === "function") job.timer.unref();
  jobs.set(id, job);
  return job;
}

function getJob(id) {
  prune();
  const job = jobs.get(id);
  if (!job) throw Object.assign(new Error("Job not found or expired"), { status: 404 });
  return job;
}

function openapi(req) {
  const server = originFrom(req);
  return {
    openapi: "3.1.0",
    info: {
      title: "Call Later",
      version: "1.0.0",
      description: "Hold a payload and either release it later or POST it to a callback URL.",
    },
    servers: [{ url: server }],
    "x-service-info": {
      categories: ["utilities", "scheduling"],
      docs: { homepage: `${server}/`, apiReference: `${server}/openapi.json`, llms: `${server}/llms.txt` },
    },
    paths: {
      "/api/jobs": {
        post: {
          summary: "Schedule a later call",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["delay_seconds"],
                  properties: {
                    delay_seconds: { type: "integer", minimum: MIN_DELAY, maximum: MAX_DELAY },
                    payload: {},
                    callback_url: { type: "string", format: "uri" },
                  },
                },
              },
            },
          },
          responses: { 201: { description: "Job scheduled" } },
        },
      },
      "/api/jobs/{id}": {
        get: {
          summary: "Read job status and result",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Job" } },
        },
      },
    },
  };
}

function llms(req) {
  const server = originFrom(req);
  return `# Call Later

Hold JSON for N seconds. Either read it back when it is due, or have this server POST it to a callback URL.

Agents cannot sit in a request for five minutes. This process can.

This starter does not charge. Wrap POST /api/jobs with MPP before you submit it.

POST ${server}/api/jobs
{ "delay_seconds": 15, "payload": { "check": "invoice-42" } }

GET ${server}/api/jobs/{id}

Optional callback_url receives:
{ "job_id", "run_at", "payload" }

Loopback (127.0.0.1) is allowed so you can fire into a server on this machine. Cloud metadata and LAN ranges are blocked. Delay is 1–3600 seconds.

OpenAPI: ${server}/openapi.json
`;
}

const TYPES = { ".html": "text/html; charset=utf-8" };

async function staticFile(res, pathname) {
  const relative = pathname === "/" ? "public/index.html" : join("public", pathname.slice(1));
  const file = join(ROOT, relative);
  if (!file.startsWith(ROOT)) return false;
  try {
    const body = await readFile(file);
    send(res, 200, body, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      send(res, 204, "");
      return;
    }
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/health") {
      send(res, 200, { ok: true, service: "call-later" });
      return;
    }
    if (url.pathname === "/openapi.json") {
      send(res, 200, openapi(req));
      return;
    }
    if (url.pathname === "/llms.txt") {
      send(res, 200, llms(req), { "content-type": "text/plain; charset=utf-8" });
      return;
    }
    if (url.pathname === "/api/jobs" && req.method === "POST") {
      const raw = await readBody(req);
      const input = raw ? JSON.parse(raw) : {};
      send(res, 201, publicJob(await createJob(input)));
      return;
    }
    const match = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)$/);
    if (match && req.method === "GET") {
      send(res, 200, publicJob(getJob(match[1])));
      return;
    }

    if (req.method === "GET" && (await staticFile(res, url.pathname))) return;
    jsonError(res, 404, "Not found");
  } catch (error) {
    const status = error?.status && Number.isFinite(error.status) ? error.status : 500;
    jsonError(res, status, error instanceof Error ? error.message : "Server error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Call Later  http://${HOST}:${PORT}`);
});
