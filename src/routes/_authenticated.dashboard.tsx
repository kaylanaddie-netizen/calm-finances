import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { loadDashboard } from "@/lib/ai-chat.functions";
import { supabase } from "@/integrations/supabase/client";
import { LogOut } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Calm" }] }),
  component: Dashboard,
});

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

function Dashboard() {
  const loadFn = useServerFn(loadDashboard);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => loadFn(),
  });

  if (isLoading || !data) {
    return <div className="p-8 text-muted-foreground text-sm">Loading…</div>;
  }

  const emergencyPct = data.activeGoal?.target_amount
    ? Math.min(100, (data.emergency / Number(data.activeGoal.target_amount)) * 100)
    : Math.min(100, (data.emergency / Math.max(1, data.netWorth || 1)) * 100);

  return (
    <div className="mx-auto max-w-lg px-5 pt-8 pb-6 space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Where you are</p>
          <h1 className="font-serif text-3xl mt-1">Dashboard</h1>
        </div>
        <button
          onClick={() => supabase.auth.signOut()}
          className="grid h-10 w-10 place-items-center rounded-2xl bg-muted text-muted-foreground hover:text-foreground"
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </header>

      <Card>
        <p className="text-sm text-muted-foreground">Net worth</p>
        <p className="font-serif text-5xl mt-1">{fmt(Number(data.netWorth))}</p>
        {data.accounts.length > 0 && (
          <div className="mt-4 space-y-2">
            {data.accounts.map((a: any) => (
              <div key={a.id} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{a.name}</span>
                <span className="font-medium">{fmt(Number(a.balance))}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {data.activeGoal && (
        <Card accent="sage">
          <p className="text-sm text-sage-foreground/80">Current goal</p>
          <p className="font-serif text-2xl mt-1">{data.activeGoal.name}</p>
          {data.activeGoal.target_amount && (
            <>
              <div className="mt-3 h-2 rounded-full bg-white/50 overflow-hidden">
                <div
                  className="h-full bg-sage-foreground/70 rounded-full"
                  style={{ width: `${Math.min(100, (Number(data.activeGoal.current_amount) / Number(data.activeGoal.target_amount)) * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-sm text-sage-foreground/80">
                {fmt(Number(data.activeGoal.current_amount))} of {fmt(Number(data.activeGoal.target_amount))}
              </p>
            </>
          )}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Card small>
          <p className="text-xs text-muted-foreground">Emergency fund</p>
          <p className="font-serif text-2xl mt-1">{fmt(data.emergency)}</p>
          <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-sage rounded-full" style={{ width: `${emergencyPct}%` }} />
          </div>
        </Card>
        <Card small>
          <p className="text-xs text-muted-foreground">This month spent</p>
          <p className="font-serif text-2xl mt-1">{fmt(data.weeklySpend)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Weekly allowance guidance appears here as Calm learns your patterns.</p>
        </Card>
      </div>

      <Section title="Expected income">
        {data.expected.length === 0 ? (
          <Empty text="Nothing expected yet. Tell Calm about a shift or invoice." />
        ) : (
          <div className="space-y-2">
            {data.expected.map((p: any) => (
              <Row
                key={p.id}
                left={p.client_name}
                sub={fmtDate(p.expected_date)}
                right={fmt(Number(p.expected_amount))}
                warn={p.status === "overdue"}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Monthly income by source">
        {Object.keys(data.monthlyIncomeBySource).length === 0 ? (
          <Empty text="No income logged this month yet." />
        ) : (
          <div className="space-y-2">
            {Object.entries(data.monthlyIncomeBySource).map(([k, v]) => (
              <Row key={k} left={k} right={fmt(Number(v))} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Upcoming bills">
        {data.bills.length === 0 ? (
          <Empty text="No bills tracked." />
        ) : (
          <div className="space-y-2">
            {data.bills.map((b: any) => (
              <Row key={b.id} left={b.name} sub={fmtDate(b.due_date)} right={fmt(Number(b.amount))} />
            ))}
          </div>
        )}
      </Section>

      {data.tiers.length > 0 && (
        <Section title="Your financial tiers">
          <div className="space-y-2">
            {data.tiers.map((t: any) => (
              <div key={t.id} className="rounded-2xl bg-card border border-border p-4">
                <p className="font-serif text-lg">{t.name}</p>
                {t.goal && <p className="text-sm text-muted-foreground mt-1">{t.goal}</p>}
                {t.description && <p className="text-sm mt-2">{t.description}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Card({ children, accent, small }: { children: React.ReactNode; accent?: "sage" | "clay"; small?: boolean }) {
  const cls = accent === "sage" ? "bg-sage/40" : accent === "clay" ? "bg-clay/30" : "bg-card";
  return <div className={`rounded-3xl ${cls} border border-border ${small ? "p-4" : "p-6"}`}>{children}</div>;
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
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}{warn ? " · overdue" : ""}</p>}
      </div>
      <p className="font-medium tabular-nums">{right}</p>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground text-center">{text}</div>;
}
