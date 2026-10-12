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
    globalForDb.__pg = postgres(serverEnv().DATABASE_URL, {
      prepare: false,
      max: 5,
      // Close idle sockets before the pooler silently drops them (seen as "read ETIMEDOUT").
      idle_timeout: 20,
      max_lifetime: 60 * 30,
      connect_timeout: 15,
      keep_alive: 30,
    });
    globalForDb.__db = drizzle(globalForDb.__pg, { schema });
  }
  return globalForDb.__db;
}

/**
 * Runs `fn` in a transaction as the Supabase `authenticated` role with auth.uid() = userId,
 * so every query is subject to the RLS policies in schema.ts.
 */
/** Client-side ceiling for one user transaction: a dead pooler socket must fail fast, not hang. */
export const TX_DEADLINE_MS = 60_000;

export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Database transaction exceeded ${TX_DEADLINE_MS} ms`)),
      TX_DEADLINE_MS,
    );
  });
  try {
    return await Promise.race([runAsUser(userId, fn), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function runAsUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return adminDb().transaction(async (tx) => {
    const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
    await tx.execute(
      // The idle-in-transaction timeout frees pooler slots if a client dies mid-transaction.
      sql`select set_config('request.jwt.claims', ${claims}, true), set_config('role', 'authenticated', true),
                 set_config('idle_in_transaction_session_timeout', '60000', true)`,
    );
    return fn(tx);
  });
}

export { schema };
