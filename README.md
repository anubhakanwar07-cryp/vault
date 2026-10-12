# Resume Tailor

Store your work history once in a career vault; get a one-page resume tailored to each job, with every line traced to a vault entry. Product and build spec: [SPEC.md](SPEC.md).

## Setup

Requires Node 22+ (`nvm use` picks it up from `.nvmrc`) and pnpm (`corepack prepare pnpm@10.18.3 --activate`).

1. `pnpm install`
2. `cp .env.example .env.local` and fill it in (see comments in the file).
3. In the Supabase dashboard:
   - **Authentication → URL Configuration**: Site URL `http://localhost:3000`; add `http://localhost:3000/auth/callback` to Redirect URLs.
   - **Authentication → Sign In / Providers → Google** (optional): enable and paste your Google OAuth client ID/secret. In Google Cloud, the authorised redirect URI is `https://<project-id>.supabase.co/auth/v1/callback`.
4. `pnpm db:migrate` — creates all tables, RLS policies, pgvector index, and `updated_at` triggers.
5. `pnpm dev` → http://localhost:3000

## Scripts

| Command                                | What it does                                                              |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm dev` / `pnpm build`              | Run / build the app                                                       |
| `pnpm typecheck` / `pnpm lint`         | Type and lint checks                                                      |
| `pnpm test`                            | Unit tests (no network)                                                   |
| `pnpm test:integration`                | Tests against your Supabase project (e.g. RLS isolation)                  |
| `pnpm smoke:llm`                       | Calls the LLM with a toy schema and confirms an `llm_runs` row is written |
| `pnpm db:generate` / `pnpm db:migrate` | Generate / apply Drizzle migrations                                       |

## Architecture notes

- Server code reaches Postgres through Drizzle. `withUser(userId, tx => …)` runs queries as the Supabase `authenticated` role so RLS applies; `adminDb()` bypasses RLS and is reserved for system writes (LLM logs, admin, evals).
- Every LLM call goes through `lib/llm/client.ts`, which validates output with Zod, retries with the validation error, and logs each attempt to `llm_runs`.
