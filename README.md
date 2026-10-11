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

The GitHub repository is connected to Vercel. Pushes to `main` deploy to production automatically, while pull requests receive preview deployments.

## Key takeaways voice note

After each summary, the channel's `message.completed` handler reads the "Key takeaways" section aloud with OpenAI text-to-speech (`gpt-4o-mini-tts`, voice `marin`, Ogg Opus) and sends it with `sendVoice`, captioned "🎧 Key takeaways". It needs `OPENAI_API_KEY`; without it, or if speech fails, only the text summary is sent. Capped at about 900 characters (roughly a minute). `OPENAI_TTS_VOICE` overrides the voice; `TELEGRAM_API_BASE_URL` points the channel at a mock Bot API for local tests.

## Audio summaries in a private channel

Ask for audio explicitly ("summarize https://youtu.be/... as audio") and the agent writes a script meant to be heard, then calls the `create_audio_summary` tool. The tool speaks it with OpenAI text-to-speech in chunks of up to 3,500 characters (three at a time), joins them into one MP3 with a correct duration, and posts it with `sendAudio` to your private audio channel, where it plays in Telegram's music player. A bare link stays a text summary. Delete an episode from the channel when you've finished it.

Setup:

1. In Telegram, create a private channel (for example "Eve Audio").
2. Add the bot to the channel as an administrator with permission to post messages.
3. Find the channel id (it starts with `-100`): forward any channel post to a bot like @userinfobot. (`getUpdates` does not work while the webhook is set.)
4. Set `EVE_AUDIO_CHANNEL_ID` and `OPENAI_API_KEY` in Vercel, then redeploy.

Scripts are capped at 30,000 characters (about 35 minutes; the MP3 is 128 kbps, so roughly 34 MB, under the 50 MB bot upload limit). Each delivery logs its character count, chunk count, duration and size, never the script, so you can track the text-to-speech cost. `OPENAI_TTS_MODEL` overrides the speech model.

## Restrict who can use the bot

Every request can spend OpenAI credit. Set `TELEGRAM_ALLOWED_USER_IDS` to a comma-separated list of Telegram user ids (get yours from @userinfobot); updates from anyone else are acknowledged and dropped. Unset, the bot answers everyone.

## Tests

```bash
npm test
```

Unit tests use Node's built-in test runner and cover script chunking, MP3 joining, file names and the sender allowlist.

## Notes

- The video must be public and have manual or automatically generated captions.
- Supadata is called with `mode=native`. The agent never requests AI-generated transcription, so it cannot incur per-minute transcription credits.
- Without `SUPADATA_API_KEY`, local development falls back to YouTube's unofficial interface. That fallback is generally blocked from Vercel datacenter IPs.
- OpenRouter's free model has provider rate limits and availability is not guaranteed. Remove `:free` from the model ID if you later want to use the paid route.
- Eve automatically splits summaries longer than Telegram's 4,096-character message limit.
