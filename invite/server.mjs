import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT) || 4101;
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const MIN_MINUTES = 5;
const MAX_MINUTES = 1440;
const HAS_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/i;
const NAIVE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

function bad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function pad(value) {
  return String(value).padStart(2, "0");
}

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

function zoneParts(date, timeZone) {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const map = {};
  for (const part of formatted) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  // Some engines label midnight as hour 24 on that same calendar day.
  const hour = map.hour === "24" ? 0 : Number(map.hour);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function zoneOffsetMs(date, timeZone) {
  const parts = zoneParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function assertRealDate(year, month, day, hour, minute, second) {
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    throw bad("start is not a real date");
  }
}

function zonedWallToUtc(year, month, day, hour, minute, second, timeZone) {
  assertRealDate(year, month, day, hour, minute, second);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let utc = wallAsUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    utc = wallAsUtc - zoneOffsetMs(new Date(utc), timeZone);
  }
  const back = zoneParts(new Date(utc), timeZone);
  const matches =
    back.year === year &&
    back.month === month &&
    back.day === day &&
    back.hour === hour &&
    back.minute === minute &&
    back.second === second;
  if (!matches) {
    throw bad(`${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)} does not exist in ${timeZone}`);
  }
  return new Date(utc);
}

function assertZone(timeZone) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw bad("timezone must be an IANA name such as Europe/London");
  }
}

function parseStart(start, timeZone) {
  const value = String(start ?? "").trim();
  if (!value) throw bad("start is required");
  if (HAS_OFFSET.test(value)) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw bad("start is not a valid date-time");
    return date;
  }
  const match = NAIVE.exec(value);
  if (!match) throw bad("start must be YYYY-MM-DDTHH:mm, or an ISO time with Z or an offset");
  return zonedWallToUtc(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    match[6] ? Number(match[6]) : 0,
    timeZone,
  );
}

function readMinutes(value) {
  if (value == null || value === "") return 30;
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
    throw bad(`duration_minutes must be an integer from ${MIN_MINUTES} to ${MAX_MINUTES}`);
  }
  return minutes;
}

function clip(value, max, name) {
  const text = String(value ?? "").replaceAll("\u0000", "").trim();
  if (text.length > max) throw bad(`${name} must be ${max} characters or fewer`);
  return text;
}

function parseInput(url, body) {
  let payload = {};
  if (body) {
    try {
      payload = JSON.parse(body);
    } catch {
      throw bad("Body must be JSON");
    }
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw bad("Body must be a JSON object");
    }
  }
  const title = clip(payload.title ?? url.searchParams.get("title"), 200, "title");
  if (!title) throw bad("title is required");
  const timeZone = clip(payload.timezone ?? url.searchParams.get("timezone") ?? "UTC", 80, "timezone") || "UTC";
  assertZone(timeZone);
  const start = parseStart(payload.start ?? url.searchParams.get("start"), timeZone);
  const minutes = readMinutes(payload.duration_minutes ?? url.searchParams.get("duration_minutes"));
  const location = clip(payload.location ?? url.searchParams.get("location") ?? "", 200, "location").replace(
    /\s+/g,
    " ",
  );
  const description = clip(payload.description ?? url.searchParams.get("description") ?? "", 2000, "description");
  return {
    title,
    start,
    end: new Date(start.getTime() + minutes * 60 * 1000),
    location,
    description,
  };
}

function formatUtc(date) {
  return (
    String(date.getUTCFullYear()) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

function escapeText(value) {
  return value.replaceAll("\\", "\\\\").replaceAll(/\r\n|\n|\r/g, "\\n").replaceAll(";", "\\;").replaceAll(",", "\\,");
}

function fold(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts = [];
  let start = 0;
  let width = 75;
  while (start < bytes.length) {
    let end = Math.min(start + width, bytes.length);
    while (end > start && (bytes[end] & 0xc0) === 0x80) end -= 1;
    if (end === start) end = Math.min(start + width, bytes.length);
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    width = 74;
  }
  return parts.join("\r\n ");
}

function buildIcs({ title, start, end, location, description }) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Agent Service Examples//Invite//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${randomBytes(12).toString("hex")}@invite`,
    `DTSTAMP:${formatUtc(new Date())}`,
    `DTSTART:${formatUtc(start)}`,
    `DTEND:${formatUtc(end)}`,
    `SUMMARY:${escapeText(title)}`,
  ];
  if (location) lines.push(`LOCATION:${escapeText(location)}`);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

function openapi(req) {
  const server = originFrom(req);
  return {
    openapi: "3.1.0",
    info: {
      title: "Invite",
      version: "1.0.0",
      description: "Turn a wall-clock time and an IANA timezone into an iCalendar invite.",
    },
    servers: [{ url: server }],
    "x-service-info": {
      categories: ["utilities"],
      docs: { homepage: `${server}/`, apiReference: `${server}/openapi.json`, llms: `${server}/llms.txt` },
    },
    paths: {
      "/api/invite": {
        post: {
          summary: "Build a calendar invite",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["title", "start"],
                  properties: {
                    title: { type: "string", maxLength: 200 },
                    start: { type: "string", description: "YYYY-MM-DDTHH:mm in timezone, or ISO with Z or an offset" },
                    timezone: { type: "string", default: "UTC" },
                    duration_minutes: { type: "integer", minimum: MIN_MINUTES, maximum: MAX_MINUTES, default: 30 },
                    location: { type: "string", maxLength: 200 },
                    description: { type: "string", maxLength: 2000 },
                  },
                },
              },
            },
          },
          responses: { 200: { description: "text/calendar" } },
        },
        get: {
          summary: "Build a calendar invite",
          parameters: [
            { name: "title", in: "query", required: true, schema: { type: "string", maxLength: 200 } },
            { name: "start", in: "query", required: true, schema: { type: "string" } },
            { name: "timezone", in: "query", schema: { type: "string", default: "UTC" } },
            {
              name: "duration_minutes",
              in: "query",
              schema: { type: "integer", minimum: MIN_MINUTES, maximum: MAX_MINUTES, default: 30 },
            },
            { name: "location", in: "query", schema: { type: "string", maxLength: 200 } },
            { name: "description", in: "query", schema: { type: "string", maxLength: 2000 } },
          ],
          responses: { 200: { description: "text/calendar" } },
        },
      },
    },
  };
}

function llms(req) {
  const server = originFrom(req);
  return `# Invite

Build an iCalendar invite (.ics) from a title, a start time, and an IANA timezone. The file uses UTC instants, so a calendar app shows the right wall-clock time. Models often get timezones, line folding, and event ids wrong.

This starter does not charge. Wrap GET/POST /api/invite with MPP before you submit it.

POST ${server}/api/invite
Content-Type: application/json

{ "title": "Ship review", "start": "2026-10-15T15:00", "timezone": "Europe/London", "duration_minutes": 30, "location": "Room 4" }

GET ${server}/api/invite?title=Ship%20review&start=2026-10-15T15:00&timezone=Europe/London

start is YYYY-MM-DDTHH:mm in timezone, or an ISO time with Z or an offset. timezone defaults to UTC. duration_minutes defaults to 30 (5–1440). A local time that does not exist when clocks spring forward is rejected.

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
      send(res, 200, { ok: true, service: "invite" });
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
    if (url.pathname === "/api/invite") {
      const raw = req.method === "POST" ? await readBody(req) : "";
      if (req.method !== "GET" && req.method !== "POST") {
        jsonError(res, 405, "Use GET or POST");
        return;
      }
      const ics = buildIcs(parseInput(url, raw));
      send(res, 200, ics, {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": 'inline; filename="invite.ics"',
      });
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
  console.log(`Invite  http://${HOST}:${PORT}`);
});
