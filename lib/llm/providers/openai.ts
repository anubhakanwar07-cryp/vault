import OpenAI from 'openai';
import { withDeadline } from '../deadline';
import type { CompletionRequest, CompletionResponse, LLMProvider } from '../types';

// GPT-5+/o-series are reasoning models. With reasoning_effort 'none' they accept a custom
// temperature (so SPEC's 0.2 / 0.5 apply); with any other effort only the default temperature works.
function isReasoningModel(model: string): boolean {
  return /^(gpt-5|gpt-6|o\d)/.test(model);
}

export function createOpenAIProvider(apiKey: string): LLMProvider {
  // The SDK retries 429/5xx with exponential backoff + jitter.
  // A stalled request must not hang a run for the SDK's 10-minute default: time out and retry.
  const client = new OpenAI({ apiKey, maxRetries: 3, timeout: 45_000 });
  return {
    name: 'openai',
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      const ms = req.timeoutMs ?? 45_000;
      const res = await withDeadline(
        ms,
        (signal) =>
          client.chat.completions.create(
            {
              model: req.model,
              messages: [{ role: 'system', content: req.system }, ...req.messages],
              max_completion_tokens: req.maxTokens,
              response_format: { type: 'json_object' },
              ...(isReasoningModel(req.model)
                ? {
                    reasoning_effort: req.reasoningEffort ?? 'none',
                    ...((req.reasoningEffort ?? 'none') === 'none'
                      ? { temperature: req.temperature }
                      : {}),
                  }
                : { temperature: req.temperature }),
            },
            { timeout: ms, signal },
          ),
        2,
        req.signal,
      );
      return {
        text: res.choices[0]?.message.content ?? '',
        model: res.model,
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
      };
    },
  };
}
