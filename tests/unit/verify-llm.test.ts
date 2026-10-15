import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AchievementRecord } from '@/lib/pipeline/types';

const { callLLM } = vi.hoisted(() => ({ callLLM: vi.fn() }));
vi.mock('@/lib/llm/client', () => ({ callLLM }));

const { verifyClaimsLLM, NO_VERDICT, CHECK_UNAVAILABLE, VERIFY_BATCH_SIZE } =
  await import('@/lib/pipeline/verify');

const rec = {
  id: 'x',
  action: 'Did a thing',
  skills: [],
  tools: [],
} as unknown as AchievementRecord;
const lines = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ lineId: `l${i}`, text: `Line ${i}`, sources: [rec] }));
const supported = (id: string) => ({
  line_id: id,
  claims: [{ claim: 'x', verdict: 'supported', why: '' }],
});
const idsIn = (opts: { user: string }) =>
  [...opts.user.matchAll(/"line_id":"(l\d+)"/g)].map((m) => m[1]!);
const ctx = { userId: 'u1' };

beforeEach(() => {
  callLLM.mockReset();
});

describe('verifyClaimsLLM', () => {
  it('splits lines into small batches', async () => {
    callLLM.mockImplementation(async (o: { user: string }) => ({
      results: idsIn(o).map(supported),
    }));
    expect(await verifyClaimsLLM(ctx, lines(12))).toEqual({});
    expect(callLLM).toHaveBeenCalledTimes(Math.ceil(12 / VERIFY_BATCH_SIZE));
  });

  it('fails a line the auditor leaves out, after one re-check', async () => {
    callLLM.mockImplementation(async (o: { user: string }) => ({
      results: idsIn(o)
        .filter((id) => id !== 'l1')
        .map(supported),
    }));
    expect(await verifyClaimsLLM(ctx, lines(3))).toEqual({ l1: [NO_VERDICT] });
    expect(idsIn(callLLM.mock.calls[1]![0])).toEqual(['l1']);
  });

  it('never treats an empty claims list as supported', async () => {
    callLLM.mockResolvedValue({ results: [{ line_id: 'l0', claims: [] }] });
    expect(await verifyClaimsLLM(ctx, lines(1))).toEqual({ l0: [NO_VERDICT] });
  });

  it('passes a line that the re-check judges', async () => {
    callLLM
      .mockResolvedValueOnce({ results: [] })
      .mockImplementation(async (o: { user: string }) => ({ results: idsIn(o).map(supported) }));
    expect(await verifyClaimsLLM(ctx, lines(2))).toEqual({});
  });

  it('retries a failed batch once before marking it unavailable', async () => {
    callLLM.mockRejectedValue(new Error('boom'));
    expect(await verifyClaimsLLM(ctx, lines(2))).toEqual({
      l0: [CHECK_UNAVAILABLE],
      l1: [CHECK_UNAVAILABLE],
    });
    expect(callLLM).toHaveBeenCalledTimes(2);
  });

  it('reports unsupported claims', async () => {
    callLLM.mockResolvedValue({
      results: [
        { line_id: 'l0', claims: [{ claim: '40%', verdict: 'unsupported', why: 'not stated' }] },
      ],
    });
    expect((await verifyClaimsLLM(ctx, lines(1))).l0![0]).toContain('40%');
  });
});
