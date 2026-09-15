# Architecture

An accurate description of what's actually deployed — see git history for the fuller
audit context behind the September 2026 production revamp.

## Request flow

```
Telegram → POST /telegram-webhook → src/worker.ts
                                        │
                          (checks x-telegram-bot-api-secret-token,
                           fails closed if TELEGRAM_WEBHOOK_SECRET unset)
                                        │
                          opens one Postgres connection (Hyperdrive-backed,
                          falls back to DATABASE_URL), threaded via env.sql
                                        │
                              src/handlers/telegram-handler.ts
                                 (command routing, state machine)
                                    │              │
                         src/data/db.ts     src/services/ai.ts
                        (Postgres queries)   (Gemini extraction)
                                        │
                          connection closed before responding
```

`GET /health` is an unauthenticated liveness check (`{ ok: true }`) — it does not verify
DB or Gemini reachability.

## Conversation state machine

Per-`telegram_id` state lives in the `conversation_state` table (`state` + a JSON
`context` blob), fetched/written via `getUserAndState`/`getState`/`saveState` in
`src/data/db.ts`. States:

- `idle` — no profile, no active flow.
- `onboarding` — mid `/start` (or `/reset`) flow; `context.onboarding.step` is one of
  `name` → `timezone` → `calorie_goal`.
- `awaiting_food_input` — the default state for an onboarded user; `context` may carry
  `pending_source_text` / `pending_source_image` (a food description or photo waiting on
  meal-type selection), `selected_meal_type` (meal type picked, waiting on a description),
  or `pending_log` (an AI-extracted meal preview waiting on Save/Cancel).

`/cancel` resets state to `awaiting_food_input`/`idle` with empty context from anywhere.
There is no state TTL — the safety net is that `/cancel` and `/reset` always work
regardless of what's stuck in context.

## Commands

`/start`, `/help`, `/cancel`, `/reset` (re-run onboarding; food logs are untouched),
`/today`, `/log [text]`, `/delete <name>` (shows matches with a confirm/cancel keyboard
before deleting anything). Any other text or a photo is treated as a meal to log.

## Meal logging (text or photo)

Both paths converge on `handleFoodInput` in `telegram-handler.ts`:

1. `sanitizeInput` (`src/services/security.ts`) blocks obvious prompt-injection attempts
   in text/captions before anything reaches Gemini.
2. `extractFoodFromInput` (`src/services/ai.ts`) calls Gemini with the food-extraction
   JSON schema, optionally with an inlined image.
3. The result is shown as one preview message with a Save/Cancel keyboard; on Save,
   `saveFoodLog` inserts the `food_logs`/`food_items` rows inside a transaction.

There is no per-user AI-call rate limit yet — `users.ai_calls_today` exists in the
schema and is reset daily by `runResetDailyAiJob`, but nothing currently increments it.

Photos are downloaded via `getFile`/`downloadTelegramImage` in `telegram.ts`, capped at
10MB and validated against an image mime-type allow-list before ever reaching Gemini.

## Gemini key rotation & self-healing

Keys live in the `gemini_keys` table, picked least-recently-used first
(`pickGeminiKey`). On failure, `extractFoodFromInput` distinguishes:

- **Transient** (timeout, network error, malformed JSON response) — retried with the
  next key/attempt, **not** counted against the key's health.
- **Quota/429** — the key is marked `exhausted_until = now() + 1h`.
- **Other API errors** — `fail_count` increments; past 5, the key is deactivated
  (`is_active = false`).

`reactivateStaleKeys` (called from the existing daily `runResetDailyAiJob` cron)
re-activates any key that's been inactive for 24h+, so a transient outage can't
permanently disable Gemini access.

## Cron jobs (`src/handlers/jobs-handler.ts`, dispatched from `worker.ts`)

| Schedule | Job | Notes |
|---|---|---|
| `0 15 * * *` | `runDailyReportJob` | Skips users with no data; dedups via `report_send_log` |
| `0 15 * * SUN` | `runWeeklyReportJob` | Same dedup pattern, weekly |
| `0 * * * *` | `runMealGapJob` | Reminds users silent for 6h+, at most once per 8h (also via `report_send_log`) |
| `30 18 * * *` | `runResetDailyAiJob` | Resets `ai_calls_today` to 0; also runs `reactivateStaleKeys` |
| `0 3 * * SUN` | `runHardPurgeDeletedJob` | Permanently deletes soft-deleted `food_items`/`food_logs`, in one transaction |

All scheduled jobs share **one** Postgres connection for the whole cron invocation
(opened in `worker.ts`'s `scheduled()` handler, threaded via `env.sql`) rather than
opening a fresh connection per query — the previous version leaked one per DB call.

`markReportSent` is only called after a report/reminder is confirmed delivered
(`telegramRequest`'s typed result is checked first) — a silently-failed Telegram send
(blocked bot, bad chat id) no longer gets marked as sent.

## Database connections

`src/data/db.ts`'s `createDbConnection`/`getDb` prefer the `HYPERDRIVE` binding's
connection string over `DATABASE_URL`, so Postgres sees a small, edge-pooled set of
connections instead of one per Worker invocation. `DATABASE_URL` remains the local
`wrangler dev` fallback (Hyperdrive isn't available there) and is also what
`wrangler hyperdrive create` is pointed at when provisioning. `DIRECT_URL` is separate
and Prisma-migrations-only — never wired into the runtime path.
