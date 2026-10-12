import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { callLLMWith, LLMValidationError, type LLMDeps } from '@/lib/llm/core';
import { extractJson } from '@/lib/llm/json';
import type { LlmRunLog } from '@/lib/llm/log';
import type { CompletionRequest } from '@/lib/llm/types';

const schema = z.object({ answer: z.number() });

function fakeDeps(outputs: string[]) {
  const requests: CompletionRequest[] = [];
  const logs: LlmRunLog[] = [];
  const deps: LLMDeps = {
    provider: {
      name: 'fake',
      async complete(req) {
        requests.push(structuredClone(req));
        const text = outputs.shift();
        if (text === undefined) throw new Error('no more fake outputs');
        return { text, model: req.model, inputTokens: 10, outputTokens: 5 };
      },
    },
    modelForTier: (t) => `model-${t}`,
    log: async (e) => {
      logs.push(e);
    },
  };
  return { deps, requests, logs };
}

const base = {
  stage: 'test',
  tier: 'fast' as const,
  system: 'sys',
  user: 'question',
  schema,
  promptVersion: 'v1',
  userId: 'u1',
};

describe('extractJson', () => {
  it('parses plain JSON', () => expect(extractJson('{"a":1}')).toEqual({ a: 1 }));
  it('strips code fences', () => expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 }));
  it('ignores surrounding prose', () =>
    expect(extractJson('Here you go: {"a":[1,2]} hope that helps')).toEqual({ a: [1, 2] }));
  it('throws when there is no JSON', () => expect(() => extractJson('nope')).toThrow());
});

describe('callLLMWith', () => {
  it('returns validated data and logs one successful run', async () => {
    const { deps, logs, requests } = fakeDeps(['{"answer": 42}']);
    await expect(callLLMWith(deps, base)).resolves.toEqual({ answer: 42 });
    expect(requests[0]?.model).toBe('model-fast');
    expect(requests[0]?.temperature).toBe(0.2);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ stage: 'test', zodValid: true, retries: 0, inputTokens: 10 });
  });

  it('retries with the validation error appended, logging every attempt', async () => {
    const { deps, logs, requests } = fakeDeps(['{"answer": "x"}', '{"answer": 7}']);
    await expect(callLLMWith(deps, base)).resolves.toEqual({ answer: 7 });
    expect(logs.map((l) => l.zodValid)).toEqual([false, true]);
    expect(logs[1]?.retries).toBe(1);
    const retryMsg = requests[1]?.messages.at(-1)?.content ?? '';
    expect(retryMsg).toContain('Your last output failed validation');
    expect(retryMsg).toContain('answer');
  });

  it('retries on non-JSON output', async () => {
    const { deps } = fakeDeps(['sorry, no', '{"answer": 1}']);
    await expect(callLLMWith(deps, base)).resolves.toEqual({ answer: 1 });
  });

  it('throws LLMValidationError after maxRetries', async () => {
    const { deps, logs } = fakeDeps(['{}', '{}', '{}']);
    await expect(callLLMWith(deps, { ...base, maxRetries: 2 })).rejects.toBeInstanceOf(
      LLMValidationError,
    );
    expect(logs).toHaveLength(3);
  });

  it('logs and rethrows provider errors', async () => {
    const { deps, logs } = fakeDeps([]);
    await expect(callLLMWith(deps, base)).rejects.toThrow('no more fake outputs');
    expect(logs[0]?.error).toContain('provider');
  });
});
