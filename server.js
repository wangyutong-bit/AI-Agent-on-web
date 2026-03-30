const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

function loadEnvFile(fileName) {
  const filePath = path.join(__dirname, fileName);
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    if (!key || process.env[key]) {
      continue;
    }

    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadEnvFile(".env");
loadEnvFile(".env.example");

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";
const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY || "";
const ZHIPU_MODEL = process.env.ZHIPU_MODEL || "glm-4-flash";
const ZHIPU_URL =
  process.env.ZHIPU_URL || "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const MAX_CONTEXT_MESSAGES = Number.parseInt(process.env.MAX_CONTEXT_MESSAGES || "20", 10);
const SESSION_TTL_MS =
  Number.parseInt(process.env.SESSION_TTL_MS || `${1000 * 60 * 60 * 2}`, 10);

const sessions = new Map();

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter(
      (item) =>
        item &&
        (item.role === "user" || item.role === "assistant" || item.role === "system") &&
        typeof item.content === "string" &&
        item.content.trim()
    )
    .map((item) => ({ role: item.role, content: item.content.trim() }))
    .slice(-MAX_CONTEXT_MESSAGES);
}

function normalizeSessionId(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(trimmed)) {
    return "";
  }

  return trimmed;
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.updatedAt > SESSION_TTL_MS) {
      sessions.delete(sessionId);
    }
  }
}

function extractTextContent(content, trim) {
  if (typeof content === "string") {
    return trim ? content.trim() : content;
  }

  if (Array.isArray(content)) {
    const merged = content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part.text === "string") {
          return part.text;
        }
        return "";
      })
      .join("");
    return trim ? merged.trim() : merged;
  }

  return "";
}

function extractReplyContent(content) {
  return extractTextContent(content, true);
}

function extractStreamDeltaContent(payload) {
  const choice = payload?.choices?.[0];
  if (!choice) {
    return "";
  }

  if (typeof choice.delta === "string") {
    return choice.delta;
  }

  const deltaContent = extractTextContent(choice?.delta?.content, false);
  if (deltaContent) {
    return deltaContent;
  }

  const messageContent = extractTextContent(choice?.message?.content, false);
  if (messageContent) {
    return messageContent;
  }

  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  return "";
}

function pushConversation(session, userMessage, reply) {
  session.messages.push({ role: "user", content: userMessage });
  session.messages.push({ role: "assistant", content: reply });
  if (session.messages.length > MAX_CONTEXT_MESSAGES) {
    session.messages = session.messages.slice(-MAX_CONTEXT_MESSAGES);
  }
  session.updatedAt = Date.now();
}

function writeSseEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function parseSseDataBlock(block) {
  const dataLines = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) {
    return "";
  }

  return dataLines.join("\n");
}

async function extractUpstreamError(resp) {
  const text = await resp.text();
  try {
    const data = JSON.parse(text);
    return data?.error?.message || data?.error || text || "Zhipu API request failed";
  } catch {
    return text || "Zhipu API request failed";
  }
}

function upsertSession(sessionId, initialHistory) {
  const existing = sessions.get(sessionId);
  if (existing) {
    existing.updatedAt = Date.now();
    return existing;
  }

  const session = {
    messages: sanitizeMessages(initialHistory),
    updatedAt: Date.now()
  };
  sessions.set(sessionId, session);
  return session;
}

async function handleChat(req, res) {
  if (!ZHIPU_API_KEY) {
    sendJson(res, 500, { error: "Server missing ZHIPU_API_KEY" });
    return;
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { error: err.message });
    return;
  }

  const userMessage = (body.message || "").toString().trim();
  if (!userMessage) {
    sendJson(res, 400, { error: "message is required" });
    return;
  }

  cleanupExpiredSessions();

  let sessionId = normalizeSessionId(body.sessionId);
  if (!sessionId) {
    sessionId = randomUUID();
  }

  const history = Array.isArray(body.history) ? body.history : [];
  const session = upsertSession(sessionId, history);
  const contextMessages = session.messages.slice(-MAX_CONTEXT_MESSAGES);
  const messages = [...contextMessages, { role: "user", content: userMessage }];

  try {
    const aiResp = await fetch(ZHIPU_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ZHIPU_API_KEY}`
      },
      body: JSON.stringify({
        model: ZHIPU_MODEL,
        messages,
        temperature: 0.7
      })
    });

    if (!aiResp.ok) {
      const errorMessage = await extractUpstreamError(aiResp);
      sendJson(res, aiResp.status, { error: errorMessage });
      return;
    }

    const data = await aiResp.json();
    const reply = extractReplyContent(data?.choices?.[0]?.message?.content);
    if (!reply) {
      sendJson(res, 502, { error: "Empty response from model" });
      return;
    }

    pushConversation(session, userMessage, reply);

    sendJson(res, 200, { reply, sessionId });
  } catch (err) {
    sendJson(res, 500, { error: err.message || "Server error" });
  }
}

async function handleChatStream(req, res) {
  if (!ZHIPU_API_KEY) {
    sendJson(res, 500, { error: "Server missing ZHIPU_API_KEY" });
    return;
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { error: err.message });
    return;
  }

  const userMessage = (body.message || "").toString().trim();
  if (!userMessage) {
    sendJson(res, 400, { error: "message is required" });
    return;
  }

  cleanupExpiredSessions();

  let sessionId = normalizeSessionId(body.sessionId);
  if (!sessionId) {
    sessionId = randomUUID();
  }

  const history = Array.isArray(body.history) ? body.history : [];
  const session = upsertSession(sessionId, history);
  const contextMessages = session.messages.slice(-MAX_CONTEXT_MESSAGES);
  const messages = [...contextMessages, { role: "user", content: userMessage }];

  const controller = new AbortController();
  let clientClosed = false;
  req.on("close", () => {
    clientClosed = true;
    controller.abort();
  });

  try {
    const aiResp = await fetch(ZHIPU_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ZHIPU_API_KEY}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: ZHIPU_MODEL,
        messages,
        temperature: 0.7,
        stream: true
      })
    });

    if (!aiResp.ok) {
      const errorMessage = await extractUpstreamError(aiResp);
      sendJson(res, aiResp.status, { error: errorMessage });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    writeSseEvent(res, { type: "session", sessionId });

    // Fallback for non-SSE providers: emit a single delta and done.
    const upstreamType = (aiResp.headers.get("content-type") || "").toLowerCase();
    if (!upstreamType.includes("text/event-stream")) {
      const data = await aiResp.json();
      const reply = extractReplyContent(data?.choices?.[0]?.message?.content);
      if (!reply) {
        writeSseEvent(res, { type: "error", error: "Empty response from model" });
        res.end();
        return;
      }

      pushConversation(session, userMessage, reply);
      writeSseEvent(res, { type: "delta", delta: reply });
      writeSseEvent(res, { type: "done", reply, sessionId });
      res.end();
      return;
    }

    if (!aiResp.body) {
      writeSseEvent(res, { type: "error", error: "Upstream stream is unavailable" });
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let reply = "";

    for await (const chunk of aiResp.body) {
      if (clientClosed) {
        return;
      }

      buffer += decoder.decode(chunk, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const dataText = parseSseDataBlock(block);
        if (!dataText) {
          boundary = buffer.indexOf("\n\n");
          continue;
        }

        if (dataText === "[DONE]") {
          boundary = buffer.indexOf("\n\n");
          continue;
        }

        let payload;
        try {
          payload = JSON.parse(dataText);
        } catch {
          boundary = buffer.indexOf("\n\n");
          continue;
        }

        const delta = extractStreamDeltaContent(payload);
        if (delta) {
          reply += delta;
          writeSseEvent(res, { type: "delta", delta });
        }

        boundary = buffer.indexOf("\n\n");
      }
    }

    buffer += decoder.decode();
    buffer = buffer.replace(/\r\n/g, "\n");
    const tailDataText = parseSseDataBlock(buffer);
    if (tailDataText && tailDataText !== "[DONE]") {
      try {
        const payload = JSON.parse(tailDataText);
        const delta = extractStreamDeltaContent(payload);
        if (delta) {
          reply += delta;
          writeSseEvent(res, { type: "delta", delta });
        }
      } catch {
        // ignore malformed tail chunk
      }
    }

    const finalReply = reply.trim();
    if (!finalReply) {
      writeSseEvent(res, { type: "error", error: "Empty response from model" });
      res.end();
      return;
    }

    pushConversation(session, userMessage, finalReply);
    writeSseEvent(res, { type: "done", reply: finalReply, sessionId });
    res.end();
  } catch (err) {
    if (clientClosed || err?.name === "AbortError") {
      return;
    }

    if (!res.headersSent) {
      sendJson(res, 500, { error: err.message || "Server error" });
      return;
    }

    writeSseEvent(res, { type: "error", error: err.message || "Stream failed" });
    res.end();
  }
}

async function handleChatReset(req, res) {
  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { error: err.message });
    return;
  }

  const sessionId = normalizeSessionId(body.sessionId);
  if (sessionId) {
    sessions.delete(sessionId);
  }

  sendJson(res, 200, { ok: true });
}

function serveStatic(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  let filePath = parsed.pathname;

  if (filePath === "/") {
    filePath = "/index.html";
  }

  const safeBase = path.resolve(__dirname, "public");
  const absPath = path.resolve(path.join(safeBase, `.${filePath}`));
  if (!absPath.startsWith(`${safeBase}${path.sep}`) && absPath !== safeBase) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(absPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(absPath).toLowerCase();
    const contentTypeMap = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    };

    res.writeHead(200, { "Content-Type": contentTypeMap[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && parsed.pathname === "/api/chat/stream") {
    await handleChatStream(req, res);
    return;
  }

  if (req.method === "POST" && parsed.pathname === "/api/chat") {
    await handleChat(req, res);
    return;
  }

  if (req.method === "POST" && parsed.pathname === "/api/chat/reset") {
    await handleChatReset(req, res);
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  res.writeHead(405);
  res.end("Method Not Allowed");
});

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://127.0.0.1:${PORT}`);
});
