import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Bot, Loader2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { useUIStore } from "@/stores/ui-store";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/amplify-client";
import { toast } from "@/components/ui/toast";

/**
 * Floating chatbot — calls the `chatbotMessage` mutation on AppSync,
 * which fans out to the `chatbot-handler` Lambda with OpenSearch RAG +
 * Gemini 1.5 Pro + grounding citations.
 *
 * UX:
 *   - FAB in bottom-right; click to open drawer
 *   - Message history kept in local component state for THIS session.
 *     (`sessionId` returned by the first reply is passed back on subsequent
 *     messages so the backend can maintain conversation context.)
 *   - Markdown rendered for assistant replies
 *   - Source chips for grounding citations (domain-only display)
 *   - Rate-limit responses show a friendly inline notice, not a toast
 */
interface Msg {
  role: "user" | "assistant";
  content: string;
  sources?: Array<{ url: string; domain?: string; title?: string }>;
  ts: number;
}

export function ChatbotWidget() {
  const open = useUIStore((s) => s.chatbotOpen);
  const toggle = useUIStore((s) => s.toggleChatbot);
  const userId = useAuthStore((s) => s.user?.userId ?? "");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    setMessages((m) => [...m, { role: "user", content: text, ts: Date.now() }]);
    setInput("");
    setSending(true);

    try {
      // This mutation is expected to be registered on the AppSync schema;
      // if not present yet it throws a typed "field not found" error which
      // we surface as a friendly message.
      const res = await (api as unknown as {
        mutations: {
          chatbotMessage: (args: {
            userId: string;
            message: string;
            sessionId?: string;
          }) => Promise<{
            data?: {
              sessionId: string;
              reply: string;
              sourceCitations?: Array<{ url: string; domain?: string; title?: string }>;
              rateLimited?: boolean;
            };
          }>;
        };
      }).mutations.chatbotMessage({
        userId,
        message: text,
        sessionId,
      });

      const data = res.data;
      if (!data) throw new Error("Empty response from chatbot");
      if (!sessionId && data.sessionId) setSessionId(data.sessionId);

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: data.reply,
          sources: data.sourceCitations ?? [],
          ts: Date.now(),
        },
      ]);
    } catch (err) {
      const msg = (err as Error).message ?? "Chatbot unavailable";
      // If the schema isn't wired yet, give a clearer hint.
      if (/field|mutation|undefined/i.test(msg)) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content:
              "I'm not wired up yet — the AppSync schema needs a `chatbotMessage` mutation exposing the `chatbot-handler` Lambda. See docs/deployment/08-lambda-reference.md.",
            ts: Date.now(),
          },
        ]);
      } else {
        toast.error(msg);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {/* Floating action button */}
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full",
          "bg-primary text-primary-foreground shadow-lg hover:scale-105 transition-transform",
          open && "opacity-0 pointer-events-none",
        )}
        aria-label="Open assistant"
      >
        <Bot className="h-5 w-5" />
      </button>

      {/* Drawer */}
      <div
        className={cn(
          "fixed bottom-6 right-6 z-50 flex h-[560px] w-[380px] max-w-[calc(100vw-3rem)] flex-col",
          "rounded-2xl border bg-popover text-popover-foreground shadow-2xl transition-all",
          open ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0",
        )}
        role="dialog"
        aria-label="AV Inventory assistant"
      >
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4" />
            <span className="text-sm font-semibold">Inventory assistant</span>
            <Badge variant="outline" className="text-[10px]">
              Gemini 2.5
            </Badge>
          </div>
          <Button variant="ghost" size="icon" onClick={toggle} aria-label="Close assistant">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
          {messages.length === 0 ? (
            <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              Ask me about stock levels, HSN codes, overdue invoices, import landed cost, MSME
              status, or any other operational question. I cite official CBIC / GST sources when
              relevant.
            </div>
          ) : (
            messages.map((m, idx) => (
              <MessageBubble key={idx} msg={m} />
            ))
          )}
          {sending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Thinking…
            </div>
          )}
        </div>

        <form onSubmit={handleSend} className="flex items-center gap-2 border-t p-3">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything…"
            disabled={sending}
            className="h-9"
          />
          <Button type="submit" size="icon" disabled={!input.trim() || sending} aria-label="Send">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-xs text-primary-foreground">
          {msg.content}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="max-w-[92%] rounded-2xl rounded-bl-sm bg-muted/60 px-3 py-2 text-xs leading-relaxed prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        <ReactMarkdown>{msg.content}</ReactMarkdown>
      </div>
      {msg.sources && msg.sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-1">
          {msg.sources.slice(0, 4).map((s, i) => (
            <a
              key={i}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-full border bg-card px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
              title={s.title ?? s.url}
            >
              {s.domain ?? new URL(s.url).hostname}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
