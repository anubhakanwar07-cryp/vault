import { expect, it } from 'vitest';
import { DeadlineExceededError, withDeadline } from '@/lib/llm/deadline';

const hang = (signal: AbortSignal) =>
  new Promise<string>((_, reject) =>
    signal.addEventListener('abort', () => reject(new Error('aborted'))),
  );

it('aborts a stalled call, retries once, then fails', async () => {
  let calls = 0;
  await expect(withDeadline(20, (s) => (calls++, hang(s)))).rejects.toThrow('exceeded 20 ms');
  expect(calls).toBe(2);
});

it('returns the retry result when the second attempt succeeds', async () => {
  let calls = 0;
  await expect(
    withDeadline(20, (s) => (++calls === 1 ? hang(s) : Promise.resolve('ok'))),
  ).resolves.toBe('ok');
});

it('does not retry ordinary errors', async () => {
  let calls = 0;
  await expect(
    withDeadline(1000, () => (calls++, Promise.reject(new Error('400 bad request')))),
  ).rejects.toThrow('400');
  expect(calls).toBe(1);
});

it('stops at once, with no retry, when the outer budget runs out', async () => {
  let calls = 0;
  const outer = AbortSignal.timeout(20);
  await expect(withDeadline(1000, (s) => (calls++, hang(s)), 2, outer)).rejects.toBeInstanceOf(
    DeadlineExceededError,
  );
  expect(calls).toBe(1);
});

it('refuses to start when the outer budget is already spent', async () => {
  const outer = AbortSignal.abort();
  let calls = 0;
  await expect(
    withDeadline(1000, () => (calls++, Promise.resolve('x')), 2, outer),
  ).rejects.toBeInstanceOf(DeadlineExceededError);
  expect(calls).toBe(0);
});
