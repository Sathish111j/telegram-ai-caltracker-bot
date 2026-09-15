# Telegram AI CalTracker Bot

AI-powered Telegram calorie and nutrition tracker running on Cloudflare Workers. The bot extracts meal details with Gemini, stores logs in PostgreSQL, and gives daily summaries.

## What It Does

- Onboards users with name, timezone, and calorie goal
- Logs meals from free-text input **or a photo of the meal** using AI extraction
- Supports guided logging with `/log` and review buttons
- Saves detailed nutrient fields for each food item
- Shows grouped daily totals with `/today`
- Lets you delete a logged item with `/delete <name>` (asks you to confirm first)
- Sends daily/weekly summaries and meal-gap reminders on a schedule

## Bot Access

Use either option below:

1. Open bot link: [Open Telegram Bot](https://t.me/DIETTRACKERAIBOT)
     (or)
2. Scan QR code:

<img src="docs/images/telegram-bot-qr.png" width="200"/>

Place your QR image at `docs/images/telegram-bot-qr.png` so it renders on GitHub.

## Commands

- `/start` - Start onboarding
- `/log` - Start guided logging (bot asks for meal text next)
- `/log <meal text>` - Quick log in one message
- Send a photo of your meal any time to log it from a picture
- `/today` - Show today's saved foods and totals
- `/delete <part of a food name>` - Delete a food item logged today (shows matches and asks you to confirm before deleting)
- `/cancel` - Cancel whatever you're in the middle of
- `/reset` - Redo your profile setup (name, timezone, calorie goal) — food logs are kept
- `/help` - List all commands

## Tech Stack

- Cloudflare Workers + Wrangler
- TypeScript
- PostgreSQL (`postgres` runtime client)
- Prisma schema and migrations
- Gemini API

## Project Structure

```text
src/
	data/db.ts
	handlers/telegram-handler.ts
	handlers/jobs-handler.ts
	services/ai.ts
	services/telegram.ts
	services/security.ts
	services/nutrients.ts
	types/index.ts
	worker.ts
docs/
	architecture.md
```

## Prerequisites

- Node.js 20+
- npm
- Cloudflare account
- PostgreSQL database
- Telegram bot token

## Setup

```bash
npm install
```

Set Worker secrets:

```bash
wrangler secret put DATABASE_URL
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

`DATABASE_URL` is the pooled/runtime connection (used directly, or via a Hyperdrive
binding — see below). Prisma migrations additionally need a **`DIRECT_URL`** secret: a
non-pooled connection to the same database, set via `wrangler secret put DIRECT_URL`
and locally in `.dev.vars` — see `.dev.vars.example`.

`GEMINI_MODEL` is configured via `wrangler.toml`.
Gemini API keys are loaded from DB table `gemini_keys`.

### Database connection pooling (Hyperdrive)

Cloudflare Workers should never hold a direct, long-lived Postgres connection per
invocation — provision a Hyperdrive binding so connections are pooled at the edge:

```bash
wrangler hyperdrive create nutribot-hyperdrive --connection-string="$DATABASE_URL"
```

Then uncomment and fill in the `[[hyperdrive]]` block in `wrangler.toml` with the
returned config id. The app falls back to a direct `DATABASE_URL` connection when no
Hyperdrive binding is present (e.g. local `wrangler dev`), so this step is optional for
local development but strongly recommended for any real deployment.

## Local Development

```bash
npm run cf:login
npm run cf:whoami
npm run cf:dev
```

## Deploy

```bash
npm run cf:deploy
```

## Endpoints

- `GET /health` - Health check
- `POST /telegram-webhook` - Telegram updates

## Database and Prisma

```bash
npm run prisma:validate
npm run prisma:generate
npm run prisma:push
```

## Type Check

```bash
npm run typecheck
```
