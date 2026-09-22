import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const PORT = Number(process.env.PORT) || 4102;
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const MAX_TEXT = 800;

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

function readBody(req, limit = 16_000) {
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

function parseInput(url, body) {
  let payload = {};
  if (body) {
    try {
      payload = JSON.parse(body);
    } catch {
      throw Object.assign(new Error("Body must be JSON"), { status: 400 });
    }
  }
  const text = String(payload.text ?? url.searchParams.get("text") ?? "").trim();
  if (!text) throw Object.assign(new Error("text is required"), { status: 400 });
  if (text.length > MAX_TEXT) {
    throw Object.assign(new Error(`text must be ${MAX_TEXT} characters or fewer`), { status: 400 });
  }
  return text;
}

async function renderQr(text) {
  return QRCode.toString(text, {
    type: "svg",
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#ebebeb", light: "#060606" },
  });
}

function openapi(req) {
  const server = originFrom(req);
  return {
    openapi: "3.1.0",
    info: {
      title: "QR Code",
      version: "1.0.0",
      description: "Encode text into a scannable QR SVG. Models draw QR-looking pictures that do not scan.",
    },
    servers: [{ url: server }],
    "x-service-info": {
      categories: ["media", "utilities"],
      docs: { homepage: `${server}/`, apiReference: `${server}/openapi.json`, llms: `${server}/llms.txt` },
    },
    paths: {
      "/api/qr": {
        post: {
          summary: "Encode text as a QR code",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["text"],
                  properties: { text: { type: "string", maxLength: MAX_TEXT } },
                },
              },
            },
          },
          responses: { 200: { description: "image/svg+xml" } },
        },
        get: {
          summary: "Encode text as a QR code",
          parameters: [
            { name: "text", in: "query", required: true, schema: { type: "string", maxLength: MAX_TEXT } },
          ],
          responses: { 200: { description: "image/svg+xml" } },
        },
      },
    },
  };
}

function llms(req) {
  const server = originFrom(req);
  return `# QR Code

Encode a string into a real QR code (Reed-Solomon), returned as SVG. Phone cameras scan it. Model-drawn QR images usually do not.

POST ${server}/api/qr
{ "text": "WIFI:T:WPA;S:Office;P:hunter2;;" }

GET ${server}/api/qr?text=https://mpp.dev/

Max ${MAX_TEXT} characters. This starter does not charge. Wrap /api/qr with MPP before you submit it.

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
      send(res, 200, { ok: true, service: "qr-code" });
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
    if (url.pathname === "/api/qr") {
      const raw = req.method === "POST" ? await readBody(req) : "";
      if (req.method !== "GET" && req.method !== "POST") {
        jsonError(res, 405, "Use GET or POST");
        return;
      }
      const svg = await renderQr(parseInput(url, raw));
      send(res, 200, svg, { "content-type": "image/svg+xml; charset=utf-8" });
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
  console.log(`QR Code  http://${HOST}:${PORT}`);
});
