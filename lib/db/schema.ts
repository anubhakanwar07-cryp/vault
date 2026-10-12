import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { authenticatedRole, authUid, authUsers } from 'drizzle-orm/supabase';

// ---------------------------------------------------------------------------
// Shared column helpers (SPEC §5: every table has id, created_at, updated_at;
// every user-owned table has user_id + RLS `user_id = auth.uid()`).
// updated_at is maintained by a trigger (see drizzle/0001_triggers.sql).
// ---------------------------------------------------------------------------

const id = () => uuid('id').primaryKey().defaultRandom();
const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
const userId = () =>
  uuid('user_id')
    .notNull()
    .references(() => authUsers.id, { onDelete: 'cascade' });

const ownerPolicy = (table: string) =>
  pgPolicy(`${table}_owner_all`, {
    for: 'all',
    to: authenticatedRole,
    using: sql`${sql.identifier('user_id')} = ${authUid}`,
    withCheck: sql`${sql.identifier('user_id')} = ${authUid}`,
  });

export type Link = { label: string; url: string };
export type StatusChange = { status: string; at: string };

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

export const profiles = pgTable(
  'profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    location: text('location'),
    links: jsonb('links').$type<Link[]>().notNull().default([]),
    targetRoleFamilies: text('target_role_families')
      .array()
      .notNull()
      .default(sql`'{}'`),
    baseSummary: text('base_summary'),
    pageLimit: integer('page_limit').notNull().default(1),
    ...timestamps(),
  },
  () => [ownerPolicy('profiles')],
).enableRLS();

export const roles = pgTable(
  'roles',
  {
    id: id(),
    userId: userId(),
    company: text('company').notNull(),
    title: text('title').notNull(),
    location: text('location'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'), // null = current
    employmentType: text('employment_type'), // full-time | intern | contract | freelance
    companyContext: text('company_context'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps(),
  },
  (t) => [index().on(t.userId), ownerPolicy('roles')],
).enableRLS();

export const projects = pgTable(
  'projects',
  {
    id: id(),
    userId: userId(),
    roleId: uuid('role_id').references(() => roles.id, { onDelete: 'cascade' }), // null for side projects
    name: text('name').notNull(),
    oneLiner: text('one_liner'),
    ownership: text('ownership'),
    proofUrl: text('proof_url'),
    isSideProject: boolean('is_side_project').notNull().default(false),
    startDate: date('start_date'),
    endDate: date('end_date'),
    ...timestamps(),
  },
  (t) => [index().on(t.userId), index().on(t.roleId), ownerPolicy('projects')],
).enableRLS();

export const achievements = pgTable(
  'achievements',
  {
    id: id(),
    userId: userId(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id').references(() => roles.id, { onDelete: 'cascade' }),
    situation: text('situation'),
    action: text('action').notNull(),
    result: text('result'),
    metricValue: text('metric_value'),
    metricConfidence: text('metric_confidence', { enum: ['exact', 'estimate', 'none'] })
      .notNull()
      .default('none'),
    skills: text('skills')
      .array()
      .notNull()
      .default(sql`'{}'`),
    tools: text('tools')
      .array()
      .notNull()
      .default(sql`'{}'`),
    functionTags: text('function_tags')
      .array()
      .notNull()
      .default(sql`'{}'`),
    domainTags: text('domain_tags')
      .array()
      .notNull()
      .default(sql`'{}'`),
    senioritySignals: text('seniority_signals')
      .array()
      .notNull()
      .default(sql`'{}'`),
    rawNotes: text('raw_notes'),
    completenessScore: integer('completeness_score').notNull().default(0),
    embedding: vector('embedding', { dimensions: 1536 }),
    isArchived: boolean('is_archived').notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    index().on(t.userId),
    index().on(t.projectId),
    index('achievements_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    ownerPolicy('achievements'),
  ],
).enableRLS();

export const education = pgTable(
  'education',
  {
    id: id(),
    userId: userId(),
    institution: text('institution'),
    degree: text('degree'),
    field: text('field'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    grade: text('grade'),
    highlights: text('highlights')
      .array()
      .notNull()
      .default(sql`'{}'`),
    ...timestamps(),
  },
  (t) => [index().on(t.userId), ownerPolicy('education')],
).enableRLS();

export const extras = pgTable(
  'extras',
  {
    id: id(),
    userId: userId(),
    kind: text('kind', {
      enum: ['award', 'certification', 'leadership', 'publication', 'other'],
    }),
    title: text('title'),
    issuer: text('issuer'),
    date: date('date'),
    description: text('description'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'`),
    ...timestamps(),
  },
  (t) => [index().on(t.userId), ownerPolicy('extras')],
).enableRLS();

// ---------------------------------------------------------------------------
// Jobs, resumes, applications
// ---------------------------------------------------------------------------

export const pipelineRuns = pgTable(
  'pipeline_runs',
  {
    id: id(),
    userId: userId(),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['running', 'done', 'failed'] }),
    stage: text('stage'),
    error: text('error'),
    totalTokens: integer('total_tokens'),
    totalCostUsd: numeric('total_cost_usd'),
    durationMs: integer('duration_ms'),
    ...timestamps(),
  },
  (t) => [index().on(t.userId), ownerPolicy('pipeline_runs')],
).enableRLS();

export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    userId: userId(),
    company: text('company'),
    roleTitle: text('role_title'),
    sourceUrl: text('source_url'),
    jdText: text('jd_text').notNull(),
    parsed: jsonb('parsed'), // ParsedJD (§9.1), typed via lib/llm/schemas
    parsedRaw: jsonb('parsed_raw'),
    userConfirmed: boolean('user_confirmed').notNull().default(false),
    ...timestamps(),
  },
  (t) => [index().on(t.userId), ownerPolicy('jobs')],
).enableRLS();

export const resumes = pgTable(
  'resumes',
  {
    id: id(),
    userId: userId(),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'cascade' }), // null = base resume
    version: integer('version').notNull().default(1),
    status: text('status', { enum: ['draft', 'final'] })
      .notNull()
      .default('draft'),
    content: jsonb('content').notNull(), // ResumeDoc (§7.8)
    matchReport: jsonb('match_report'),
    recruiterSim: jsonb('recruiter_sim'),
    pipelineRunId: uuid('pipeline_run_id').references(() => pipelineRuns.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (t) => [index().on(t.userId), index().on(t.jobId), ownerPolicy('resumes')],
).enableRLS();

export const resumeBullets = pgTable(
  'resume_bullets',
  {
    id: id(),
    userId: userId(),
    resumeId: uuid('resume_id')
      .notNull()
      .references(() => resumes.id, { onDelete: 'cascade' }),
    achievementId: uuid('achievement_id').references(() => achievements.id, {
      onDelete: 'set null',
    }),
    section: text('section', { enum: ['experience', 'projects'] }),
    position: integer('position'),
    generatedText: text('generated_text').notNull(),
    finalText: text('final_text').notNull(),
    keywordsUsed: text('keywords_used')
      .array()
      .notNull()
      .default(sql`'{}'`),
    requirementsCovered: text('requirements_covered')
      .array()
      .notNull()
      .default(sql`'{}'`),
    verified: boolean('verified').notNull().default(false),
    verifierNotes: jsonb('verifier_notes'),
    ...timestamps(),
  },
  (t) => [index().on(t.resumeId), ownerPolicy('resume_bullets')],
).enableRLS();

export const applications = pgTable(
  'applications',
  {
    id: id(),
    userId: userId(),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    resumeId: uuid('resume_id').references(() => resumes.id, { onDelete: 'set null' }),
    isTailored: boolean('is_tailored').notNull().default(true),
    appliedAt: date('applied_at'),
    channel: text('channel', { enum: ['portal', 'referral', 'cold-email', 'linkedin'] }),
    status: text('status', {
      enum: ['saved', 'applied', 'callback', 'interview', 'offer', 'rejected', 'ghosted'],
    })
      .notNull()
      .default('applied'),
    statusHistory: jsonb('status_history').$type<StatusChange[]>().notNull().default([]),
    notes: text('notes'),
    ...timestamps(),
  },
  (t) => [index().on(t.userId), ownerPolicy('applications')],
).enableRLS();

// ---------------------------------------------------------------------------
// Learning + observability
// ---------------------------------------------------------------------------

export const userEdits = pgTable(
  'user_edits',
  {
    id: id(),
    userId: userId(),
    resumeBulletId: uuid('resume_bullet_id').references(() => resumeBullets.id, {
      onDelete: 'cascade',
    }),
    before: text('before'),
    after: text('after'),
    diff: jsonb('diff'),
    editKind: text('edit_kind', { enum: ['rewrite', 'swap', 'delete', 'reorder'] }),
    ...timestamps(),
  },
  (t) => [index().on(t.userId), ownerPolicy('user_edits')],
).enableRLS();

export const styleRules = pgTable(
  'style_rules',
  {
    id: id(),
    userId: userId(),
    rule: text('rule').notNull(),
    evidenceCount: integer('evidence_count').notNull().default(1),
    active: boolean('active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [index().on(t.userId), ownerPolicy('style_rules')],
).enableRLS();

export const llmRuns = pgTable(
  'llm_runs',
  {
    id: id(),
    userId: userId(),
    pipelineRunId: uuid('pipeline_run_id').references(() => pipelineRuns.id, {
      onDelete: 'cascade',
    }),
    stage: text('stage').notNull(),
    model: text('model'),
    promptVersion: text('prompt_version'),
    input: jsonb('input'),
    output: jsonb('output'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    latencyMs: integer('latency_ms'),
    zodValid: boolean('zod_valid'),
    retries: integer('retries').notNull().default(0),
    error: text('error'),
    ...timestamps(),
  },
  (t) => [index().on(t.userId), index().on(t.pipelineRunId), ownerPolicy('llm_runs')],
).enableRLS();
