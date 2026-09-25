import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { defineAgent } from 'eve';

const primaryModel = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const backupModel = 'nvidia/nemotron-3.5-lightning:free';

const openrouter = createOpenAICompatible({
  name: 'openrouter',
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  headers: {
    'HTTP-Referer': process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'http://localhost:3000',
    'X-Title': 'Eve YouTube Summarizer',
  },
  // OpenRouter retries with the next model when the primary is rate-limited or down.
  transformRequestBody: (body) => ({ ...body, models: [primaryModel, backupModel] }),
});

export default defineAgent({
  model: openrouter(primaryModel),
  modelContextWindowTokens: 1_000_000,
  limits: {
    sessionTimeoutMs: 7 * 24 * 60 * 60 * 1_000,
  },
});
