import { serverEnv } from '@/lib/env';
import { createAnthropicProvider } from './providers/anthropic';
import { createOpenAIProvider } from './providers/openai';
import type { LLMProvider, Tier } from './types';

export function modelForTier(tier: Tier): string {
  const env = serverEnv();
  return tier === 'fast' ? env.LLM_FAST_MODEL : env.LLM_STRONG_MODEL;
}

let provider: LLMProvider | undefined;

export function defaultProvider(): LLMProvider {
  if (provider) return provider;
  const env = serverEnv();
  if (env.LLM_PROVIDER === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY)
      throw new Error('LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty');
    provider = createAnthropicProvider(env.ANTHROPIC_API_KEY);
  } else {
    if (!env.OPENAI_API_KEY) throw new Error('LLM_PROVIDER=openai but OPENAI_API_KEY is empty');
    provider = createOpenAIProvider(env.OPENAI_API_KEY);
  }
  return provider;
}
