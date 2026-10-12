import 'server-only';
import { callLLM } from '@/lib/llm/client';
import * as prompt from '@/lib/llm/prompts/parseJD';
import { parsedJD, type ParsedJD } from '@/lib/llm/schemas/jd';

export const MAX_JD_TEXT = 20_000;

/** Stage 1 (SPEC §7.2): JD text → ParsedJD on the fast tier. */
export async function parseJD(
  userId: string,
  jdText: string,
  pipelineRunId?: string,
): Promise<ParsedJD> {
  return callLLM({
    stage: 'parse_jd',
    tier: 'fast',
    system: prompt.system,
    user: prompt.buildUser({ jdText: jdText.slice(0, MAX_JD_TEXT) }),
    schema: parsedJD,
    promptVersion: prompt.version,
    userId,
    pipelineRunId,
    maxTokens: 6000,
  });
}
