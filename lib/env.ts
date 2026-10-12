import { z } from 'zod';

const serverSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().startsWith('postgres'),
  LLM_PROVIDER: z.enum(['anthropic', 'openai']).default('openai'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  LLM_FAST_MODEL: z.string().min(1),
  LLM_STRONG_MODEL: z.string().min(1),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  APP_URL: z.url().default('http://localhost:3000'),
  ADMIN_EMAILS: z.string().default(''),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

/** Validated server env. Lazy so `next build` doesn't need secrets. */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  // Treat empty strings in .env files as unset.
  const raw = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ''),
  );
  const parsed = serverSchema.safeParse(raw);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid or missing environment variables: ${missing}. See .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

export function adminEmails(): string[] {
  return serverEnv()
    .ADMIN_EMAILS.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Public values, safe in the browser. Must be referenced literally for Next to inline them. */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
};
