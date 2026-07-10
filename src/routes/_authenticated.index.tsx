import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  loadDashboard,
  reorderGoals,
  deleteGoal,
  updateExpectedPayment,
  deleteExpectedPayment,
} from "@/lib/ai-chat.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  LogOut,
  MessageCircle,
  Pencil,
  Sparkles,
  Trash2,
  Check,
  X,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Calm — Your Financial Companion" }] }),
  component: Home,
});

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtDate = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Hi there.";
  if (h < 12) return "Good morning.";
  if (h < 18) return "Good afternoon.";
  return "Good evening.";
}

type Goal = {
  id: string;
  name: string;
  target_amount: number | null;
  current_amount: number;
  pct: number | null;
  eta: string | null;
};

type Expected = {
  id: string;
  client_name: string;
  expected_amount: number;
  expected_date: string;
  status: string;
};

function Home() {
  const loadFn = useServerFn(loadDashboard);
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: () => loadFn() });

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-lg p-8 text-muted-foreground text-sm">
        Getting things in order…
      </div>
    );
  }

  const colors: Record<string, string> = data.elementColors ?? {};
  const order: string[] = data.sectionOrder ?? [
    "net_worth","accounts","safe_to_spend","income_bills","talk_to_calm","goals","expected_payments",
  ];

  const sections: Record<string, React.ReactNode> = {
    net_worth: (
      <Card key="net_worth" bgColor={colors.net_worth}>
        <p className="text-sm text-muted-foreground">Net worth</p>
        <p className="font-serif text-5xl mt-1 tabular-nums">{fmt(data.netWorth)}</p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <MiniStat label="Cash" value={fmt(data.cash)} />
          <MiniStat label="Emergency" value={fmt(data.emergency)} />
        </div>
      </Card>
    ),
    accounts: (
      <Section key="accounts" title="Your accounts">
        {data.accounts.length === 0 ? (
          <Empty text="Tell Calm about your accounts and balances." />
        ) : (
          <div className="space-y-2">
            {data.accounts.map((a: any) => (
              <Row
                key={a.id}
                left={a.name}
                sub={a.is_emergency_fund ? "Emergency fund" : undefined}
                right={fmt(Number(a.balance))}
              />
            ))}
          </div>
        )}
      </Section>
    ),
    safe_to_spend: (
      <Card key="safe_to_spend" accent="sage" bgColor={colors.safe_to_spend}>
        <div className="flex items-center gap-2 text-sage-foreground/80 text-sm">
          <Sparkles className="h-4 w-4" />
          Safe to spend today
        </div>
        <p className="font-serif text-4xl mt-1 tabular-nums">{fmt(data.safeToday)}</p>
      </Card>
    ),
    income_bills: (
      <div key="income_bills" className="grid grid-cols-2 gap-3">
        <Card small bgColor={colors.upcoming_income}>
          <p className="text-xs text-muted-foreground">Upcoming income</p>
          {data.nextIncome ? (
            <>
              <p className="font-serif text-2xl mt-1 tabular-nums">
                {fmt(Number(data.nextIncome.expected_amount))}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.nextIncome.client_name} · {fmtDate(data.nextIncome.expected_date)}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Nothing expected yet.</p>
          )}
        </Card>
        <Card small bgColor={colors.bills_this_week}>
          <p className="text-xs text-muted-foreground">Bills this week</p>
          <p className="font-serif text-2xl mt-1 tabular-nums">
            {fmt(data.upcomingBills.reduce((s: number, b: any) => s + Number(b.amount), 0))}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.upcomingBills.length ? `${data.upcomingBills.length} due` : "None due"}
          </p>
        </Card>
      </div>
    ),
    talk_to_calm: (
      <Link
        key="talk_to_calm"
        to="/chat"
        style={colors.talk_to_calm ? { backgroundColor: colors.talk_to_calm } : undefined}
        className={`flex items-center justify-between rounded-3xl px-6 py-5 shadow-sm hover:opacity-95 transition-opacity ${
          colors.talk_to_calm ? "text-foreground" : "bg-primary text-primary-foreground"
        }`}
      >
        <div className="flex items-center gap-3">
          <MessageCircle className="h-5 w-5" />
          <span className="font-serif text-xl">Talk to Calm</span>
        </div>
        <ArrowUpRight className="h-5 w-5" />
      </Link>
    ),
    goals: <GoalsSection key="goals" goals={data.goals as Goal[]} />,
    expected_payments: <ExpectedSection key="expected_payments" expected={data.expected as Expected[]} />,
  };

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

      {order.map((k) => sections[k]).filter(Boolean)}
    </div>
  );
}

/* ---------------- Goals with reorder / delete ---------------- */

function GoalsSection({ goals }: { goals: Goal[] }) {
  const qc = useQueryClient();
  const reorderFn = useServerFn(reorderGoals);
  const deleteFn = useServerFn(deleteGoal);
  const [order, setOrder] = useState<Goal[]>(goals);

  useEffect(() => {
    setOrder(goals);
  }, [goals]);

  const reorderMut = useMutation({
    mutationFn: (ids: string[]) => reorderFn({ data: { orderedIds: ids } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...order];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setOrder(next);
    reorderMut.mutate(next.map((g) => g.id));
  };

  return (
    <Section title="Current goals">
      <p className="text-xs text-muted-foreground mb-2 px-1">
        Drag with the arrows to prioritize. Calm follows this order.
      </p>
      {order.length === 0 ? (
        <Empty text="No goals yet. Tell Calm what you're working toward." />
      ) : (
        <div className="space-y-2">
          {order.map((g, idx) => {
            const remaining =
              g.target_amount != null
                ? Math.max(0, Number(g.target_amount) - Number(g.current_amount))
                : null;
            return (
              <div
                key={g.id}
                className="rounded-2xl bg-card border border-border p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="flex flex-col gap-1 pt-0.5">
                    <button
                      onClick={() => move(idx, -1)}
                      disabled={idx === 0}
                      className="grid h-6 w-6 place-items-center rounded-md hover:bg-muted disabled:opacity-30"
                      aria-label="Move up"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => move(idx, 1)}
                      disabled={idx === order.length - 1}
                      className="grid h-6 w-6 place-items-center rounded-md hover:bg-muted disabled:opacity-30"
                      aria-label="Move down"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-serif text-lg truncate">
                        <span className="text-muted-foreground text-sm mr-2 tabular-nums">
                          #{idx + 1}
                        </span>
                        {g.name}
                      </p>
                      {g.pct !== null && (
                        <p className="text-sm text-muted-foreground">{g.pct}%</p>
                      )}
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
                          {remaining !== null && remaining > 0 && (
                            <span> · {fmt(remaining)} to go</span>
                          )}
                        </p>
                        {g.eta && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Estimated {g.eta}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-muted-foreground">Working on it.</p>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      if (confirm(`Remove goal "${g.name}"?`)) deleteMut.mutate(g.id);
                    }}
                    className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-muted"
                    aria-label="Remove goal"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/* ---------------- Expected payments (editable) ---------------- */

function ExpectedSection({ expected }: { expected: Expected[] }) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateExpectedPayment);
  const deleteFn = useServerFn(deleteExpectedPayment);
  const [editingId, setEditingId] = useState<string | null>(null);

  const updateMut = useMutation({
    mutationFn: (input: {
      id: string;
      client_name: string;
      expected_amount: number;
      expected_date: string;
    }) => updateFn({ data: input }),
    onSuccess: () => {
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  if (expected.length === 0) return null;

  return (
    <Section title="Expected payments">
      <p className="text-xs text-muted-foreground mb-2 px-1">
        Edit or remove any duplicates.
      </p>
      <div className="space-y-2">
        {expected.map((p) =>
          editingId === p.id ? (
            <EditExpectedRow
              key={p.id}
              payment={p}
              onCancel={() => setEditingId(null)}
              onSave={(patch) => updateMut.mutate({ id: p.id, ...patch })}
              saving={updateMut.isPending}
            />
          ) : (
            <div
              key={p.id}
              className={`flex items-center justify-between rounded-2xl px-4 py-3 border ${
                p.status === "overdue"
                  ? "border-destructive/40 bg-destructive/5"
                  : "border-border bg-card"
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{p.client_name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {fmtDate(p.expected_date)}
                  {p.status === "overdue" ? " · overdue" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <p className="font-medium tabular-nums">
                  {fmt(Number(p.expected_amount))}
                </p>
                <button
                  onClick={() => setEditingId(p.id)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
                  aria-label="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete expected payment from ${p.client_name}?`))
                      deleteMut.mutate(p.id);
                  }}
                  className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-muted"
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ),
        )}
      </div>
    </Section>
  );
}

function EditExpectedRow({
  payment,
  onCancel,
  onSave,
  saving,
}: {
  payment: Expected;
  onCancel: () => void;
  onSave: (patch: {
    client_name: string;
    expected_amount: number;
    expected_date: string;
  }) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(payment.client_name);
  const [amount, setAmount] = useState(String(payment.expected_amount));
  const [date, setDate] = useState(payment.expected_date);

  return (
    <div className="rounded-2xl border border-border bg-card p-3 space-y-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="From"
        className="w-full rounded-lg bg-background border border-border px-3 py-2 text-sm"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
          className="rounded-lg bg-background border border-border px-3 py-2 text-sm tabular-nums"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg bg-background border border-border px-3 py-2 text-sm"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted text-muted-foreground"
          aria-label="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
        <button
          disabled={saving || !name.trim() || !amount || !date}
          onClick={() =>
            onSave({
              client_name: name.trim(),
              expected_amount: Number(amount),
              expected_date: date,
            })
          }
          className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
          aria-label="Save"
        >
          <Check className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/* ---------------- Primitives ---------------- */

function Card({
  children,
  accent,
  small,
}: {
  children: React.ReactNode;
  accent?: "sage" | "clay";
  small?: boolean;
}) {
  const cls =
    accent === "sage" ? "bg-sage/40" : accent === "clay" ? "bg-clay/30" : "bg-card";
  return (
    <div
      className={`rounded-3xl ${cls} border border-border ${small ? "p-4" : "p-6"}`}
    >
      {children}
    </div>
  );
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
      <h2 className="text-xs uppercase tracking-widest text-muted-foreground font-sans font-medium mb-3 px-1">
        {title}
      </h2>
      {children}
    </section>
  );
}
function Row({
  left,
  sub,
  right,
}: {
  left: string;
  sub?: string;
  right: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl px-4 py-3 border border-border bg-card">
      <div>
        <p className="text-sm font-medium">{left}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      <p className="font-medium tabular-nums">{right}</p>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground text-center">
      {text}
    </div>
  );
}
