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
          name: { type: "string", description: "Account name, e.g. 'Chase Checking', 'Cash', 'Emergency Fund'" },
          balance: { type: "number", description: "Current balance in dollars" },
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
          client_name: { type: "string", description: "For income, who paid" },
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
      description: "Record an incoming payment the user is expecting but hasn't received yet. Use client's typical pay delay if known.",
      parameters: {
        type: "object",
        properties: {
          client_name: { type: "string" },
          expected_amount: { type: "number" },
          expected_date: { type: "string", description: "YYYY-MM-DD" },
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
      description: "Mark an expected payment as received. Provide client_name and roughly the amount to disambiguate.",
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
      description: "Set or update the user's current active financial goal.",
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
      name: "add_tier",
      description: "Create a customizable financial planning tier the AI will follow.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          goal: { type: "string" },
          description: { type: "string" },
          rules: { type: "string", description: "Plain-language rules the AI should apply." },
        },
        required: ["name"],
      },
    },
  },
];


// Utility: run a tool
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
        await supabase.from("goals").update({ is_active: false }).eq("user_id", userId).eq("is_active", true);
        await supabase.from("goals").insert({
          user_id: userId, name: args.name,
          target_amount: args.target_amount ?? null,
          current_amount: args.current_amount ?? 0,
          is_active: true,
        });
        return `ok: goal '${args.name}' set as active`;
      }
      case "add_tier": {
        await supabase.from("tiers").insert({
          user_id: userId, name: args.name,
          goal: args.goal ?? null,
          description: args.description ?? null,
          rules: args.rules ?? null,
        });
        return `ok: tier '${args.name}' created`;
      }
    }
    return `unknown tool ${name}`;
  } catch (e) {
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function buildContext(supabase: any, userId: string): Promise<string> {
  const [accounts, clients, expected, tiers, goal, bills] = await Promise.all([
    supabase.from("accounts").select("name,balance,is_emergency_fund").eq("user_id", userId),
    supabase.from("clients").select("name,typical_pay_delay_days,typical_amount,is_recurring").eq("user_id", userId),
    supabase.from("expected_payments").select("client_name,expected_amount,expected_date,status")
      .eq("user_id", userId).in("status", ["pending", "overdue"]).order("expected_date"),
    supabase.from("tiers").select("name,goal,description,rules").eq("user_id", userId),
    supabase.from("goals").select("name,target_amount,current_amount").eq("user_id", userId).eq("is_active", true).maybeSingle(),
    supabase.from("bills").select("name,amount,due_date").eq("user_id", userId).eq("is_paid", false).order("due_date"),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const dayOfWeek = new Date().toLocaleDateString("en-US", { weekday: "long" });
  return JSON.stringify({
    today, dayOfWeek,
    accounts: accounts.data ?? [],
    clients: clients.data ?? [],
    expected_payments: expected.data ?? [],
    tiers: tiers.data ?? [],
    active_goal: goal.data ?? null,
    upcoming_bills: bills.data ?? [],
  });
}

const SYSTEM_PROMPT = `You are Calm, a warm, calming, trusted financial advisor for someone with ADHD.

Voice: gentle, human, brief. Short sentences. No jargon. Never overwhelm. Never a wall of text. One clear next step at a time.

Your job:
- Listen to what the user says in plain language and extract structured financial info.
- Use tools SILENTLY to record balances, income, expenses, clients/employers, expected payments, bills, goals, and tiers. Do NOT describe the tool calls to the user.
- Remember recurring income sources and each client's typical pay delay. When the user says they worked for a client you know, automatically predict the expected payment date using their typical_pay_delay_days.
- If a client is new, ask (once, briefly) when they usually pay, then remember it via upsert_client.
- When the user reports work: create an expected_payment automatically using the predicted date; also upsert_client to keep learning.
- When money actually lands, use mark_payment_received.
- If today is Monday, gently offer the Weekly Money Reset: walk them one step at a time through balances, spending since last week, missing transactions, income, and next-week spending guidance. Never dump the whole checklist.
- When giving a recommendation, explain WHY in one sentence, plain language.
- Prefer asking ONE small question over asking many.
- Confirm what you saved in one short line, e.g. "Saved: $250 from Gist, expected Thursday."

Never say the words "tool", "database", "function", or "API". Sound like a person.`;

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SendInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as unknown as { supabase: any; userId: string };
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    // Save user message
    await supabase.from("messages").insert({ user_id: userId, role: "user", content: data.text });

    // Load recent history (last 30)
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

    // Tool loop
    let finalText = "";
    for (let step = 0; step < 6; step++) {
      const res = await fetch(GATEWAY, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model: MODEL, messages, tools: TOOLS, tool_choice: "auto" }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`AI gateway ${res.status}: ${body}`);
      }
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

// Load messages
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

// Dashboard data
export const loadDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as unknown as { supabase: any; userId: string };

    // Mark overdue
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from("expected_payments").update({ status: "overdue" })
      .eq("user_id", userId).eq("status", "pending").lt("expected_date", today);

    const [accounts, expected, tiers, goal, bills, txns] = await Promise.all([
      supabase.from("accounts").select("*").eq("user_id", userId),
      supabase.from("expected_payments").select("*").eq("user_id", userId).in("status", ["pending", "overdue"]).order("expected_date"),
      supabase.from("tiers").select("*").eq("user_id", userId).order("created_at"),
      supabase.from("goals").select("*").eq("user_id", userId).eq("is_active", true).maybeSingle(),
      supabase.from("bills").select("*").eq("user_id", userId).eq("is_paid", false).order("due_date").limit(10),
      supabase.from("transactions").select("*").eq("user_id", userId).gte("occurred_on", firstOfMonth()),
    ]);

    const acc = (accounts.data ?? []) as Array<{ balance: number; is_emergency_fund: boolean }>;
    const netWorth = acc.reduce((s, a) => s + Number(a.balance), 0);
    const emergency = acc.filter((a) => a.is_emergency_fund).reduce((s, a) => s + Number(a.balance), 0);

    const tx = (txns.data ?? []) as Array<{ kind: string; amount: number; client_id: string | null; description: string }>;
    const monthlyIncomeBySource: Record<string, number> = {};
    for (const t of tx) {
      if (t.kind === "income") {
        const key = t.description || "Other";
        monthlyIncomeBySource[key] = (monthlyIncomeBySource[key] ?? 0) + Number(t.amount);
      }
    }
    const weeklySpend = tx.filter(t => t.kind === "expense").reduce((s, t) => s + Number(t.amount), 0);

    return {
      netWorth,
      emergency,
      accounts: accounts.data ?? [],
      expected: expected.data ?? [],
      tiers: tiers.data ?? [],
      activeGoal: goal.data ?? null,
      bills: bills.data ?? [],
      monthlyIncomeBySource,
      weeklySpend,
    };
  });

function firstOfMonth() {
  const d = new Date(); d.setDate(1);
  return d.toISOString().slice(0, 10);
}
