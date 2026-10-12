import type { z } from 'zod';

export type ActionResult<T = undefined> =
  | { ok: true; data: T; warning?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    out[key] ??= issue.message;
  }
  return out;
}

export function invalid(error: z.ZodError): {
  ok: false;
  error: string;
  fieldErrors: Record<string, string>;
} {
  return {
    ok: false,
    error: 'Please fix the highlighted fields.',
    fieldErrors: fieldErrorsOf(error),
  };
}
