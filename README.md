# NutriBot Worker

Telegram nutrition logging bot running on Cloudflare Workers with Gemini extraction and PostgreSQL persistence.

## Features

- Telegram webhook endpoint with secret validation
- Onboarding flow (`/start`)
- AI nutrition extraction from plain text meals
- Save/cancel confirmation buttons
- Daily summary (`/today`)
- Soft delete by name (`/delete <food_name>`)

## Tech Stack

- Cloudflare Workers + Wrangler
- TypeScript
- PostgreSQL runtime client (`postgres`)
- Prisma schema and client generation
- Gemini SDK (`@google/genai`)

## Project Structure

```text
src/
	data/db.ts
	handlers/telegram-handler.ts
	services/nutrition.ts
	services/telegram.ts
	types/index.ts
	worker.ts
```

## Prerequisites

- Node.js 20+
- npm
- Cloudflare account (Wrangler auth)
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

`GEMINI_MODEL` is configured via `wrangler.toml` vars.
Gemini API key is read from the database table `gemini_keys` (`is_active = true`).

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

- `GET /health` -> health response
- `POST /telegram-webhook` -> Telegram updates

## Prisma

```bash
npm run prisma:validate
npm run prisma:generate
npm run prisma:push
```

## Quality Checks

```bash
npm run typecheck
```

## GitHub Push

```bash
git add .
git commit -m "chore: prepare nutribot worker"
git remote add origin <your-repo-url>
git push -u origin main
```
