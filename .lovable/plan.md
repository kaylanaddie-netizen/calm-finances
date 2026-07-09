# Calm — major restructure

This is a large scope. I'll ship it in one pass but want you to approve the shape first, since #5 in particular changes what the app *is* (dashboard-first instead of chat-first).

## 1. Dashboard becomes the home screen (#5, #7, #8)

- Route swap: `/` → new Dashboard, `/chat` → the conversation. A prominent "Talk to Calm" button anchors the dashboard.
- New calm morning greeting up top ("Good morning."), then a stack of small cards:
  - **Current Cash** (sum of non-emergency accounts)
  - **Safe to Spend Today** (cash − upcoming bills before next expected income, ÷ days)
  - **Upcoming Income** (next expected payment, with date)
  - **Upcoming Bills** (next 7 days)
  - **Cash in 7 Days / Cash in 30 Days** (projected: current + expected income − scheduled bills)
  - **Emergency Fund Progress**
  - **Monthly Spending Trend** (this month vs last month, tiny sparkline)
  - **One Thing to Focus On** — a single AI-generated nudge, cached per day
- Predictive cards use the data already in `accounts`, `expected_payments`, `bills`, `transactions`. No new schema needed for projections — they're computed server-side in `loadDashboard`.

## 2. Remove Tiers, add Current Goals (#1, #2)

- Delete the "Your Financial Tiers" section and the `add_tier` tool. The `tiers` table stays in the DB (harmless) but is no longer read or written.
- New **Current Goals** section: name, progress bar, `$X of $Y`, % complete, estimated completion date (linear projection from recent contribution rate, or "—" if unknown).
- Goals become multi-active instead of single-active (small migration: no schema change needed; just stop deactivating others in `set_goal`, and load all active).

## 3. Smarter AI: distinguish chatter from goals (#1, #6, #8)

Rewrite the system prompt to explicitly classify each user turn as one of: casual, expense, income, bill, goal, preference, memory. Rules:
- Only call `set_goal` when the user uses explicit goal language ("I want to save…", "my goal is…", "pay off…"). Never infer a goal from an expense or mood.
- Infer expenses/income silently from natural phrases ("grabbed Starbucks", "worked an Instawork shift") using known merchants/employers from memory.
- Ask at most one clarifying question, and only when a required field truly cannot be inferred.

## 4. Long-term memory (#4, #6)

New table `user_memory` (key/value with category + confidence + last_seen):
- categories: `merchant`, `employer`, `subscription`, `paycheck_pattern`, `bill_pattern`, `preference`, `fear`, `habit`
- New tools: `remember_fact`, `forget_fact`. Memory is loaded into the model context on every turn so Calm stops re-asking.
- Merchants/employers auto-remembered when mentioned (Starbucks → coffee, Instawork → gig employer with typical amount).

## 5. Fix voice input (#3)

Current bug is that `useVoiceDictation` throws when `getUserMedia` is denied, and the button reports it as an error without ever prompting cleanly. Also `ScriptProcessorNode` is flaky on some browsers.

- Rewrite to request permission on tap, show a clear "allow microphone" toast if denied (with instructions), and start listening immediately when granted.
- Keep streaming WAV → `/api/transcribe` (that endpoint works). Replace `ScriptProcessorNode` with `AudioWorkletNode` when available, fallback otherwise.
- Auto-stop after ~1.2s of silence and auto-submit the final transcript — no send tap required for voice.
- Subtle pulsing listening indicator on the mic button + a soft waveform line under the composer.

## 6. Files touched

- `src/lib/ai-chat.functions.ts` — rewrite system prompt, remove `add_tier`, add memory tools, add `loadDashboard` projections (7d/30d cash, spending trend, focus nudge), return goals list.
- `src/routes/_authenticated.index.tsx` — becomes the new Dashboard.
- `src/routes/_authenticated.chat.tsx` — new file, holds the current chat UI (moved).
- `src/lib/useVoiceDictation.ts` — rewritten for reliability + auto-submit.
- `src/routes/__root.tsx` / route tree — update nav.
- New migration: `user_memory` table (with GRANTs + RLS).

## 7. Out of scope for this pass

- Push notifications / background jobs to *proactively* surface changes when the app is closed. The dashboard will show proactive observations when the user opens the app; true background nudges need a cron + notification channel we can add later.
- Multi-currency, receipt scanning, bank sync.

Approve and I'll build it end to end.
