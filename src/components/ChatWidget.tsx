import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { MessageCircle, X, Send, Loader2, Sparkles } from "lucide-react";
import { askAssistant } from "@/lib/chat.functions";

type ChatMessage = { role: "user" | "assistant"; text: string };

const API_KEY_STORAGE_KEY = "miu-slide-studio:groq-api-key";

export function ChatWidget({
  contextLabel,
  contextSummary,
}: {
  contextLabel: string;
  contextSummary: string;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, open]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    let apiKey = "";
    try {
      apiKey = localStorage.getItem(API_KEY_STORAGE_KEY) || "";
    } catch {
      // ignore
    }

    const nextMessages: ChatMessage[] = [...messages, { role: "user", text }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    try {
      const { reply } = await askAssistant({
        data: {
          apiKey,
          contextLabel,
          contextSummary,
          history: messages,
          message: text,
        },
      });
      setMessages((prev) => [...prev, { role: "assistant", text: reply }]);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Couldn't reach the assistant.";
      const rateLimitMatch = /^RATE_LIMITED::(\d+)::(.*)$/s.exec(message);
      toast.error(rateLimitMatch ? rateLimitMatch[2] : message);
      setMessages((prev) => prev.slice(0, -1));
      setInput(text);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        whileTap={{ scale: 0.94 }}
        aria-label={open ? "Close AI assistant" : "Open AI assistant"}
        className="print-hide fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg hover:shadow-xl transition-shadow"
      >
        {open ? (
          <X className="h-5 w-5 sm:h-6 sm:w-6" />
        ) : (
          <MessageCircle className="h-5 w-5 sm:h-6 sm:w-6" />
        )}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            className="print-hide fixed bottom-20 right-4 sm:bottom-24 sm:right-6 z-40 flex h-[70vh] max-h-[520px] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl"
          >
            <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-3">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">Ask the assistant</p>
                {contextLabel && (
                  <p className="text-[11px] text-muted-foreground truncate">
                    {contextLabel}
                  </p>
                )}
              </div>
            </div>

            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-3 space-y-2"
            >
              {messages.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6 px-4">
                  Ask a question about what you're viewing — "explain this in
                  simpler terms", "give me a real-world example", or anything
                  else.
                </p>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="rounded-xl bg-muted px-3 py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
            </div>

            <form
              onSubmit={handleSend}
              className="flex items-center gap-2 border-t p-3"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question…"
                disabled={sending}
                className="flex-1 min-w-0 rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                aria-label="Send"
                className="shrink-0 flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
