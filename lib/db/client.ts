import 'server-only';
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { serverEnv } from '@/lib/env';
import * as schema from './schema';

export type DB = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

const globalForDb = globalThis as unknown as { __pg?: postgres.Sql; __db?: DB };

/**
 * Privileged connection (the `postgres` role) — BYPASSES RLS.
 * Use only for system work: llm_runs logging, admin pages, evals, account deletion.
 * Request handlers acting for a user must use `withUser`.
 */
export function adminDb(): DB {
  if (!globalForDb.__db) {
    // prepare:false keeps us compatible with Supabase's transaction pooler.
    globalForDb.__pg = postgres(serverEnv().DATABASE_URL, { prepare: false, max: 5 });
    globalForDb.__db = drizzle(globalForDb.__pg, { schema });
  }
  return globalForDb.__db;
}

/**
 * Runs `fn` in a transaction as the Supabase `authenticated` role with auth.uid() = userId,
 * so every query is subject to the RLS policies in schema.ts.
 */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return adminDb().transaction(async (tx) => {
    const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${claims}, true), set_config('role', 'authenticated', true)`,
    );
    return fn(tx);
  });
}

export { schema };
