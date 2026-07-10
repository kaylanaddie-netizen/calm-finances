import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "openai/gpt-5.5";

const SendInput = z.object({ text: z.string().min(1).max(4000) });

type ToolFn = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

const TOOLS: ToolFn[] = [
  {
    type: "function",
    function: {
      name: "update_account_balance",
      description: "Create or update a bank/cash account balance for the user.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          balance: { type: "number" },
          is_emergency_fund: { type: "boolean" },
        },
        required: ["name", "balance"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "log_transaction",
      description: "Log a completed income or expense that already happened.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["income", "expense"] },
          amount: { type: "number" },
          description: { type: "string" },
          category: { type: "string" },
          client_name: { type: "string" },
          occurred_on: { type: "string", description: "YYYY-MM-DD; omit for today" },
        },
        required: ["kind", "amount", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_expected_payment",
      description: "Record an incoming payment the user is expecting but hasn't received yet.",
      parameters: {
        type: "object",
        properties: {
          client_name: { type: "string" },
          expected_amount: { type: "number" },
          expected_date: { type: "string" },
          note: { type: "string" },
        },
        required: ["client_name", "expected_amount", "expected_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "upsert_client",
      description: "Remember an employer or client and their typical pay behavior.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          typical_pay_delay_days: { type: "number" },
          typical_amount: { type: "number" },
          is_recurring: { type: "boolean" },
          notes: { type: "string" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_payment_received",
      description: "Mark an expected payment as received.",
      parameters: {
        type: "object",
        properties: {
          client_name: { type: "string" },
          actual_amount: { type: "number" },
        },
        required: ["client_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_bill",
      description: "Add an upcoming bill.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: "number" },
          due_date: { type: "string" },
          recurring: { type: "string", enum: ["monthly", "weekly", "yearly"] },
        },
        required: ["name", "amount", "due_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_goal",
      description:
        "Create or update a financial goal. ONLY call this when the user explicitly states a goal (e.g. 'I want to save $X', 'my goal is…', 'pay off…'). NEVER infer goals from moods, expenses, or casual remarks.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          target_amount: { type: "number" },
          current_amount: { type: "number" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_goal_progress",
      description: "Update the current_amount on an existing goal by name.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          current_amount: { type: "number" },
        },
        required: ["name", "current_amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_fact",
      description:
        "Save a long-term fact about the user so Calm doesn't have to ask again. Use categories: merchant, employer, subscription, paycheck_pattern, bill_pattern, preference, habit, fear, goal_context, communication_style.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string" },
          key: { type: "string", description: "Short stable identifier, e.g. 'starbucks', 'instawork', 'coffee_habit'" },
          value: { type: "string", description: "The remembered fact in plain language." },
          confidence: { type: "number", description: "0.0 - 1.0" },
        },
        required: ["category", "key", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "forget_fact",
      description: "Remove a previously remembered fact by category and key.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string" },
          key: { type: "string" },
        },
        required: ["category", "key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reorder_home_sections",
      description:
        "Reorder the visible sections on the user's home dashboard. Provide the FULL ordered list of section keys as the user wants them from top to bottom. Valid keys: 'net_worth', 'accounts', 'safe_to_spend', 'income_bills', 'talk_to_calm', 'goals', 'expected_payments'. Include every key exactly once.",
      parameters: {
        type: "object",
        properties: {
          order: { type: "array", items: { type: "string" } },
        },
        required: ["order"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reorder_accounts",
      description:
        "Reorder the accounts list on the home dashboard. Provide the FULL ordered list of account names (case-insensitive) as they should appear top to bottom. Missing accounts fall to the bottom in their existing order.",
      parameters: {
        type: "object",
        properties: {
          names: { type: "array", items: { type: "string" } },
        },
        required: ["names"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_element_color",
      description:
        "Change the background color of a home dashboard element. Valid element keys: 'talk_to_calm', 'net_worth', 'safe_to_spend', 'upcoming_income', 'bills_this_week'. Color must be a CSS color string like '#f9a8d4', 'pink', 'hsl(320 80% 80%)'. Pass color='' to reset to default.",
      parameters: {
        type: "object",
        properties: {
          element: { type: "string" },
          color: { type: "string" },
        },
        required: ["element", "color"],
      },
    },
  },
];

async function runTool(
  name: string,
  args: Record<string, unknown>,
  supabase: any,
  userId: string,
): Promise<string> {
  try {
    switch (name) {
      case "update_account_balance": {
        const { data: existing } = await supabase
          .from("accounts").select("id")
          .eq("user_id", userId).ilike("name", String(args.name)).maybeSingle();
        if (existing) {
          await supabase.from("accounts").update({
            balance: args.balance,
            is_emergency_fund: args.is_emergency_fund ?? undefined,
            updated_at: new Date().toISOString(),
          }).eq("id", existing.id);
        } else {
          await supabase.from("accounts").insert({
            user_id: userId, name: args.name, balance: args.balance,
            is_emergency_fund: args.is_emergency_fund ?? false,
          });
        }
        return `ok: account '${args.name}' set to ${args.balance}`;
      }
      case "log_transaction": {
        let clientId: string | null = null;
        if (args.client_name) {
          const { data: c } = await supabase.from("clients").select("id")
            .eq("user_id", userId).ilike("name", String(args.client_name)).maybeSingle();
          clientId = c?.id ?? null;
        }
        await supabase.from("transactions").insert({
          user_id: userId, kind: args.kind, amount: args.amount,
          description: args.description, category: args.category ?? null,
          client_id: clientId,
          occurred_on: args.occurred_on ?? new Date().toISOString().slice(0, 10),
        });
        return `ok: ${args.kind} of ${args.amount} logged`;
      }
      case "add_expected_payment": {
        const { data: c } = await supabase.from("clients").select("id")
          .eq("user_id", userId).ilike("name", String(args.client_name)).maybeSingle();
        const { data: dup } = await supabase.from("expected_payments").select("id")
          .eq("user_id", userId)
          .ilike("client_name", String(args.client_name))
          .eq("expected_date", String(args.expected_date))
          .eq("expected_amount", Number(args.expected_amount))
          .in("status", ["pending", "overdue"])
          .maybeSingle();
        if (dup) return `already tracking that expected payment`;
        await supabase.from("expected_payments").insert({
          user_id: userId, client_id: c?.id ?? null,
          client_name: args.client_name,
          expected_amount: args.expected_amount,
          expected_date: args.expected_date,
          note: args.note ?? null,
          status: "pending",
        });
        return `ok: expecting ${args.expected_amount} from ${args.client_name} on ${args.expected_date}`;
      }
      case "upsert_client": {
        const { data: existing } = await supabase.from("clients").select("id")
          .eq("user_id", userId).ilike("name", String(args.name)).maybeSingle();
        if (existing) {
          await supabase.from("clients").update({
            typical_pay_delay_days: args.typical_pay_delay_days ?? undefined,
            typical_amount: args.typical_amount ?? undefined,
            is_recurring: args.is_recurring ?? undefined,
            notes: args.notes ?? undefined,
            updated_at: new Date().toISOString(),
          }).eq("id", existing.id);
        } else {
          await supabase.from("clients").insert({
            user_id: userId, name: args.name,
            typical_pay_delay_days: args.typical_pay_delay_days ?? null,
            typical_amount: args.typical_amount ?? null,
            is_recurring: args.is_recurring ?? false,
            notes: args.notes ?? null,
          });
        }
        return `ok: client '${args.name}' saved`;
      }
      case "mark_payment_received": {
        const { data: p } = await supabase.from("expected_payments").select("id, expected_amount")
          .eq("user_id", userId).eq("status", "pending")
          .ilike("client_name", String(args.client_name))
          .order("expected_date").limit(1).maybeSingle();
        if (!p) return `no pending payment found for ${args.client_name}`;
        await supabase.from("expected_payments").update({
          status: "received", updated_at: new Date().toISOString(),
        }).eq("id", p.id);
        const amount = args.actual_amount ?? p.expected_amount;
        await supabase.from("transactions").insert({
          user_id: userId, kind: "income", amount,
          description: `Payment from ${args.client_name}`,
        });
        return `ok: marked ${args.client_name} payment received`;
      }
      case "add_bill": {
        await supabase.from("bills").insert({
          user_id: userId, name: args.name, amount: args.amount,
          due_date: args.due_date, recurring: args.recurring ?? null,
        });
        return `ok: bill '${args.name}' added`;
      }
      case "set_goal": {
        const { data: existing } = await supabase.from("goals").select("id")
          .eq("user_id", userId).ilike("name", String(args.name)).maybeSingle();
        if (existing) {
          await supabase.from("goals").update({
            target_amount: args.target_amount ?? undefined,
            current_amount: args.current_amount ?? undefined,
            is_active: true,
          }).eq("id", existing.id);
        } else {
          await supabase.from("goals").insert({
            user_id: userId, name: args.name,
            target_amount: args.target_amount ?? null,
            current_amount: args.current_amount ?? 0,
            is_active: true,
          });
        }
        return `ok: goal '${args.name}' saved`;
      }
      case "update_goal_progress": {
        const { data: g } = await supabase.from("goals").select("id")
          .eq("user_id", userId).ilike("name", String(args.name)).maybeSingle();
        if (!g) return `no goal named ${args.name}`;
        await supabase.from("goals").update({ current_amount: args.current_amount }).eq("id", g.id);
        return `ok: goal '${args.name}' progress updated`;
      }
      case "remember_fact": {
        await supabase.from("user_memory").upsert({
          user_id: userId,
          category: String(args.category),
          key: String(args.key).toLowerCase(),
          value: String(args.value),
          confidence: args.confidence ?? 0.8,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,category,key" });
        return `ok: remembered ${args.category}/${args.key}`;
      }
      case "forget_fact": {
        await supabase.from("user_memory").delete()
          .eq("user_id", userId)
          .eq("category", String(args.category))
          .eq("key", String(args.key).toLowerCase());
        return `ok: forgot ${args.category}/${args.key}`;
      }
      case "reorder_home_sections": {
        const valid = ["net_worth","accounts","safe_to_spend","income_bills","talk_to_calm","goals","expected_payments"];
        const raw = Array.isArray(args.order) ? (args.order as unknown[]).map(String) : [];
        const clean: string[] = [];
        for (const k of raw) if (valid.includes(k) && !clean.includes(k)) clean.push(k);
        for (const k of valid) if (!clean.includes(k)) clean.push(k);
        await supabase.from("ui_preferences").upsert({
          user_id: userId, section_order: clean, updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
        return `ok: section order = ${clean.join(", ")}`;
      }
      case "reorder_accounts": {
        const names = Array.isArray(args.names) ? (args.names as unknown[]).map((s) => String(s).toLowerCase()) : [];
        await supabase.from("ui_preferences").upsert({
          user_id: userId, account_order: names, updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
        return `ok: accounts ordered as ${names.join(", ")}`;
      }
      case "set_element_color": {
        const validEls = ["talk_to_calm","net_worth","safe_to_spend","upcoming_income","bills_this_week"];
        const el = String(args.element);
        if (!validEls.includes(el)) return `error: unknown element ${el}`;
        const { data: existing } = await supabase.from("ui_preferences").select("element_colors").eq("user_id", userId).maybeSingle();
        const colors: Record<string, string> = { ...(existing?.element_colors ?? {}) };
        const color = String(args.color ?? "").trim();
        if (color === "") delete colors[el]; else colors[el] = color;
        await supabase.from("ui_preferences").upsert({
          user_id: userId, element_colors: colors, updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
        return `ok: ${el} color ${color === "" ? "reset" : "= " + color}`;
      }
    }
    return `unknown tool ${name}`;
  } catch (e) {
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function buildContext(supabase: any, userId: string): Promise<string> {
  const [accounts, clients, expected, goals, bills, memory] = await Promise.all([
    supabase.from("accounts").select("name,balance,is_emergency_fund").eq("user_id", userId),
    supabase.from("clients").select("name,typical_pay_delay_days,typical_amount,is_recurring").eq("user_id", userId),
    supabase.from("expected_payments").select("client_name,expected_amount,expected_date,status")
      .eq("user_id", userId).in("status", ["pending", "overdue"]).order("expected_date"),
    supabase.from("goals").select("name,target_amount,current_amount,sort_order").eq("user_id", userId).eq("is_active", true).order("sort_order"),
    supabase.from("bills").select("name,amount,due_date").eq("user_id", userId).eq("is_paid", false).order("due_date"),
    supabase.from("user_memory").select("category,key,value,confidence").eq("user_id", userId).order("last_seen_at", { ascending: false }).limit(80),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const dayOfWeek = new Date().toLocaleDateString("en-US", { weekday: "long" });
  return JSON.stringify({
    today, dayOfWeek,
    accounts: accounts.data ?? [],
    clients: clients.data ?? [],
    expected_payments: expected.data ?? [],
    active_goals: goals.data ?? [],
    upcoming_bills: bills.data ?? [],
    long_term_memory: memory.data ?? [],
  });
}

const SYSTEM_PROMPT = `You are Calm, a warm, calming, trusted financial companion for someone with ADHD.

Voice: gentle, human, brief. Short sentences. No jargon. Never overwhelm. One clear next step at a time.

CLASSIFY every user message before responding as one of:
- casual: chit-chat, mood, venting ("I had a stressful day", "I worked today" with no details). Respond warmly. DO NOT create goals, bills, or transactions.
- expense: something they spent ("grabbed Starbucks", "spent $22 on groceries"). Silently log_transaction. Infer merchant/category from long_term_memory when possible.
- income: money received ("worked an Instawork shift", "got paid $200"). If known employer from memory/clients, use their typical delay to add_expected_payment; if actually received, log_transaction and mark_payment_received.
- bill: recurring or upcoming obligation. Use add_bill.
- goal: EXPLICIT goal language only — "I want to save…", "my goal is…", "pay off…", "build a … fund". Only then call set_goal.
- preference / memory: things about the user (favorite store, pay schedule, fear, communication style). Call remember_fact silently.

CRITICAL: Never create a goal, tier, or bill from a casual message. "I had a stressful day", "I grabbed Starbucks", "I worked today" are NOT goals.

Use long_term_memory to avoid re-asking things. If the user mentions a known merchant/employer, infer silently. Ask at most ONE question, and only when a required field truly cannot be inferred.

When you record something, confirm in one short line: "Saved: $6 Starbucks." No wall of text. No tool names, no jargon.

GOAL PRIORITY: active_goals is already sorted by the user's chosen priority (position 1 = highest). When recommending contributions, trade-offs, or focus, prioritize the earlier goals in that list. Never reorder them yourself.

If today is Monday, gently offer a Weekly Money Reset, one small step at a time.`;

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SendInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as { supabase: any; userId: string };
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    await supabase.from("messages").insert({ user_id: userId, role: "user", content: data.text });

    const { data: hist } = await supabase
      .from("messages")
      .select("role,content")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);
    const history = (hist ?? []).reverse();

    const ctxJson = await buildContext(supabase, userId);

    const messages: any[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: `Current user context (JSON):\n${ctxJson}` },
      ...history.map((m: any) => ({ role: m.role, content: m.content })),
    ];

    let finalText = "";
    for (let step = 0; step < 6; step++) {
      const res = await fetch(GATEWAY, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: MODEL, messages, tools: TOOLS, tool_choice: "auto" }),
      });
      if (!res.ok) throw new Error(`AI gateway ${res.status}: ${await res.text()}`);
      const json = await res.json();
      const msg = json.choices?.[0]?.message;
      if (!msg) throw new Error("No message from model");
      messages.push(msg);

      const toolCalls = msg.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
          const result = await runTool(tc.function.name, args, supabase, userId);
          messages.push({ role: "tool", tool_call_id: tc.id, content: result });
        }
        continue;
      }
      finalText = msg.content ?? "";
      break;
    }

    if (!finalText) finalText = "Got it.";
    await supabase.from("messages").insert({ user_id: userId, role: "assistant", content: finalText });

    return { reply: finalText };
  });

export const loadMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as unknown as { supabase: any; userId: string };
    const { data } = await supabase
      .from("messages")
      .select("id,role,content,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(200);
    return data ?? [];
  });

function firstOfMonth(offset = 0) {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset);
  return d.toISOString().slice(0, 10);
}
function addDays(base: Date, days: number) {
  const d = new Date(base); d.setDate(d.getDate() + days); return d;
}
function iso(d: Date) { return d.toISOString().slice(0, 10); }

export const loadDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as unknown as { supabase: any; userId: string };

    const today = new Date();
    const todayStr = iso(today);
    const in7 = iso(addDays(today, 7));
    const in30 = iso(addDays(today, 30));
    const lastMonthStart = firstOfMonth(-1);
    const thisMonthStart = firstOfMonth(0);

    await supabase.from("expected_payments").update({ status: "overdue" })
      .eq("user_id", userId).eq("status", "pending").lt("expected_date", todayStr);

    const [accounts, expected, goals, bills, txThisMonth, txLastMonth, prefsRes] = await Promise.all([
      supabase.from("accounts").select("*").eq("user_id", userId),
      supabase.from("expected_payments").select("*").eq("user_id", userId).in("status", ["pending", "overdue"]).order("expected_date"),
      supabase.from("goals").select("*").eq("user_id", userId).eq("is_active", true).order("sort_order").order("created_at"),
      supabase.from("bills").select("*").eq("user_id", userId).eq("is_paid", false).order("due_date").limit(20),
      supabase.from("transactions").select("*").eq("user_id", userId).gte("occurred_on", thisMonthStart),
      supabase.from("transactions").select("*").eq("user_id", userId).gte("occurred_on", lastMonthStart).lt("occurred_on", thisMonthStart),
      supabase.from("ui_preferences").select("section_order,account_order,element_colors").eq("user_id", userId).maybeSingle(),
    ]);

    const prefs = (prefsRes?.data ?? null) as { section_order: string[]; account_order: string[]; element_colors: Record<string, string> } | null;
    const rawAccounts = (accounts.data ?? []) as Array<{ id: string; name: string; balance: number; is_emergency_fund: boolean }>;
    const accOrder = (prefs?.account_order ?? []).map((s) => String(s).toLowerCase());
    const orderedAccounts = [...rawAccounts].sort((a, b) => {
      const ai = accOrder.indexOf(a.name.toLowerCase());
      const bi = accOrder.indexOf(b.name.toLowerCase());
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    const acc = rawAccounts as Array<{ balance: number; is_emergency_fund: boolean }>;
    const netWorth = acc.reduce((s, a) => s + Number(a.balance), 0);
    const emergency = acc.filter((a) => a.is_emergency_fund).reduce((s, a) => s + Number(a.balance), 0);
    const cash = acc.filter((a) => !a.is_emergency_fund).reduce((s, a) => s + Number(a.balance), 0);

    const expectedRows = (expected.data ?? []) as Array<{ expected_amount: number; expected_date: string; client_name: string; status: string }>;
    const billRows = (bills.data ?? []) as Array<{ amount: number; due_date: string; name: string }>;

    const incomeIn = (windowEnd: string) =>
      expectedRows.filter((p) => p.expected_date <= windowEnd && p.status !== "overdue")
        .reduce((s, p) => s + Number(p.expected_amount), 0);
    const billsIn = (windowEnd: string) =>
      billRows.filter((b) => b.due_date <= windowEnd && b.due_date >= todayStr)
        .reduce((s, b) => s + Number(b.amount), 0);

    const cashIn7 = cash + incomeIn(in7) - billsIn(in7);
    const cashIn30 = cash + incomeIn(in30) - billsIn(in30);

    // safe to spend today: cash minus bills before next income arrives, spread over that window
    const nextIncome = expectedRows.find((p) => p.status !== "overdue");
    const untilDate = nextIncome?.expected_date ?? in7;
    const daysUntil = Math.max(1, Math.ceil((new Date(untilDate + "T00:00:00").getTime() - today.setHours(0,0,0,0)) / 86_400_000));
    const buffer = billsIn(untilDate);
    const safeToday = Math.max(0, Math.floor((cash - buffer) / daysUntil));

    const tx = (txThisMonth.data ?? []) as Array<{ kind: string; amount: number; description: string; occurred_on: string }>;
    const lastTx = (txLastMonth.data ?? []) as Array<{ kind: string; amount: number }>;
    const monthlyIncomeBySource: Record<string, number> = {};
    for (const t of tx) {
      if (t.kind === "income") {
        const k = t.description || "Other";
        monthlyIncomeBySource[k] = (monthlyIncomeBySource[k] ?? 0) + Number(t.amount);
      }
    }
    const monthSpend = tx.filter((t) => t.kind === "expense").reduce((s, t) => s + Number(t.amount), 0);
    const lastMonthSpend = lastTx.filter((t) => t.kind === "expense").reduce((s, t) => s + Number(t.amount), 0);
    const weekAgo = iso(addDays(today, -7));
    const weekSpend = tx.filter((t) => t.kind === "expense" && t.occurred_on >= weekAgo).reduce((s, t) => s + Number(t.amount), 0);

    const upcomingBills = billRows.filter((b) => b.due_date >= todayStr && b.due_date <= in7);
    const difficultBills = billRows.filter((b) => {
      const cashAtDue = cash + incomeIn(b.due_date) - billsIn(b.due_date);
      return cashAtDue < Number(b.amount);
    }).slice(0, 3);

    // goal projections
    const goalRows = (goals.data ?? []) as Array<{ id: string; name: string; target_amount: number | null; current_amount: number; created_at: string }>;
    const goalsWithEta = goalRows.map((g) => {
      const target = g.target_amount ? Number(g.target_amount) : null;
      const current = Number(g.current_amount);
      const pct = target ? Math.min(100, Math.round((current / target) * 100)) : null;
      let eta: string | null = null;
      if (target && target > current) {
        const created = new Date(g.created_at).getTime();
        const days = Math.max(1, (Date.now() - created) / 86_400_000);
        const rate = current / days; // $/day since goal created
        if (rate > 0.01) {
          const daysLeft = (target - current) / rate;
          const etaDate = new Date(Date.now() + daysLeft * 86_400_000);
          eta = etaDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
        }
      }
      return { ...g, pct, eta };
    });

    return {
      today: todayStr,
      cash,
      netWorth,
      emergency,
      safeToday,
      cashIn7,
      cashIn30,
      accounts: accounts.data ?? [],
      expected: expectedRows,
      nextIncome,
      bills: billRows,
      upcomingBills,
      difficultBills,
      goals: goalsWithEta,
      monthlyIncomeBySource,
      monthSpend,
      lastMonthSpend,
      weekSpend,
    };
  });

const ReorderGoalsInput = z.object({ orderedIds: z.array(z.string().uuid()).min(1) });
export const reorderGoals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ReorderGoalsInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as { supabase: any; userId: string };
    await Promise.all(
      data.orderedIds.map((id, idx) =>
        supabase.from("goals").update({ sort_order: idx + 1 }).eq("id", id).eq("user_id", userId),
      ),
    );
    return { ok: true };
  });

const DeleteGoalInput = z.object({ id: z.string().uuid() });
export const deleteGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => DeleteGoalInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as { supabase: any; userId: string };
    await supabase.from("goals").update({ is_active: false }).eq("id", data.id).eq("user_id", userId);
    return { ok: true };
  });

const UpdateExpectedInput = z.object({
  id: z.string().uuid(),
  client_name: z.string().min(1).optional(),
  expected_amount: z.number().optional(),
  expected_date: z.string().optional(),
});
export const updateExpectedPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => UpdateExpectedInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as { supabase: any; userId: string };
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.client_name !== undefined) patch.client_name = data.client_name;
    if (data.expected_amount !== undefined) patch.expected_amount = data.expected_amount;
    if (data.expected_date !== undefined) patch.expected_date = data.expected_date;
    await supabase.from("expected_payments").update(patch).eq("id", data.id).eq("user_id", userId);
    return { ok: true };
  });

const DeleteExpectedInput = z.object({ id: z.string().uuid() });
export const deleteExpectedPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => DeleteExpectedInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as { supabase: any; userId: string };
    await supabase.from("expected_payments").delete().eq("id", data.id).eq("user_id", userId);
    return { ok: true };
  });
