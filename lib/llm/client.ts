import 'server-only';
import { callLLMWith, type CallLLMOptions } from './core';
import { logLlmRun } from './log';
import { defaultProvider, modelForTier } from './models';

export { LLMValidationError, type CallLLMOptions } from './core';

/** The only entry point for LLM calls (SPEC §0.4, §7.1). */
export function callLLM<T>(opts: CallLLMOptions<T>): Promise<T> {
  return callLLMWith({ provider: defaultProvider(), modelForTier, log: logLlmRun }, opts);
}
