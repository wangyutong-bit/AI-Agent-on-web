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
const MAX_CONTEXT_MESSAGES = Number.parseInt(process.env.MAX_CONTEXT_MESSAGES || "20", 10);
const SESSION_TTL_MS =
  Number.parseInt(process.env.SESSION_TTL_MS || `${1000 * 60 * 60 * 2}`, 10);
const DEFAULT_TEMPERATURE = Number.parseFloat(process.env.DEFAULT_TEMPERATURE || "0.7");
const WEB_SEARCH_DEFAULT_ENABLED = normalizeBoolean(process.env.WEB_SEARCH_DEFAULT_ENABLED);
const WEB_SEARCH_MAX_RESULTS = normalizeIntegerInRange(
  process.env.WEB_SEARCH_MAX_RESULTS,
  5,
  1,
  10
);
const TAVILY_API_KEY = (process.env.TAVILY_API_KEY || "").trim();
const TAVILY_URL = process.env.TAVILY_URL || "https://api.tavily.com/search";
const TAVILY_SEARCH_DEPTH = normalizeTavilySearchDepth(process.env.TAVILY_SEARCH_DEPTH);
const WEB_SEARCH_CONFIGURED = Boolean(TAVILY_API_KEY);

const PROVIDERS = {
  zhipu: {
    id: "zhipu",
    name: "Zhipu AI",
    apiKeyEnv: "ZHIPU_API_KEY",
    apiKey: process.env.ZHIPU_API_KEY || "",
    url:
      process.env.ZHIPU_URL || "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    defaultModel: process.env.ZHIPU_MODEL || "glm-4-flash",
    thinkingModel: process.env.ZHIPU_THINKING_MODEL || "glm-z1-flash"
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    url: process.env.DEEPSEEK_URL || "https://api.deepseek.com/chat/completions",
    defaultModel: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    thinkingModel: process.env.DEEPSEEK_THINKING_MODEL || "deepseek-reasoner"
  },
  qwen: {
    id: "qwen",
    name: "Qwen (DashScope Compatible)",
    apiKeyEnv: "QWEN_API_KEY",
    apiKey: process.env.QWEN_API_KEY || "",
    url:
      process.env.QWEN_URL ||
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    defaultModel: process.env.QWEN_MODEL || "qwen-plus",
    thinkingModel: process.env.QWEN_THINKING_MODEL || "qwen-plus"
  },
  moonshot: {
    id: "moonshot",
    name: "Moonshot (Kimi)",
    apiKeyEnv: "MOONSHOT_API_KEY",
    apiKey: process.env.MOONSHOT_API_KEY || "",
    url: process.env.MOONSHOT_URL || "https://api.moonshot.cn/v1/chat/completions",
    defaultModel: process.env.MOONSHOT_MODEL || "moonshot-v1-8k",
    thinkingModel: process.env.MOONSHOT_THINKING_MODEL || "moonshot-v1-8k"
  },
  minimax: {
    id: "minimax",
    name: "MiniMax",
    apiKeyEnv: "MINIMAX_API_KEY",
    apiKey: process.env.MINIMAX_API_KEY || "",
    url: process.env.MINIMAX_URL || "https://api.minimax.io/v1/chat/completions",
    defaultModel: process.env.MINIMAX_MODEL || "MiniMax-M2.5",
    thinkingModel: process.env.MINIMAX_THINKING_MODEL || "MiniMax-M2.5"
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    apiKeyEnv: "OPENAI_API_KEY",
    apiKey: process.env.OPENAI_API_KEY || "",
    url: process.env.OPENAI_URL || "https://api.openai.com/v1/chat/completions",
    defaultModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
    thinkingModel: process.env.OPENAI_THINKING_MODEL || "gpt-4o-mini"
  },
  xai: {
    id: "xai",
    name: "xAI (Grok)",
    apiKeyEnv: "XAI_API_KEY",
    apiKey: process.env.XAI_API_KEY || "",
    url: process.env.XAI_URL || "https://api.x.ai/v1/chat/completions",
    defaultModel: process.env.XAI_MODEL || "grok-3-mini",
    thinkingModel: process.env.XAI_THINKING_MODEL || "grok-3-mini"
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    apiKeyEnv: "OPENROUTER_API_KEY",
    apiKey: process.env.OPENROUTER_API_KEY || "",
    url: process.env.OPENROUTER_URL || "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
    thinkingModel: process.env.OPENROUTER_THINKING_MODEL || "openai/gpt-4o-mini"
  },
  groq: {
    id: "groq",
    name: "Groq",
    apiKeyEnv: "GROQ_API_KEY",
    apiKey: process.env.GROQ_API_KEY || "",
    url: process.env.GROQ_URL || "https://api.groq.com/openai/v1/chat/completions",
    defaultModel: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    thinkingModel: process.env.GROQ_THINKING_MODEL || "llama-3.3-70b-versatile"
  },
  mistral: {
    id: "mistral",
    name: "Mistral",
    apiKeyEnv: "MISTRAL_API_KEY",
    apiKey: process.env.MISTRAL_API_KEY || "",
    url: process.env.MISTRAL_URL || "https://api.mistral.ai/v1/chat/completions",
    defaultModel: process.env.MISTRAL_MODEL || "mistral-small-latest",
    thinkingModel: process.env.MISTRAL_THINKING_MODEL || "mistral-small-latest"
  },
  together: {
    id: "together",
    name: "Together AI",
    apiKeyEnv: "TOGETHER_API_KEY",
    apiKey: process.env.TOGETHER_API_KEY || "",
    url: process.env.TOGETHER_URL || "https://api.together.xyz/v1/chat/completions",
    defaultModel:
      process.env.TOGETHER_MODEL || "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    thinkingModel:
      process.env.TOGETHER_THINKING_MODEL || "meta-llama/Llama-3.3-70B-Instruct-Turbo"
  },
  fireworks: {
    id: "fireworks",
    name: "Fireworks",
    apiKeyEnv: "FIREWORKS_API_KEY",
    apiKey: process.env.FIREWORKS_API_KEY || "",
    url: process.env.FIREWORKS_URL || "https://api.fireworks.ai/inference/v1/chat/completions",
    defaultModel:
      process.env.FIREWORKS_MODEL || "accounts/fireworks/models/llama-v3p1-8b-instruct",
    thinkingModel:
      process.env.FIREWORKS_THINKING_MODEL || "accounts/fireworks/models/llama-v3p1-8b-instruct"
  }
};

const PROVIDER_ORDER = [
  "zhipu",
  "deepseek",
  "qwen",
  "moonshot",
  "minimax",
  "openai",
  "xai",
  "openrouter",
  "groq",
  "mistral",
  "together",
  "fireworks"
];
const DEFAULT_PROVIDER = resolveDefaultProviderId();

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

function normalizeProviderId(value) {
  if (typeof value !== "string") {
    return "";
  }

  const providerId = value.trim().toLowerCase();
  if (!PROVIDERS[providerId]) {
    return "";
  }

  return providerId;
}

function resolveDefaultProviderId() {
  const fromEnv = normalizeProviderId(process.env.DEFAULT_PROVIDER);
  if (fromEnv) {
    return fromEnv;
  }

  const firstConfigured = PROVIDER_ORDER.find((providerId) => PROVIDERS[providerId]?.apiKey);
  return firstConfigured || "zhipu";
}

function normalizeModel(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) {
    return "";
  }

  return trimmed;
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    return trimmed === "1" || trimmed === "true" || trimmed === "yes" || trimmed === "on";
  }
  return false;
}

function normalizeIntegerInRange(value, fallback, min, max) {
  const parsed = Number.parseInt(`${value ?? ""}`, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < min) {
    return min;
  }
  if (parsed > max) {
    return max;
  }
  return parsed;
}

function normalizeTavilySearchDepth(value) {
  if (typeof value !== "string") {
    return "basic";
  }

  const depth = value.trim().toLowerCase();
  return depth === "advanced" ? "advanced" : "basic";
}

function resolveWebSearchEnabled(value) {
  if (typeof value === "undefined" || value === null || value === "") {
    return WEB_SEARCH_DEFAULT_ENABLED;
  }
  return normalizeBoolean(value);
}

function sanitizeSearchText(value, maxLength = 320) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

function sanitizeSourceUrl(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeSearchSource(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const url = sanitizeSourceUrl(raw.url || raw.link || "");
  if (!url) {
    return null;
  }

  const title = sanitizeSearchText(raw.title || raw.name || "", 180);
  const snippet = sanitizeSearchText(raw.content || raw.snippet || raw.description || "", 360);
  return {
    title: title || url,
    url,
    snippet
  };
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

function extractReasoningContent(content) {
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

function extractStreamDeltaReasoning(payload) {
  const choice = payload?.choices?.[0];
  if (!choice) {
    return "";
  }

  if (choice.delta && typeof choice.delta === "object") {
    const reasoningContent = extractTextContent(choice.delta.reasoning_content, false);
    if (reasoningContent) {
      return reasoningContent;
    }

    const reasoning = extractTextContent(choice.delta.reasoning, false);
    if (reasoning) {
      return reasoning;
    }

    const reasoningDetails = extractTextContent(choice.delta.reasoning_details, false);
    if (reasoningDetails) {
      return reasoningDetails;
    }
  }

  const messageReasoning =
    extractTextContent(choice?.message?.reasoning_content, false) ||
    extractTextContent(choice?.message?.reasoning, false) ||
    extractTextContent(choice?.message?.reasoning_details, false);
  if (messageReasoning) {
    return messageReasoning;
  }

  return "";
}

function extractReplyAndReasoning(data) {
  const message = data?.choices?.[0]?.message || {};
  const reply = extractReplyContent(message.content);
  const reasoning =
    extractReasoningContent(message.reasoning_content) ||
    extractReasoningContent(message.reasoning) ||
    extractReasoningContent(message.reasoning_details);
  return { reply, reasoning: reasoning || "" };
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
    return data?.error?.message || data?.error || text || "Upstream request failed";
  } catch {
    return text || "Upstream request failed";
  }
}

async function runTavilySearch(query, maxResults) {
  const response = await fetch(TAVILY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query,
      search_depth: TAVILY_SEARCH_DEPTH,
      include_answer: false,
      include_raw_content: false,
      max_results: maxResults
    })
  });

  if (!response.ok) {
    const errorMessage = await extractUpstreamError(response);
    throw new Error(errorMessage || "Web search request failed");
  }

  const data = await response.json();
  const rawResults = Array.isArray(data?.results) ? data.results : [];
  const sources = [];
  const seen = new Set();

  for (const rawResult of rawResults) {
    const source = normalizeSearchSource(rawResult);
    if (!source) {
      continue;
    }
    if (seen.has(source.url)) {
      continue;
    }
    seen.add(source.url);
    sources.push(source);
    if (sources.length >= maxResults) {
      break;
    }
  }

  return sources;
}

async function collectWebSearchContext(enableWebSearch, userMessage) {
  const context = {
    enabled: Boolean(enableWebSearch),
    configured: WEB_SEARCH_CONFIGURED,
    query: "",
    sources: [],
    error: ""
  };

  if (!context.enabled) {
    return context;
  }

  if (!context.configured) {
    context.error = "Server missing TAVILY_API_KEY";
    return context;
  }

  const query = sanitizeSearchText(userMessage, 220);
  if (!query) {
    context.error = "Search query is empty";
    return context;
  }
  context.query = query;

  try {
    context.sources = await runTavilySearch(query, WEB_SEARCH_MAX_RESULTS);
  } catch (err) {
    context.error = err?.message || "Web search failed";
  }

  return context;
}

function buildSearchContextSystemMessage(webSearchContext) {
  if (!webSearchContext?.sources?.length) {
    return "";
  }

  const query = sanitizeSearchText(webSearchContext.query, 220);
  const lines = [
    "The system just ran a web search. Use the sources below as references.",
    `Search time (UTC): ${new Date().toISOString()}`,
    query ? `Search query: ${query}` : ""
  ].filter(Boolean);

  webSearchContext.sources.forEach((source, index) => {
    lines.push(`Source[${index + 1}] Title: ${source.title}`);
    lines.push(`Source[${index + 1}] URL: ${source.url}`);
    if (source.snippet) {
      lines.push(`Source[${index + 1}] Snippet: ${source.snippet}`);
    }
  });

  lines.push("Do not fabricate sources or links. If evidence is insufficient, say so.");
  return lines.join("\n");
}

function buildMessagesForUpstream(contextMessages, userMessage, webSearchContext) {
  const messages = [...contextMessages];
  const searchSystemPrompt = buildSearchContextSystemMessage(webSearchContext);
  if (searchSystemPrompt) {
    messages.push({ role: "system", content: searchSystemPrompt });
  }
  messages.push({ role: "user", content: userMessage });
  return messages;
}

function buildWebSearchPayload(webSearchContext) {
  return {
    enabled: Boolean(webSearchContext?.enabled),
    configured: Boolean(webSearchContext?.configured),
    query: webSearchContext?.query || undefined,
    sources:
      Array.isArray(webSearchContext?.sources) && webSearchContext.sources.length
        ? webSearchContext.sources
        : undefined,
    error: webSearchContext?.error || undefined
  };
}

function buildWebSearchClientConfig() {
  return {
    provider: "tavily",
    configured: WEB_SEARCH_CONFIGURED,
    defaultEnabled: WEB_SEARCH_CONFIGURED ? WEB_SEARCH_DEFAULT_ENABLED : false,
    maxResults: WEB_SEARCH_MAX_RESULTS
  };
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

function listProvidersForClient() {
  return PROVIDER_ORDER.filter((providerId) => PROVIDERS[providerId]).map((providerId) => {
    const provider = PROVIDERS[providerId];
    return {
      id: provider.id,
      name: provider.name,
      configured: Boolean(provider.apiKey),
      defaultModel: provider.defaultModel,
      thinkingModel: provider.thinkingModel
    };
  });
}

function resolveProviderOptions(body) {
  const providerId = normalizeProviderId(body.provider) || DEFAULT_PROVIDER;
  const provider = PROVIDERS[providerId];
  if (!provider) {
    return {
      ok: false,
      statusCode: 400,
      error: "provider is invalid"
    };
  }

  if (!provider.apiKey) {
    return {
      ok: false,
      statusCode: 500,
      error: `Server missing ${provider.apiKeyEnv} for ${provider.name}`
    };
  }

  const enableThinking = normalizeBoolean(body.enableThinking);
  const requestedModel = normalizeModel(body.model);
  const model =
    requestedModel || (enableThinking ? provider.thinkingModel : provider.defaultModel) || "";
  if (!model) {
    return {
      ok: false,
      statusCode: 500,
      error: `No model configured for ${provider.name}`
    };
  }

  return {
    ok: true,
    providerId,
    provider,
    model,
    enableThinking
  };
}

function buildUpstreamRequestBody({ providerId, messages, model, enableThinking, stream }) {
  const payload = {
    model,
    messages
  };

  if (Number.isFinite(DEFAULT_TEMPERATURE)) {
    payload.temperature = DEFAULT_TEMPERATURE;
  }

  if (stream) {
    payload.stream = true;
  }

  if (providerId === "qwen" && enableThinking) {
    payload.enable_thinking = true;
  }

  if (providerId === "minimax" && enableThinking) {
    payload.reasoning_split = true;
  }

  return payload;
}

async function handleChat(req, res) {
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

  const providerResult = resolveProviderOptions(body);
  if (!providerResult.ok) {
    sendJson(res, providerResult.statusCode, { error: providerResult.error });
    return;
  }

  const { providerId, provider, model, enableThinking } = providerResult;
  const enableWebSearch = resolveWebSearchEnabled(body.enableWebSearch);

  cleanupExpiredSessions();

  let sessionId = normalizeSessionId(body.sessionId);
  if (!sessionId) {
    sessionId = randomUUID();
  }

  const history = Array.isArray(body.history) ? body.history : [];
  const session = upsertSession(sessionId, history);
  const contextMessages = session.messages.slice(-MAX_CONTEXT_MESSAGES);
  const webSearchContext = await collectWebSearchContext(enableWebSearch, userMessage);
  const messages = buildMessagesForUpstream(contextMessages, userMessage, webSearchContext);
  const upstreamPayload = buildUpstreamRequestBody({
    providerId,
    messages,
    model,
    enableThinking,
    stream: false
  });

  try {
    const aiResp = await fetch(provider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify(upstreamPayload)
    });

    if (!aiResp.ok) {
      const errorMessage = await extractUpstreamError(aiResp);
      sendJson(res, aiResp.status, { error: errorMessage });
      return;
    }

    const data = await aiResp.json();
    const { reply, reasoning } = extractReplyAndReasoning(data);
    if (!reply) {
      sendJson(res, 502, { error: "Empty response from model" });
      return;
    }

    pushConversation(session, userMessage, reply);

    sendJson(res, 200, {
      reply,
      reasoning: reasoning || undefined,
      sessionId,
      provider: providerId,
      model,
      sources: webSearchContext.sources.length ? webSearchContext.sources : undefined,
      webSearch: buildWebSearchPayload(webSearchContext)
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message || "Server error" });
  }
}

async function handleChatStream(req, res) {
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

  const providerResult = resolveProviderOptions(body);
  if (!providerResult.ok) {
    sendJson(res, providerResult.statusCode, { error: providerResult.error });
    return;
  }

  const { providerId, provider, model, enableThinking } = providerResult;
  const enableWebSearch = resolveWebSearchEnabled(body.enableWebSearch);

  cleanupExpiredSessions();

  let sessionId = normalizeSessionId(body.sessionId);
  if (!sessionId) {
    sessionId = randomUUID();
  }

  const history = Array.isArray(body.history) ? body.history : [];
  const session = upsertSession(sessionId, history);
  const contextMessages = session.messages.slice(-MAX_CONTEXT_MESSAGES);
  const webSearchContext = await collectWebSearchContext(enableWebSearch, userMessage);
  const messages = buildMessagesForUpstream(contextMessages, userMessage, webSearchContext);
  const upstreamPayload = buildUpstreamRequestBody({
    providerId,
    messages,
    model,
    enableThinking,
    stream: true
  });

  const controller = new AbortController();
  let clientClosed = false;
  req.on("close", () => {
    clientClosed = true;
    controller.abort();
  });

  try {
    const aiResp = await fetch(provider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify(upstreamPayload)
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

    writeSseEvent(res, { type: "session", sessionId, provider: providerId, model });
    if (enableWebSearch) {
      writeSseEvent(res, {
        type: "search",
        ...buildWebSearchPayload(webSearchContext)
      });
    }

    // Fallback for non-SSE providers: emit a single delta and done.
    const upstreamType = (aiResp.headers.get("content-type") || "").toLowerCase();
    if (!upstreamType.includes("text/event-stream")) {
      const data = await aiResp.json();
      const { reply, reasoning } = extractReplyAndReasoning(data);
      if (!reply) {
        writeSseEvent(res, { type: "error", error: "Empty response from model" });
        res.end();
        return;
      }

      pushConversation(session, userMessage, reply);
      if (reasoning) {
        writeSseEvent(res, { type: "reasoning", delta: reasoning });
      }
      writeSseEvent(res, { type: "delta", delta: reply });
      writeSseEvent(res, {
        type: "done",
        reply,
        reasoning,
        sessionId,
        provider: providerId,
        model,
        sources: webSearchContext.sources.length ? webSearchContext.sources : undefined,
        webSearch: buildWebSearchPayload(webSearchContext)
      });
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
    let reasoning = "";

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

        const reasoningDelta = extractStreamDeltaReasoning(payload);
        if (reasoningDelta) {
          reasoning += reasoningDelta;
          writeSseEvent(res, { type: "reasoning", delta: reasoningDelta });
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
        const reasoningDelta = extractStreamDeltaReasoning(payload);
        if (reasoningDelta) {
          reasoning += reasoningDelta;
          writeSseEvent(res, { type: "reasoning", delta: reasoningDelta });
        }
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
    writeSseEvent(res, {
      type: "done",
      reply: finalReply,
      reasoning: reasoning.trim() || undefined,
      sessionId,
      provider: providerId,
      model,
      sources: webSearchContext.sources.length ? webSearchContext.sources : undefined,
      webSearch: buildWebSearchPayload(webSearchContext)
    });
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

  if (req.method === "GET" && parsed.pathname === "/api/providers") {
    sendJson(res, 200, {
      defaultProvider: DEFAULT_PROVIDER,
      providers: listProvidersForClient(),
      webSearch: buildWebSearchClientConfig()
    });
    return;
  }

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

