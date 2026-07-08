import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { loadMessages, sendChatMessage } from "@/lib/ai-chat.functions";
import { useVoiceDictation } from "@/lib/useVoiceDictation";
import { Mic, MicOff, Send } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

export const Route = createFileRoute("/_authenticated/")({
  component: ChatPage,
});

const SUGGESTIONS = [
  "I have $1,240 in checking and $80 in cash",
  "Worked a Gist event tonight, $180",
  "Spent $22 on groceries",
  "Rent of $1,400 is due on the 1st",
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

  // Voice dictation with live streaming transcript
  // `committed` = what's locked into `input`; interim tail is appended for display only
  const committedRef = useRef<string>("");
  const [interim, setInterim] = useState("");

  const handleFinal = useCallback((text: string) => {
    const base = committedRef.current;
    const next = (base ? base + " " : "") + text.trim();
    committedRef.current = next;
    setInput(next);
    setInterim("");
  }, []);

  const handleInterim = useCallback((text: string) => {
    setInterim(text);
  }, []);

  const { listening, transcribing, start, stop } = useVoiceDictation({
    onFinal: handleFinal,
    onInterim: handleInterim,
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

  function submit() {
    const t = input.trim();
    if (!t || send.isPending) return;
    setInput("");
    send.mutate(t);
    inputRef.current?.focus();
  }

  const showEmpty = messages.length === 0 && !send.isPending;

  return (
    <div className="mx-auto flex h-[calc(100vh-6rem)] max-w-lg flex-col px-4">
      <header className="pt-8 pb-4">
        <h1 className="font-serif text-3xl">Calm</h1>
        <p className="text-sm text-muted-foreground mt-1">Talk to me like a person.</p>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 py-2">
        {showEmpty && (
          <div className="mt-8 space-y-6">
            <div className="rounded-3xl bg-card border border-border p-6">
              <p className="font-serif text-lg leading-relaxed">
                Hi. I'm here whenever you want to think about money out loud.
              </p>
              <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
                Try telling me your balances, a purchase you made, or a shift you worked.
              </p>
            </div>
            <div className="space-y-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => { setInput(s); inputRef.current?.focus(); }}
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

      <div className="sticky bottom-0 pt-4">
        <div className="rounded-3xl border border-border bg-card p-2 flex items-end gap-2 shadow-sm">
          <button
            onClick={toggleMic}
            className={`shrink-0 grid h-11 w-11 place-items-center rounded-2xl transition-colors ${
              listening ? "bg-clay text-clay-foreground animate-pulse" : "hover:bg-muted text-muted-foreground"
            }`}
            aria-label="Voice input"
          >
            {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
            rows={1}
            placeholder="Say anything…"
            className="flex-1 resize-none bg-transparent outline-none py-3 px-1 text-base placeholder:text-muted-foreground max-h-32"
          />
          <button
            onClick={submit}
            disabled={!input.trim() || send.isPending}
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
