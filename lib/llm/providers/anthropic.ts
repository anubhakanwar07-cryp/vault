import Anthropic from '@anthropic-ai/sdk';
import { withDeadline } from '../deadline';
import type { CompletionRequest, CompletionResponse, LLMProvider } from '../types';

export function createAnthropicProvider(apiKey: string): LLMProvider {
  // The SDK retries 429/5xx with exponential backoff + jitter.
  const client = new Anthropic({ apiKey, maxRetries: 3, timeout: 45_000 });
  return {
    name: 'anthropic',
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      const ms = req.timeoutMs ?? 45_000;
      const res = await withDeadline(
        ms,
        (signal) =>
          client.messages.create(
            {
              model: req.model,
              system: req.system,
              messages: req.messages,
              max_tokens: req.maxTokens,
              temperature: req.temperature,
            },
            { timeout: ms, signal },
          ),
        2,
        req.signal,
      );
      const text = res.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
      return {
        text,
        model: res.model,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      };
    },
  };
}
