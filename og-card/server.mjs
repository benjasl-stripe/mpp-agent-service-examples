import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT) || 4103;
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = fileURLToPath(new URL(".", import.meta.url));

const THEMES = {
  ink: { bg: "#060606", fg: "#ebebeb", dim: "#757575", accent: "#98f3aa", line: "#ebebeb33" },
  paper: { bg: "#f4f1ea", fg: "#1a1916", dim: "#6b665c", accent: "#c45c26", line: "#1a191622" },
  signal: { bg: "#0b1020", fg: "#e8eeff", dim: "#8b95b7", accent: "#9e94ff", line: "#e8eeff33" },
};

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

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrap(text, width) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function cardSvg({ title, subtitle, tag, theme }) {
  const colors = THEMES[theme] || THEMES.ink;
  const titleLines = wrap(title, 22);
  const subtitleLines = wrap(subtitle, 42);
  const titleTs = titleLines
    .map((line, index) => `<tspan x="80" dy="${index === 0 ? 0 : 70}">${escapeXml(line)}</tspan>`)
    .join("");
  const subtitleTs = subtitleLines
    .map((line, index) => `<tspan x="80" dy="${index === 0 ? 0 : 36}">${escapeXml(line)}</tspan>`)
    .join("");
  const subtitleY = 200 + titleLines.length * 70;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${colors.bg}"/>
  <rect x="32" y="32" width="1136" height="566" fill="none" stroke="${colors.line}" stroke-width="2"/>
  <text x="80" y="92" fill="${colors.accent}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="22" letter-spacing="2">${escapeXml(tag.toUpperCase())}</text>
  <text x="80" y="200" fill="${colors.fg}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="64" font-weight="500">${titleTs}</text>
  <text x="80" y="${subtitleY}" fill="${colors.dim}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="28">${subtitleTs}</text>
  <text x="80" y="560" fill="${colors.dim}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18">1200 × 630 · OG card</text>
</svg>
`;
}

function parseInput(url, body) {
  const fromQuery = {
    title: url.searchParams.get("title") || "",
    subtitle: url.searchParams.get("subtitle") || "",
    tag: url.searchParams.get("tag") || "agent",
    theme: url.searchParams.get("theme") || "ink",
  };
  let payload = {};
  if (body) {
    try {
      payload = JSON.parse(body);
    } catch {
      throw Object.assign(new Error("Body must be JSON"), { status: 400 });
    }
  }
  const title = String(payload.title ?? fromQuery.title).trim();
  const subtitle = String(payload.subtitle ?? fromQuery.subtitle).trim();
  const tag = String(payload.tag ?? fromQuery.tag).trim() || "agent";
  const theme = String(payload.theme ?? fromQuery.theme).trim() || "ink";
  if (!title) throw Object.assign(new Error("title is required"), { status: 400 });
  if (title.length > 120) throw Object.assign(new Error("title is too long"), { status: 400 });
  if (subtitle.length > 200) throw Object.assign(new Error("subtitle is too long"), { status: 400 });
  if (tag.length > 32) throw Object.assign(new Error("tag is too long"), { status: 400 });
  if (!THEMES[theme]) {
    throw Object.assign(new Error(`theme must be ${Object.keys(THEMES).join(", ")}`), { status: 400 });
  }
  return { title, subtitle, tag, theme };
}

function originFrom(req) {
  const host = req.headers.host || `${HOST}:${PORT}`;
  const proto = req.headers["x-forwarded-proto"] || "http";
  return `${proto}://${host}`;
}

function openapi(req) {
  const server = originFrom(req);
  return {
    openapi: "3.1.0",
    info: {
      title: "OG Card",
      version: "1.0.0",
      description: "Generate a 1200×630 SVG share card from a title, subtitle, and tag.",
    },
    servers: [{ url: server }],
    "x-service-info": {
      categories: ["media", "utilities"],
      docs: { homepage: `${server}/`, apiReference: `${server}/openapi.json`, llms: `${server}/llms.txt` },
    },
    paths: {
      "/api/card": {
        post: {
          summary: "Render a share card",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["title"],
                  properties: {
                    title: { type: "string" },
                    subtitle: { type: "string" },
                    tag: { type: "string" },
                    theme: { type: "string", enum: Object.keys(THEMES) },
                  },
                },
              },
            },
          },
          responses: { 200: { description: "image/svg+xml" } },
        },
        get: {
          summary: "Render a share card",
          parameters: [
            { name: "title", in: "query", required: true, schema: { type: "string" } },
            { name: "subtitle", in: "query", schema: { type: "string" } },
            { name: "tag", in: "query", schema: { type: "string" } },
            { name: "theme", in: "query", schema: { type: "string", enum: Object.keys(THEMES) } },
          ],
          responses: { 200: { description: "image/svg+xml" } },
        },
      },
    },
  };
}

function llms(req) {
  const server = originFrom(req);
  return `# OG Card

Generate a 1200×630 SVG Open Graph card from title, subtitle, tag, and theme (ink, paper, signal).

This starter does not charge. Wrap GET/POST /api/card with MPP before you submit it.

POST ${server}/api/card
Content-Type: application/json

{ "title": "Ship a paid API", "subtitle": "Agents pay over HTTP 402", "tag": "hackathon", "theme": "ink" }

GET ${server}/api/card?title=Ship%20a%20paid%20API&theme=signal

OpenAPI: ${server}/openapi.json
`;
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
};

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
      send(res, 200, { ok: true, service: "og-card" });
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
    if (url.pathname === "/api/card") {
      const raw = req.method === "POST" ? await readBody(req) : "";
      if (req.method !== "GET" && req.method !== "POST") {
        jsonError(res, 405, "Use GET or POST");
        return;
      }
      const svg = cardSvg(parseInput(url, raw));
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
  console.log(`OG Card  http://${HOST}:${PORT}`);
});
