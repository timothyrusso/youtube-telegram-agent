import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { defineAgent } from 'eve';

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
});

export default defineAgent({
  model: openrouter('nvidia/nemotron-3-ultra-550b-a55b:free'),
  modelContextWindowTokens: 1_000_000,
  limits: {
    maxInputTokensPerSession: 2_000_000,
    maxOutputTokensPerSession: 30_000,
    sessionTimeoutMs: 7 * 24 * 60 * 60 * 1_000,
  },
});
