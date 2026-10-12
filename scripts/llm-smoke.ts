// Phase 1 acceptance: callLLM with a toy schema writes a row to llm_runs.
// Run: pnpm smoke:llm
import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
  const { z } = await import('zod');
  const { desc, eq } = await import('drizzle-orm');
  const { callLLM } = await import('@/lib/llm/client');
  const { adminDb } = await import('@/lib/db/client');
  const { llmRuns } = await import('@/lib/db/schema');
  const { ensureTestUser } = await import('../tests/integration/helpers');

  const userId = await ensureTestUser('llm-smoke@resume-tailor.test');
  const result = await callLLM({
    stage: 'smoke',
    tier: 'fast',
    system: 'You are a calculator. You return only JSON.',
    user: 'What is 17 + 25? Return {"sum": number}.',
    schema: z.object({ sum: z.number() }),
    promptVersion: 'smoke-1',
    userId,
  });
  console.log('callLLM result:', result);

  const [row] = await adminDb()
    .select()
    .from(llmRuns)
    .where(eq(llmRuns.userId, userId))
    .orderBy(desc(llmRuns.createdAt))
    .limit(1);
  if (!row) throw new Error('FAIL: no llm_runs row written');
  console.log('llm_runs row:', {
    stage: row.stage,
    model: row.model,
    zodValid: row.zodValid,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    latencyMs: row.latencyMs,
  });
  console.log(result.sum === 42 && row.zodValid ? 'PASS' : 'FAIL');
  process.exit(result.sum === 42 && row.zodValid ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
