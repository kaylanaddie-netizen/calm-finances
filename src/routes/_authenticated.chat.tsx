import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { loadMessages, sendChatMessage } from "@/lib/ai-chat.functions";
import { useVoiceDictation } from "@/lib/useVoiceDictation";
import { ArrowLeft, Mic, MicOff, Send } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({ meta: [{ title: "Talk to Calm" }] }),
  component: ChatPage,
});

const SUGGESTIONS = [
  "I have $1,240 in checking and $80 in cash",
  "Worked a Gist event tonight, $180",
  "Spent $22 on groceries",
  "I want to save $5,000 for an emergency fund",
];

function ChatPage() {
  const qc = useQueryClient();
  const loadFn = useServerFn(loadMessages);
  const sendFn = useServerFn(sendChatMessage);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: messages = [] } = useQuery({
    queryKey: ["messages"],
    queryFn: () => loadFn(),
  });

  const send = useMutation({
    mutationFn: async (text: string) => sendFn({ data: { text } }),
    onMutate: async (text) => {
      const prev = qc.getQueryData<any[]>(["messages"]) ?? [];
      qc.setQueryData(["messages"], [
        ...prev,
        { id: `tmp-${Date.now()}`, role: "user", content: text, created_at: new Date().toISOString() },
      ]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      qc.invalidateQueries({ queryKey: ["messages"] });
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, send.isPending]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const committedRef = useRef<string>("");
  const [interim, setInterim] = useState("");

  const submitText = useCallback((text: string) => {
    const t = text.trim();
    if (!t || send.isPending) return;
    setInput("");
    committedRef.current = "";
    setInterim("");
    send.mutate(t);
    inputRef.current?.focus();
  }, [send]);

  const handleFinal = useCallback((text: string) => {
    const base = committedRef.current;
    const next = (base ? base + " " : "") + text.trim();
    committedRef.current = next;
    setInput(next);
    setInterim("");
  }, []);

  const handleInterim = useCallback((text: string) => setInterim(text), []);

  const handleAutoStop = useCallback(() => {
    // fired by hook after prolonged silence -> auto-submit if we have content
    const t = committedRef.current.trim();
    if (t) submitText(t);
  }, [submitText]);

  const { listening, transcribing, start, stop } = useVoiceDictation({
    onFinal: handleFinal,
    onInterim: handleInterim,
    onAutoStop: handleAutoStop,
    onError: (m) => toast.error(m),
  });

  async function toggleMic() {
    if (listening) {
      await stop();
    } else {
      committedRef.current = input.trim();
      setInterim("");
      await start();
    }
  }

  async function submit() {
    if (listening) await stop();
    submitText(committedRef.current || input);
  }

  const displayValue = listening
    ? [committedRef.current, interim].filter(Boolean).join(committedRef.current && interim ? " " : "")
    : input;

  const showEmpty = messages.length === 0 && !send.isPending;

  return (
    <div className="mx-auto flex h-[calc(100vh-6rem)] max-w-lg flex-col px-4">
      <header className="pt-6 pb-4 flex items-center gap-3">
        <Link
          to="/"
          className="grid h-10 w-10 place-items-center rounded-2xl bg-muted text-muted-foreground hover:text-foreground"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="font-serif text-2xl leading-none">Calm</h1>
          <p className="text-xs text-muted-foreground mt-1">Talk to me like a person.</p>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 py-2">
        {showEmpty && (
          <div className="mt-4 space-y-6">
            <div className="rounded-3xl bg-card border border-border p-6">
              <p className="font-serif text-lg leading-relaxed">
                Tell me what's on your mind — a purchase, a shift, a worry.
              </p>
              <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                I'll quietly keep track so you don't have to.
              </p>
            </div>
            <div className="space-y-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => { setInput(s); committedRef.current = s; inputRef.current?.focus(); }}
                  className="w-full text-left rounded-2xl bg-muted/60 hover:bg-muted px-5 py-4 text-sm text-foreground/80 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m: any) => (
          <MessageBubble key={m.id} role={m.role} content={m.content} />
        ))}
        {send.isPending && (
          <div className="flex gap-2 px-1 text-muted-foreground text-sm">
            <span className="animate-pulse">Thinking…</span>
          </div>
        )}
      </div>

      {listening && (
        <div className="flex items-center gap-2 pb-2 px-2 text-xs text-clay-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-clay opacity-75 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-clay" />
          </span>
          <span>{transcribing ? "Transcribing…" : "Listening… pause to send."}</span>
        </div>
      )}

      <div className="sticky bottom-0 pt-2 pb-4">
        <div className="rounded-3xl border border-border bg-card p-2 flex items-end gap-2 shadow-sm">
          <button
            onClick={toggleMic}
            className={`shrink-0 grid h-11 w-11 place-items-center rounded-2xl transition-colors ${
              listening ? "bg-clay text-clay-foreground" : "hover:bg-muted text-muted-foreground"
            }`}
            aria-label={listening ? "Stop voice input" : "Start voice input"}
          >
            {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
          <textarea
            ref={inputRef}
            value={displayValue}
            onChange={(e) => {
              if (listening) return;
              setInput(e.target.value);
              committedRef.current = e.target.value;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); }
            }}
            rows={1}
            placeholder={listening ? "Speak naturally…" : "Say anything…"}
            className={`flex-1 resize-none bg-transparent outline-none py-3 px-1 text-base placeholder:text-muted-foreground max-h-32 leading-relaxed transition-colors ${
              listening && interim && !committedRef.current ? "text-foreground/70" : ""
            }`}
          />
          <button
            onClick={() => void submit()}
            disabled={!displayValue.trim() || send.isPending}
            className="shrink-0 grid h-11 w-11 place-items-center rounded-2xl bg-primary text-primary-foreground disabled:opacity-40"
            aria-label="Send"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ role, content }: { role: string; content: string }) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-primary text-primary-foreground px-5 py-3 text-base">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-[92%] text-foreground text-base leading-relaxed prose prose-sm prose-neutral">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
