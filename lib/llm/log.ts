import 'server-only';
import { adminDb } from '@/lib/db/client';
import { llmRuns } from '@/lib/db/schema';

export type LlmRunLog = {
  userId: string;
  pipelineRunId?: string;
  stage: string;
  model: string;
  promptVersion: string;
  input: unknown;
  output: unknown;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  zodValid: boolean;
  retries: number;
  error?: string;
};

export type LlmLogger = (entry: LlmRunLog) => Promise<void>;

/** Writes one llm_runs row. System write (bypasses RLS); never throws into the caller. */
export const logLlmRun: LlmLogger = async (entry) => {
  try {
    await adminDb()
      .insert(llmRuns)
      .values({
        userId: entry.userId,
        pipelineRunId: entry.pipelineRunId ?? null,
        stage: entry.stage,
        model: entry.model,
        promptVersion: entry.promptVersion,
        input: entry.input,
        output: entry.output,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        latencyMs: entry.latencyMs,
        zodValid: entry.zodValid,
        retries: entry.retries,
        error: entry.error ?? null,
      });
  } catch (err) {
    console.error('[llm] failed to write llm_runs row', err);
  }
};
