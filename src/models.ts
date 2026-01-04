import type { Provider } from './types.js';

export interface ModelConfig {
  model: string;
  provider: Provider;
}

export const MODEL_ALIASES: Record<string, ModelConfig> = {
  // Gemini models (3.x first as default)
  '3-flash': { model: 'gemini-3-flash-preview', provider: 'gemini' },
  '3-pro': { model: 'gemini-3-pro-preview', provider: 'gemini' },
  '2.5-flash': { model: 'gemini-2.5-flash', provider: 'gemini' },
  '2.5-pro': { model: 'gemini-2.5-pro', provider: 'gemini' },
  // OpenAI models
  'gpt-5': { model: 'gpt-5', provider: 'openai' },
  'gpt-5-mini': { model: 'gpt-5-mini', provider: 'openai' },
  'gpt-5-nano': { model: 'gpt-5-nano', provider: 'openai' },
};

export function resolveModel(input: string): ModelConfig {
  const config = MODEL_ALIASES[input];
  if (!config) {
    const validOptions = Object.keys(MODEL_ALIASES).join(', ');
    throw new Error(`Unknown model: ${input}\nValid options: ${validOptions}`);
  }
  return config;
}
