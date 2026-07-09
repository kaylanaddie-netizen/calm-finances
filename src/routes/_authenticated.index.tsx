import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { loadDashboard } from "@/lib/ai-chat.functions";
import { supabase } from "@/integrations/supabase/client";
import { ArrowUpRight, LogOut, MessageCircle, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Calm — Your Financial Companion" }] }),
  component: Home,
});

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtDate = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Hi there.";
  if (h < 12) return "Good morning.";
  if (h < 18) return "Good afternoon.";
  return "Good evening.";
}

function Home() {
  const loadFn = useServerFn(loadDashboard);
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: () => loadFn() });

  if (isLoading || !data) {
    return <div className="mx-auto max-w-lg p-8 text-muted-foreground text-sm">Getting things in order…</div>;
  }

  const focus = pickFocus(data);

  return (
    <div className="mx-auto max-w-lg px-5 pt-8 pb-8 space-y-5">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{greeting()}</p>
          <h1 className="font-serif text-3xl mt-1">Here's where you are.</h1>
        </div>
        <button
          onClick={() => supabase.auth.signOut()}
          className="grid h-10 w-10 place-items-center rounded-2xl bg-muted text-muted-foreground hover:text-foreground"
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </header>

      {/* Current cash — hero */}
      <Card>
        <p className="text-sm text-muted-foreground">Current cash</p>
        <p className="font-serif text-5xl mt-1 tabular-nums">{fmt(data.cash)}</p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <MiniStat label="In 7 days" value={fmt(Math.round(data.cashIn7))} />
          <MiniStat label="In 30 days" value={fmt(Math.round(data.cashIn30))} />
        </div>
      </Card>

      <Card accent="sage">
        <div className="flex items-center gap-2 text-sage-foreground/80 text-sm">
          <Sparkles className="h-4 w-4" />
          Safe to spend today
        </div>
        <p className="font-serif text-4xl mt-1 tabular-nums">{fmt(data.safeToday)}</p>
        {focus && (
          <p className="mt-3 text-sm text-sage-foreground/90 leading-relaxed">{focus}</p>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card small>
          <p className="text-xs text-muted-foreground">Upcoming income</p>
          {data.nextIncome ? (
            <>
              <p className="font-serif text-2xl mt-1 tabular-nums">{fmt(Number(data.nextIncome.expected_amount))}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.nextIncome.client_name} · {fmtDate(data.nextIncome.expected_date)}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Nothing expected yet.</p>
          )}
        </Card>
        <Card small>
          <p className="text-xs text-muted-foreground">Bills this week</p>
          <p className="font-serif text-2xl mt-1 tabular-nums">
            {fmt(data.upcomingBills.reduce((s, b) => s + Number(b.amount), 0))}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.upcomingBills.length ? `${data.upcomingBills.length} due` : "None due"}
          </p>
        </Card>
      </div>

      {/* Talk to Calm */}
      <Link
        to="/chat"
        className="flex items-center justify-between rounded-3xl bg-primary text-primary-foreground px-6 py-5 shadow-sm hover:opacity-95 transition-opacity"
      >
        <div className="flex items-center gap-3">
          <MessageCircle className="h-5 w-5" />
          <span className="font-serif text-xl">Talk to Calm</span>
        </div>
        <ArrowUpRight className="h-5 w-5" />
      </Link>

      {data.difficultBills.length > 0 && (
        <Section title="Bills that may be tight">
          <div className="space-y-2">
            {data.difficultBills.map((b) => (
              <Row key={b.name + b.due_date} left={b.name} sub={fmtDate(b.due_date)} right={fmt(Number(b.amount))} warn />
            ))}
          </div>
        </Section>
      )}

      <Section title="Emergency fund">
        <Card small>
          <p className="font-serif text-2xl tabular-nums">{fmt(data.emergency)}</p>
          <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-sage rounded-full"
              style={{ width: `${Math.min(100, (data.emergency / Math.max(1, data.netWorth || 1)) * 100)}%` }}
            />
          </div>
        </Card>
      </Section>

      <Section title="This month">
        <Card small>
          <div className="flex items-baseline justify-between">
            <p className="font-serif text-2xl tabular-nums">{fmt(data.monthSpend)} spent</p>
            <TrendBadge current={data.monthSpend} previous={data.lastMonthSpend} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{fmt(data.weekSpend)} in the last 7 days</p>
        </Card>
      </Section>

      {data.expected.length > 0 && (
        <Section title="Expected payments">
          <div className="space-y-2">
            {data.expected.map((p) => (
              <Row
                key={p.client_name + p.expected_date}
                left={p.client_name}
                sub={fmtDate(p.expected_date)}
                right={fmt(Number(p.expected_amount))}
                warn={p.status === "overdue"}
              />
            ))}
          </div>
        </Section>
      )}

      <Section title="Current goals">
        {data.goals.length === 0 ? (
          <Empty text="No goals yet. Tell Calm what you're working toward." />
        ) : (
          <div className="space-y-2">
            {data.goals.map((g) => (
              <div key={g.id} className="rounded-2xl bg-card border border-border p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-serif text-lg">{g.name}</p>
                  {g.pct !== null && <p className="text-sm text-muted-foreground">{g.pct}%</p>}
                </div>
                {g.target_amount ? (
                  <>
                    <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${g.pct ?? 0}%` }}
                      />
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground tabular-nums">
                      {fmt(Number(g.current_amount))} of {fmt(Number(g.target_amount))}
                    </p>
                    {g.eta && (
                      <p className="text-xs text-muted-foreground mt-0.5">Estimated {g.eta}</p>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">Working on it.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function pickFocus(d: {
  safeToday: number;
  difficultBills: Array<{ name: string; due_date: string; amount: number }>;
  nextIncome: { client_name: string; expected_date: string } | undefined;
  goals: Array<{ name: string; pct: number | null; target_amount: number | null }>;
  monthSpend: number;
  lastMonthSpend: number;
}): string | null {
  if (d.difficultBills.length > 0) {
    const b = d.difficultBills[0];
    return `Heads up: ${b.name} may be tight on ${fmtDate(b.due_date)}.`;
  }
  if (d.safeToday === 0) {
    return "Try to hold off on non-essentials today. You'll have more room after your next paycheck.";
  }
  if (d.nextIncome) {
    return `Your ${d.nextIncome.client_name} payment should arrive ${fmtDate(d.nextIncome.expected_date)}.`;
  }
  const g = d.goals.find((g) => (g.pct ?? 0) < 100 && g.target_amount);
  if (g) return `You're ${g.pct}% of the way to ${g.name}. Small deposits add up.`;
  if (d.lastMonthSpend > 0 && d.monthSpend < d.lastMonthSpend * 0.8) {
    return "You're spending less than last month. Nice.";
  }
  return "You're in a calm spot. Keep going.";
}

function Card({ children, accent, small }: { children: React.ReactNode; accent?: "sage" | "clay"; small?: boolean }) {
  const cls = accent === "sage" ? "bg-sage/40" : accent === "clay" ? "bg-clay/30" : "bg-card";
  return <div className={`rounded-3xl ${cls} border border-border ${small ? "p-4" : "p-6"}`}>{children}</div>;
}
function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-background/60 border border-border/60 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-serif text-lg tabular-nums mt-0.5">{value}</p>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-sans font-medium mb-3 px-1">{title}</h2>
      {children}
    </section>
  );
}
function Row({ left, sub, right, warn }: { left: string; sub?: string; right: string; warn?: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-2xl px-4 py-3 border ${warn ? "border-destructive/40 bg-destructive/5" : "border-border bg-card"}`}>
      <div>
        <p className="text-sm font-medium">{left}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}{warn ? " · needs attention" : ""}</p>}
      </div>
      <p className="font-medium tabular-nums">{right}</p>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground text-center">{text}</div>;
}
function TrendBadge({ current, previous }: { current: number; previous: number }) {
  if (previous <= 0) return null;
  const diff = current - previous;
  const pct = Math.round((diff / previous) * 100);
  const good = diff <= 0;
  return (
    <span className={`text-xs rounded-full px-2 py-0.5 ${good ? "bg-sage/40 text-sage-foreground" : "bg-clay/30 text-clay-foreground"}`}>
      {good ? "↓" : "↑"} {Math.abs(pct)}% vs last month
    </span>
  );
}
