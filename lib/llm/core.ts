import type { z } from 'zod';
import { extractJson } from './json';
import type { LlmLogger } from './log';
import type { ChatMessage, LLMProvider, ReasoningEffort, Tier } from './types';

export type CallLLMOptions<T> = {
  stage: string;
  tier: Tier;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  promptVersion: string;
  pipelineRunId?: string;
  userId: string;
  /** Default 0.2; rewriting uses 0.5. */
  temperature?: number;
  /** Validation retries after the first attempt. Default 2. */
  maxRetries?: number;
  maxTokens?: number;
  /** Default 'none' (see providers/openai.ts). */
  reasoningEffort?: ReasoningEffort;
};

export type LLMDeps = {
  provider: LLMProvider;
  modelForTier: (tier: Tier) => string;
  log: LlmLogger;
};

export class LLMValidationError extends Error {
  constructor(
    readonly stage: string,
    readonly attempts: number,
    readonly lastError: string,
  ) {
    super(`[${stage}] model output failed validation after ${attempts} attempt(s): ${lastError}`);
    this.name = 'LLMValidationError';
  }
}

const JSON_ONLY = '\n\nRespond with a single JSON value only. No prose, no code fences.';

/** Provider-agnostic, schema-validated JSON call. Every attempt is logged. Transport retries live in the SDKs. */
export async function callLLMWith<T>(deps: LLMDeps, opts: CallLLMOptions<T>): Promise<T> {
  const model = deps.modelForTier(opts.tier);
  const maxRetries = opts.maxRetries ?? 2;
  const messages: ChatMessage[] = [{ role: 'user', content: opts.user }];
  let lastError = '';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const started = Date.now();
    const input = { system: opts.system, messages: [...messages] };
    const base = {
      userId: opts.userId,
      pipelineRunId: opts.pipelineRunId,
      stage: opts.stage,
      model,
      promptVersion: opts.promptVersion,
      input,
      retries: attempt,
    };

    let res;
    try {
      res = await deps.provider.complete({
        model,
        system: opts.system + JSON_ONLY,
        messages,
        temperature: opts.temperature ?? 0.2,
        maxTokens: opts.maxTokens ?? 4096,
        reasoningEffort: opts.reasoningEffort,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await deps.log({
        ...base,
        output: null,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - started,
        zodValid: false,
        error: `provider: ${message}`,
      });
      throw err;
    }

    const logged = {
      ...base,
      model: res.model || model,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      latencyMs: Date.now() - started,
    };

    let parsedJson: unknown;
    try {
      parsedJson = extractJson(res.text);
    } catch (err) {
      lastError = `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
      await deps.log({ ...logged, output: { raw: res.text }, zodValid: false, error: lastError });
      messages.push({ role: 'assistant', content: res.text }, retryMessage(lastError));
      continue;
    }

    const result = opts.schema.safeParse(parsedJson);
    if (result.success) {
      await deps.log({ ...logged, output: parsedJson, zodValid: true });
      return result.data;
    }

    lastError = formatZodIssues(result.error);
    await deps.log({ ...logged, output: parsedJson, zodValid: false, error: lastError });
    messages.push({ role: 'assistant', content: res.text }, retryMessage(lastError));
  }

  throw new LLMValidationError(opts.stage, maxRetries + 1, lastError);
}

function retryMessage(error: string): ChatMessage {
  return {
    role: 'user',
    content: `Your last output failed validation: ${error}. Return valid JSON only.`,
  };
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 10)
    .map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('; ');
}
