/**
 * chatbot-handler — Gemini 1.5 Pro chatbot with OpenSearch RAG and per-user rate limiting.
 *
 * Input (AppSync resolver):
 *   {
 *     userId: string,
 *     message: string,
 *     sessionId?: string,   // missing = start new session
 *     deepLinkEntity?: { type: string, id: string }   // "Ask about this unit"
 *   }
 *
 * Output:
 *   {
 *     sessionId: string,
 *     reply: string,
 *     sourceCitations: Array<{ title?: string, url: string, domain?: string }>,
 *     tokensUsed?: number
 *   }
 *
 * Rate limit: 10 messages per minute per user (SystemSettings.chatbotRateLimitPerMin).
 * Enforced via ChatSession.ratelimitWindowStart + messagesInWindow counter.
 *
 * RAG: we pull a context bundle from OpenSearch for the 3 most relevant
 * indexes (products, invoices, HSN) and inject as `openSearch_context` in the
 * Gemini system prompt. If no context is returned, we fall back to pure
 * Gemini + Google Search tool so the assistant can still answer HSN / GST
 * lookup questions with citations.
 */
import { randomUUID } from "node:crypto";
import { getItem, putItem, updateItem, scanItems } from "../_lib/ddb.js";
import { getSecretField } from "../_lib/secrets.js";
import { CHATBOT_RATE_LIMIT_PER_MIN_DEFAULT } from "../../../shared/constants.js";

interface Input {
  userId: string;
  message: string;
  sessionId?: string;
  deepLinkEntity?: { type: string; id: string };
}

export interface Citation {
  url: string;
  title?: string;
  domain?: string;
}

export interface Output {
  sessionId: string;
  reply: string;
  sourceCitations: Citation[];
  tokensUsed?: number;
  rateLimited?: boolean;
}

interface SessionRow {
  id: string;
  userId: string;
  startedAt: string;
  lastMessageAt?: string;
  messages?: Array<{ role: string; content: string; ts: string; sourceUrls?: string[] }>;
  ratelimitWindowStart?: string;
  messagesInWindow?: number;
}

const SYSTEM_PROMPT = `You are an expert operations assistant for an AV (Audio-Visual) integration company in India. You have access to the company's real-time serialized inventory, project records, purchase orders, delivery challans, client invoices, payment status, warranty data, AMC contracts, service history, bills schedule, and India's complete GST HSN/SAC database — all provided in the context below when relevant.

Rules:
- India's financial year runs April 1 to March 31 — use this for all date calculations.
- All stock counts are derived from individual unit records — never invent quantities or serial numbers.
- For HSN/SAC codes, customs duties, and GST rates, use Google Search and always cite the official source (CBIC, GST Council).
- Answer concisely, professionally, and in Indian business context.
- Use Indian number formatting for INR amounts (lakhs/crores grouping).
- If context is empty and the question is about internal data, say so politely and suggest the user navigate to the relevant module.`;

export const handler = async (event: Input): Promise<Output> => {
  if (!event?.userId || !event.message) {
    throw new Error("userId and message are required");
  }

  const session = await loadOrCreateSession(event.userId, event.sessionId);

  // Rate limit check (SystemSettings can override the default per-min cap).
  const rateLimit = await loadRateLimit();
  const rateCheck = applyRateLimit(session, rateLimit);
  if (!rateCheck.ok) {
    return {
      sessionId: session.id,
      reply: rateCheck.message,
      sourceCitations: [],
      rateLimited: true,
    };
  }

  // Fetch RAG context (best-effort; failure → empty context).
  const context = await fetchRagContext(event.message, event.deepLinkEntity);

  const { reply, citations, tokens } = await callGemini(event.message, context, session.messages ?? []);

  const now = new Date().toISOString();
  const newMessages = [
    ...(session.messages ?? []),
    { role: "user", content: event.message, ts: now },
    { role: "assistant", content: reply, ts: now, sourceUrls: citations.map((c) => c.url) },
  ].slice(-40); // keep last 40 turns

  await updateItem("ChatSession", { id: session.id }, {
    UpdateExpression:
      "SET #m = :m, lastMessageAt = :t, messagesInWindow = :mw, ratelimitWindowStart = :rws, updatedAt = :t",
    ExpressionAttributeNames: { "#m": "messages" },
    ExpressionAttributeValues: {
      ":m": newMessages,
      ":t": now,
      ":mw": rateCheck.newCount,
      ":rws": rateCheck.windowStart,
    },
  });

  return {
    sessionId: session.id,
    reply,
    sourceCitations: citations,
    tokensUsed: tokens,
  };
};

// --------- rate limit ----------

async function loadRateLimit(): Promise<number> {
  const settings = await scanItems<{ chatbotRateLimitPerMin?: number }>("SystemSettings", {
    Limit: 1,
  });
  return settings[0]?.chatbotRateLimitPerMin ?? CHATBOT_RATE_LIMIT_PER_MIN_DEFAULT;
}

function applyRateLimit(
  session: SessionRow,
  limit: number,
): { ok: true; newCount: number; windowStart: string } | { ok: false; message: string; newCount: number; windowStart: string } {
  const now = Date.now();
  const windowMs = 60_000;
  const winStart = session.ratelimitWindowStart
    ? Date.parse(session.ratelimitWindowStart)
    : now;
  const inWindow = session.messagesInWindow ?? 0;

  if (now - winStart > windowMs) {
    // Window expired — reset.
    return { ok: true, newCount: 1, windowStart: new Date(now).toISOString() };
  }
  if (inWindow >= limit) {
    return {
      ok: false,
      message: `Rate limit reached — max ${limit} messages per minute. Please try again in a few seconds.`,
      newCount: inWindow,
      windowStart: new Date(winStart).toISOString(),
    };
  }
  return {
    ok: true,
    newCount: inWindow + 1,
    windowStart: new Date(winStart).toISOString(),
  };
}

// --------- session ----------

async function loadOrCreateSession(userId: string, sessionId?: string): Promise<SessionRow> {
  if (sessionId) {
    const existing = await getItem<SessionRow>("ChatSession", { id: sessionId });
    if (existing) return existing;
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  const row: SessionRow = {
    id,
    userId,
    startedAt: now,
    lastMessageAt: now,
    messages: [],
    messagesInWindow: 0,
    ratelimitWindowStart: now,
  };
  await putItem("ChatSession", { ...row, createdAt: now, updatedAt: now });
  return row;
}

// --------- RAG ----------

async function fetchRagContext(
  question: string,
  deepLinkEntity?: { type: string; id: string },
): Promise<string> {
  const endpoint = process.env.OPENSEARCH_COLLECTION_ENDPOINT ?? "";
  if (!endpoint) return "";

  const snippets: string[] = [];

  // 1. Deep-link context: if caller passed an entity, fetch it directly.
  if (deepLinkEntity) {
    const row = await getItem(deepLinkEntity.type, { id: deepLinkEntity.id }).catch(
      () => undefined,
    );
    if (row) {
      snippets.push(
        `Deep-link entity ${deepLinkEntity.type}#${deepLinkEntity.id}:\n${JSON.stringify(row).slice(0, 1500)}`,
      );
    }
  }

  // 2. Full-text search across the inventory index + HSN index.
  const indexes = [
    process.env.OPENSEARCH_SEARCH_INDEX ?? "av-inventory-search",
    process.env.OPENSEARCH_HSN_INDEX ?? "hsn-india-gst",
  ];
  for (const index of indexes) {
    try {
      const url = `${endpoint.replace(/\/$/, "")}/${index}/_search`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: { multi_match: { query: question, fields: ["*"] } },
          size: 5,
        }),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as {
        hits?: { hits?: Array<{ _source: Record<string, unknown> }> };
      };
      for (const hit of body.hits?.hits ?? []) {
        snippets.push(JSON.stringify(hit._source).slice(0, 800));
      }
    } catch (e) {
      console.warn(`[chatbot] RAG ${index} failed:`, (e as Error).message);
    }
  }

  return snippets.join("\n---\n").slice(0, 12000); // hard cap to keep Gemini happy
}

// --------- Gemini ----------

async function callGemini(
  userMessage: string,
  context: string,
  history: NonNullable<SessionRow["messages"]>,
): Promise<{ reply: string; citations: Citation[]; tokens?: number }> {
  const apiKey = await getSecretField(
    process.env.GEMINI_SECRET_ID ?? "av-inventory/gemini-api-key",
    "apiKey",
  );

  const historyContents = history.slice(-20).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const systemInstruction = {
    role: "system",
    parts: [
      { text: SYSTEM_PROMPT },
      { text: context ? `\n\n--- OpenSearch context ---\n${context}` : "" },
    ],
  };

  const body = {
    system_instruction: systemInstruction,
    contents: [
      ...historyContents,
      { role: "user", parts: [{ text: userMessage }] },
    ],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.3 },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${msg.slice(0, 400)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      groundingMetadata?: {
        groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      };
    }>;
    usageMetadata?: { totalTokenCount?: number };
  };

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const reply = parts.map((p) => p.text ?? "").join("").trim() || "(no reply)";

  const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const citations: Citation[] = chunks
    .map((c) => c.web)
    .filter(Boolean)
    .map((w) => ({ url: w!.uri ?? "", title: w!.title, domain: safeDomain(w!.uri ?? "") }))
    .filter((c) => c.url);

  return {
    reply,
    citations,
    tokens: data.usageMetadata?.totalTokenCount,
  };
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
