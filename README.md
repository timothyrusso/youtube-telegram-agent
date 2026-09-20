# Eve YouTube Telegram Agent

An [Eve](https://eve.dev/) agent deployed on Vercel. Send its Telegram bot a public YouTube link and it uses the video's captions plus NVIDIA Nemotron 3 Ultra to return a detailed, easy-to-understand bullet-point summary with timestamps.

## Stack

- Eve agent runtime and built-in Telegram channel
- `youtube-transcript-plus` for public YouTube captions and metadata
- Supadata for reliable native-caption retrieval from Vercel
- OpenRouter's free `nvidia/nemotron-3-ultra-550b-a55b:free` model
- Vercel for deployment and durable sessions

## Requirements

- Node.js 24 or newer
- An [OpenRouter API key](https://openrouter.ai/settings/keys)
- A free [Supadata API key](https://dash.supadata.ai/organizations/api-key)
- A Telegram bot created with [BotFather](https://t.me/BotFather)
- A Vercel account for deployment

Copy the values from `.env.example` into `.env.local`:

```dotenv
OPENROUTER_API_KEY=sk-or-v1-your-key
SUPADATA_API_KEY=your-supadata-key
TELEGRAM_BOT_TOKEN=123456:your-token
TELEGRAM_WEBHOOK_SECRET_TOKEN=replace_with_a_random_secret
TELEGRAM_BOT_USERNAME=your_bot_username
```

Use the bot username without the leading `@`. Generate a webhook secret with `openssl rand -hex 32`.

## Run Locally

```bash
nvm install
nvm use
npm install
npm run info
npm run dev
```

The Eve terminal UI lets you test YouTube links without registering a Telegram webhook.

## Deploy to Vercel

Link and deploy the project through Eve:

```bash
npx eve link --project youtube-telegram-agent
npx eve deploy
```

Add all five environment variables to the Vercel project before deploying. Then register the production webhook, replacing the hostname:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://YOUR_PROJECT.vercel.app/eve/v1/telegram","secret_token":"'"$TELEGRAM_WEBHOOK_SECRET_TOKEN"'","allowed_updates":["message","callback_query"]}'
```

Check the deployment:

```bash
curl https://YOUR_PROJECT.vercel.app/eve/v1/health
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

## Notes

- The video must be public and have manual or automatically generated captions.
- Supadata is called with `mode=native`. The agent never requests AI-generated transcription, so it cannot incur per-minute transcription credits.
- Without `SUPADATA_API_KEY`, local development falls back to YouTube's unofficial interface. That fallback is generally blocked from Vercel datacenter IPs.
- OpenRouter's free model has provider rate limits and availability is not guaranteed. Remove `:free` from the model ID if you later want to use the paid route.
- Eve automatically splits summaries longer than Telegram's 4,096-character message limit.
