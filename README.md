# Resume Tailor

Store your work history once in a career vault. For each job, get a one-page resume tailored to that role plus a match report. Every line on it traces back to something you actually did. The product spec is [SPEC.md](SPEC.md).

## What it does

1. **Career vault.** Import your resume (PDF or DOCX), add a portfolio link or write a brief in your own words, and deepen thin projects with the AI interviewer. Numbers and dates that aren't in your source are removed in code, not just in the prompt.
2. **Tailoring.** Paste a job description or a link, check the parsed requirements, then tailor. A deterministic optimiser picks which achievements go on the page. A strong model rewrites them, and every line is fact-checked twice: in code (numbers, tools, hedges, banned phrases) and by a separate LLM auditor. A bullet that fails twice falls back to your vault text verbatim.
3. **Editor.** Click a bullet to edit it, or regenerate, swap, delete or reorder it. The editor also shows a match report, a recruiter's-eye view and a page-fit indicator. Export an ATS-safe PDF or DOCX.
4. **Tracker.** Log each application with the exact resume version you sent. Logging some baseline applications lets you compare callback rates for tailored and untailored resumes.
5. **Learning.** Your edits become style rules every 5 edits, and future bullets follow them.

## Setup

You need Node 22+ (`nvm use` reads it from `.nvmrc`) and pnpm (`corepack prepare pnpm@10.18.3 --activate`). Chrome must be installed locally for PDF export and for reading JavaScript-heavy portfolio sites.

1. `pnpm install`
2. `cp .env.example .env.local` and fill it in with **personal** keys. Real values go only in `.env.local`, which git ignores; a pre-commit hook blocks secrets.
3. In the Supabase dashboard:
   - **Authentication → URL Configuration:** set the Site URL to `http://localhost:3000` and add `http://localhost:3000/auth/callback` and `http://localhost:3000/auth/confirm` as redirect URLs.
   - **Optional, so magic links work in any browser:** under Authentication → Email Templates → Magic Link, use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard`.
   - **Optional, Google sign-in:** go to Authentication → Sign In / Providers → Google and paste your Google OAuth client ID and secret. The authorised redirect URI in Google Cloud is `https://<project-id>.supabase.co/auth/v1/callback`.
4. `pnpm db:migrate` creates all tables, RLS policies, the pgvector index and the triggers.
5. `pnpm dev` and open http://localhost:3000. To see `/admin/runs`, add your email to `ADMIN_EMAILS`.

## Commands

| Command                                | What it does                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev` / `pnpm build`              | Run or build the app                                                                                                             |
| `pnpm typecheck` / `pnpm lint`         | Type and lint checks                                                                                                             |
| `pnpm test`                            | Unit tests (no network): selection optimiser, verifiers, import guards, template                                                 |
| `pnpm test:integration`                | Tests against your Supabase project and the LLM: RLS, import, pipeline, editor, export, tracker, learning                        |
| `pnpm test:e2e`                        | Playwright happy path: sign in → import → JD → tailor → edit → PDF → log application                                             |
| `pnpm eval`                            | Full pipeline over the 20 golden JDs (about $2, about 6 min). Writes `evals/reports/*.md` and exits non-zero on any fabrication. |
| `pnpm eval --stage parse_jd`           | JD parsing only (cheap)                                                                                                          |
| `pnpm cost:last`                       | Cost and latency breakdown of the latest pipeline run                                                                            |
| `pnpm smoke:llm`                       | Calls the LLM with a toy schema and confirms an `llm_runs` row is written                                                        |
| `pnpm db:generate` / `pnpm db:migrate` | Generate or apply Drizzle migrations                                                                                             |

## Latest eval

This covers the 20 golden JDs against a fixture vault of 52 achievements. Full reports are in `evals/reports/`, and the targets come from SPEC §13.

| Metric                                 | Target  | Result            |
| -------------------------------------- | ------- | ----------------- |
| Role family accuracy                   | ≥ 90%   | 100%              |
| Must-have keyword recall               | ≥ 80%   | 98%               |
| Fabrication (code-level, final output) | 0       | 0                 |
| Weighted must-have coverage            | ≥ 80%   | 97%               |
| Banned-phrase hits                     | 0       | 0                 |
| Recruiter-sim score                    | ≥ 7     | 7.8               |
| Cost per run (average / max)           | < $0.10 | $0.087 / $0.117   |
| Latency per run (average / max)        | < 60 s  | 45 s / 69 s       |
| Selection recall                       | ≥ 60%   | 63%               |
| Selection precision                    | ≥ 70%   | 54% ❌ (see note) |

Precision and recall are measured against "ideal" picks that were hand-labelled without independent review. Since Phase 9 a resume shows only 3 projects and 8 bullets, so achievement-level recall against the older ideal lists is capped too; project precision and project group recall are the better selection signals. Have a human review `evals/golden/*.json`, then re-run `pnpm eval`.

**Why a project was or wasn't picked:** `pnpm debug:select <jobId> [--all]` lists every project in that job owner's vault with its achievement count, average completeness, project score and reason, plus the 3 that selection picks. `--all` repeats it for each of their jobs. It makes one fast-tier LLM call per job. A project with 0 or very few achievements can't be picked well; that's an import problem, so add its work in the vault.

**Reliability:** every LLM request has a hard 45 s deadline (120 s for imports) with one retry, and every database transaction has a 60 s deadline. A stalled network call therefore fails fast instead of hanging a run.

## Architecture

- **Data access.** Server code uses Drizzle. `withUser(userId, tx => …)` runs queries as Supabase's `authenticated` role, so RLS applies even to server-side queries. `adminDb()` bypasses RLS and is reserved for LLM logging, admin pages and evals.
- **LLM calls.** Every call goes through `lib/llm/client.ts`, which validates output with Zod, retries with the validation error, and logs each attempt to `llm_runs`. It's provider-agnostic: OpenAI by default, Anthropic optional. GPT-5-family models run with `reasoning_effort: none` so the spec's temperatures apply and runs stay fast.
- **Pipeline.** `lib/pipeline/` runs retrieve → score → select (pure) → rewrite → verify → assemble, then the recruiter sim. Progress streams over SSE from `/api/tailor/[jobId]/stream`. A reload re-attaches to a run in progress, and runs are limited to 30 per user per day.
- **Template.** There is one template, `lib/export/template.tsx`, written against a tiny element factory. It renders to React for the editor and to an HTML string for the PDF (headless Chrome). DOCX uses the `docx` package with the same headings and order.
- **Traceability.** Every bullet is a `resume_bullets` row linked to its source achievement, with all verification attempts recorded.
- **Versioning.** Edits change the current draft. "Mark as final" or exporting freezes it, and editing a final version starts a new draft.

## Deploying (Vercel + Supabase)

1. Create a Vercel project from this repo with your **personal** account.
2. Add every variable from `.env.example` in Vercel → Settings → Environment Variables. Set `APP_URL` to your production URL. For `DATABASE_URL` in production, use Supabase's **Transaction pooler** string (port 6543); it handles many short-lived serverless connections, while the session pooler (5432) is capped at 15 clients. Keep using the session pooler locally for `pnpm db:migrate`.
3. In Supabase → Authentication → URL Configuration, add `https://<your-domain>/auth/callback` and `https://<your-domain>/auth/confirm`.
4. PDF export and portfolio rendering use `@sparticuz/chromium` on Vercel automatically. A tailoring stream runs for up to about 60 s, so the route sets `maxDuration = 120`, which may need Vercel's Pro plan or Fluid compute.

## Spec deviations (SPEC-QUESTIONs)

These are marked in code with `SPEC-QUESTION`:

- **Two added columns.**
  - `vault_sources` (requested: portfolio and brief imports).
  - `applications.role_family`, so baseline applications can be split by family.
- **Selection depth-fill pass.** §7.6 alone can leave a one-page resume half empty, so a second pass fills it with strong must-have evidence.
- **Verifier output.** The fact-checker returns a verdict per claim, which is more reliable than a single yes/no.
- **Trimmed rewrite output.** The rewrite prompt returns only `bullet`, because keyword and requirement use are computed in code.
- **Callback definition.** A callback means the application ever reached callback, interview or offer, so an interview that ended in rejection still counts.
