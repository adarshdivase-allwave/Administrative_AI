/**
 * chatbot-handler — Gemini chatbot (default: gemini-2.5-flash) with OpenSearch
 * RAG and per-user rate limiting. Model is env-configurable via GEMINI_MODEL.
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

export const handler = async (
  rawEvent: Input | { arguments?: Input; identity?: { sub?: string; username?: string } },
): Promise<Output> => {
  // Support both CLI and AppSync resolver shapes.
  const source = rawEvent as {
    arguments?: Input;
    identity?: { sub?: string; username?: string };
  };
  const event: Input = source?.arguments ?? (rawEvent as Input);

  // AppSync resolvers: auto-populate userId from Cognito identity if caller omits it.
  if (!event.userId && source?.identity?.sub) {
    event.userId = source.identity.sub;
  }

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
//
// Strategy: extract keywords from the user's message, run a few bounded
// DynamoDB scans with FilterExpressions on the most-likely-relevant models,
// and pass the hits as JSON snippets to Gemini. Much cheaper than OpenSearch
// Serverless (~$180/mo) — Gemini 2.5's 1M-token context handles the "semantic
// understanding" part we used to delegate to BM25.
//
// Trade-off: DynamoDB Scan is slower at very high row counts. For typical
// Indian AV-integrator fleets (< 50k units, < 10k SKUs, < 1k clients), this
// stays well under 500ms per chat turn. For larger tenants, flip
// USE_OPENSEARCH=1 to route through the OpenSearch path instead.

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "is", "are", "was", "were", "be",
  "to", "for", "on", "in", "at", "by", "with", "from", "this", "that",
  "how", "what", "when", "where", "which", "why", "do", "does", "did",
  "i", "you", "we", "they", "it", "me", "us", "them", "my", "your", "our",
  "can", "could", "should", "would", "many", "much", "some", "all", "any",
]);

function extractKeywords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^\w\s-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
    ),
  ].slice(0, 8);
}

async function fetchRagContext(
  question: string,
  deepLinkEntity?: { type: string; id: string },
): Promise<string> {
  const snippets: string[] = [];

  // 1. Deep-link context: direct fetch if the caller passed an entity.
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

  // 2. Keyword-scan the most useful models. Each scan is capped at Limit=200
  //    and we further post-filter + cap to the top 5 matches.
  const keywords = extractKeywords(question);
  if (keywords.length > 0) {
    // ProductMaster — name + model + brand
    snippets.push(
      ...(await scanModelForKeywords("ProductMaster", keywords, [
        "productName",
        "brand",
        "modelNumber",
        "hsnCode",
      ])),
    );
    // Client — name
    snippets.push(
      ...(await scanModelForKeywords("Client", keywords, ["name", "gstin", "billingCity"])),
    );
    // Vendor — name
    snippets.push(
      ...(await scanModelForKeywords("Vendor", keywords, ["name", "gstin"])),
    );
    // Project — name + code
    snippets.push(
      ...(await scanModelForKeywords("Project", keywords, ["projectName", "projectCode"])),
    );
    // ClientInvoice — invoice number (for "what's the status of INV-xxx")
    snippets.push(
      ...(await scanModelForKeywords("ClientInvoice", keywords, ["invoiceNumber", "status"])),
    );
  }

  // 3. Current stock summary — always useful for inventory questions.
  // Cheap aggregate query: active stock alerts + unit count by category.
  snippets.push(...(await stockSummary()));

  // Optional OpenSearch augmentation — only if explicitly enabled.
  if (process.env.USE_OPENSEARCH === "1") {
    snippets.push(...(await opensearchRag(question)));
  }

  return snippets.join("\n---\n").slice(0, 12000);
}

async function scanModelForKeywords(
  model: string,
  keywords: string[],
  searchFields: string[],
): Promise<string[]> {
  try {
    const { scanItems } = await import("../_lib/ddb.js");
    // Build a FilterExpression that matches ANY keyword in ANY of the fields.
    const attrNames: Record<string, string> = {};
    const attrValues: Record<string, string> = {};
    const clauses: string[] = [];

    searchFields.forEach((f, i) => {
      attrNames[`#f${i}`] = f;
      keywords.forEach((kw, j) => {
        const valKey = `:v${i}_${j}`;
        attrValues[valKey] = kw;
        clauses.push(`contains(#f${i}, ${valKey})`);
      });
    });

    if (clauses.length === 0) return [];

    const rows = await scanItems<Record<string, unknown>>(model, {
      FilterExpression: clauses.join(" OR "),
      ExpressionAttributeNames: attrNames,
      ExpressionAttributeValues: attrValues,
      Limit: 50,
    });

    return rows.slice(0, 5).map(
      (r) => `${model}: ${JSON.stringify(r).slice(0, 600)}`,
    );
  } catch (e) {
    console.warn(`[chatbot] RAG scan ${model} failed:`, (e as Error).message);
    return [];
  }
}

async function stockSummary(): Promise<string[]> {
  try {
    const { scanItems } = await import("../_lib/ddb.js");
    const alerts = await scanItems<{ alertType?: string; message?: string; severity?: string }>(
      "StockAlert",
      {
        FilterExpression: "isActive = :t",
        ExpressionAttributeValues: { ":t": "TRUE" },
        Limit: 20,
      },
    );
    if (alerts.length === 0) return [];
    const summary = alerts
      .slice(0, 10)
      .map((a) => `${a.severity ?? ""} ${a.alertType ?? ""}: ${a.message ?? ""}`)
      .join("\n");
    return [`Active alerts (snapshot):\n${summary}`];
  } catch {
    return [];
  }
}

async function opensearchRag(question: string): Promise<string[]> {
  const endpoint = process.env.OPENSEARCH_COLLECTION_ENDPOINT ?? "";
  if (!endpoint) return [];
  const out: string[] = [];
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
        out.push(JSON.stringify(hit._source).slice(0, 800));
      }
    } catch (e) {
      console.warn(`[chatbot] OS ${index} failed:`, (e as Error).message);
    }
  }
  return out;
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

  // Model is env-configurable; default gemini-2.5-flash for fast chatbot replies
  // with tool (google_search) support. Swap to gemini-2.5-pro via env var for
  // higher-quality responses at ~4x the cost.
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
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
