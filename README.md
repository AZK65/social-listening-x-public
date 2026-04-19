# Social Listening for X (Twitter)

A lightweight bot that monitors X (Twitter) for tweets matching a list of search queries, filters them through an LLM to keep only genuine leads, and pushes alerts to Telegram. Runs on a cron schedule and remembers which tweets it has already seen so you never get notified twice.

## What it does

1. **Scrapes X** — every 3 hours, runs each of your configured search queries against the Apify Twitter/X scraper (`kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest`) and pulls recent tweets.
2. **Dedupes** — tweet IDs are stored in `data/seen_tweets.json`; anything already seen is dropped before it hits the LLM.
3. **LLM filtering** — new tweets are sent to an OpenRouter model (default: `moonshotai/kimi-k2-thinking`) that classifies each as `RELEVANT` or `REJECT` against your use case.
4. **Telegram alerts** — relevant tweets are posted to your Telegram chat with author, follower count, bio, and a link.
5. **Catch-up on startup** — the first run after boot uses a 30-day lookback so you don't miss anything from downtime.

The default queries in [src/config.js](src/config.js) are tuned for finding Shopify merchants with payment/subscription pain. Edit the `searchQueries` array to fit your own use case.

## What you need

Three API credentials, all free to get started:

| Service | What for | Where to get it |
|---|---|---|
| **Apify** | Twitter/X scraping | https://console.apify.com/account/integrations |
| **OpenRouter** | LLM filtering | https://openrouter.ai/ |
| **Telegram Bot** | Notifications | Message [@BotFather](https://t.me/BotFather) on Telegram to create a bot and get the token. Then message [@userinfobot](https://t.me/userinfobot) to get your chat ID. |

Plus Node.js 18 or newer.

## Setup

```bash
git clone https://github.com/AZK65/social-listening-x-public.git
cd social-listening-x-public
npm install
cp .env.example .env
# edit .env and fill in the four values
```

Your `.env` should look like:

```
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=123456789
OPENROUTER_API_KEY=sk-or-v1-...
APIFY_TOKEN=apify_api_...
```

Then customize [src/config.js](src/config.js):
- `searchQueries` — the list of X search strings to monitor
- `schedule.cronExpression` — how often to run (default: every 3 hours)
- `llm.model` — any OpenRouter model slug
- `scraper.maxTweetsPerQuery` — caps Apify cost per query per run

## Run

```bash
npm start              # starts the scheduler (runs forever)
npm run backtest       # one-off 72-hour backfill against all queries
```

On startup the bot does a 30-day catch-up sweep, then schedules recurring runs per the cron expression.

## Deploying

A `Procfile` and `railway.toml` are included for one-click deploy to [Railway](https://railway.app/) as a worker process. Any host that runs a long-lived Node process works — just set the four env vars.

## Project layout

- [src/index.js](src/index.js) — entrypoint, scheduler, orchestration
- [src/scraper.js](src/scraper.js) — Apify client
- [src/llm-filter.js](src/llm-filter.js) — OpenRouter classification
- [src/telegram.js](src/telegram.js) — Telegram bot wrapper
- [src/storage.js](src/storage.js) — seen-tweet persistence
- [src/config.js](src/config.js) — queries, schedule, model settings
- [src/chrome-scraper.js](src/chrome-scraper.js) — optional browser-based fallback (requires a Chrome MCP client)

## Costs

- **Apify**: pay-per-result, typically <$0.01 per tweet returned. With the default 18 queries × 50 tweets cap × 8 runs/day, a busy day is ~$5–10.
- **OpenRouter**: Kimi K2 Thinking is cheap (fractions of a cent per tweet). Dedup means already-seen tweets are skipped.
- **Telegram**: free.
