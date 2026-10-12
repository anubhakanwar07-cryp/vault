/**
 * Runs `fn` with a hard deadline enforced by an AbortSignal (SDK timeouts don't cover a response
 * body that stalls mid-stream). Retries once on a deadline hit; other errors propagate unchanged.
 */
export async function withDeadline<T>(
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>,
  attempts = 2,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const signal = AbortSignal.timeout(ms);
    try {
      return await fn(signal);
    } catch (err) {
      if (!signal.aborted) throw err;
      lastErr = new Error(`LLM request exceeded ${ms} ms`);
    }
  }
  throw lastErr;
}
