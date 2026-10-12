import OpenAI from 'openai';
import type { CompletionRequest, CompletionResponse, LLMProvider } from '../types';

// SPEC-QUESTION: GPT-5-family and o-series reasoning models reject a custom temperature,
// so it's omitted for them. The spec's temperature targets (0.2 / 0.5) only apply to models that accept it.
function acceptsTemperature(model: string): boolean {
  return !/^(gpt-5|gpt-6|o\d)/.test(model);
}

export function createOpenAIProvider(apiKey: string): LLMProvider {
  // The SDK retries 429/5xx with exponential backoff + jitter.
  const client = new OpenAI({ apiKey, maxRetries: 4 });
  return {
    name: 'openai',
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      const res = await client.chat.completions.create({
        model: req.model,
        messages: [{ role: 'system', content: req.system }, ...req.messages],
        max_completion_tokens: req.maxTokens,
        response_format: { type: 'json_object' },
        ...(acceptsTemperature(req.model) ? { temperature: req.temperature } : {}),
      });
      return {
        text: res.choices[0]?.message.content ?? '',
        model: res.model,
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
      };
    },
  };
}
