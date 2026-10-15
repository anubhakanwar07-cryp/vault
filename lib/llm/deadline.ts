/** Thrown when the caller's overall budget (e.g. a whole pipeline run) is spent. */
export class DeadlineExceededError extends Error {
  constructor(message = 'Time budget exceeded') {
    super(message);
    this.name = 'DeadlineExceededError';
  }
}

/**
 * Runs `fn` with a hard deadline enforced by an AbortSignal (SDK timeouts don't cover a response
 * body that stalls mid-stream). Retries once on a deadline hit; other errors propagate unchanged.
 * `outer` is the caller's overall budget: once it fires, the request is aborted and never retried.
 */
export async function withDeadline<T>(
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>,
  attempts = 2,
  outer?: AbortSignal,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    if (outer?.aborted) throw new DeadlineExceededError();
    const timeout = AbortSignal.timeout(ms);
    const signal = outer ? AbortSignal.any([timeout, outer]) : timeout;
    try {
      return await fn(signal);
    } catch (err) {
      if (outer?.aborted) throw new DeadlineExceededError();
      if (!timeout.aborted) throw err;
      lastErr = new Error(`LLM request exceeded ${ms} ms`);
    }
  }
  throw lastErr;
}
