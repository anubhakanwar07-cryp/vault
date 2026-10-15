import type { ParsedJD } from '@/lib/llm/schemas/jd';

/** An achievement with everything the pipeline needs about its project and role. */
export type AchievementRecord = {
  id: string;
  situation: string | null;
  action: string;
  result: string | null;
  metricValue: string | null;
  metricConfidence: 'exact' | 'estimate' | 'none';
  skills: string[];
  tools: string[];
  functionTags: string[];
  domainTags: string[];
  senioritySignals: string[];
  rawNotes: string | null;
  project: {
    id: string;
    name: string;
    oneLiner: string | null;
    ownership: string | null;
    proofUrl: string | null;
    isSideProject: boolean;
    startDate: string | null;
    endDate: string | null;
  } | null;
  role: {
    id: string;
    title: string;
    company: string;
    location: string | null;
    startDate: string;
    endDate: string | null;
  } | null;
};

export type Requirement = { id: string; req: string; weight: number; kind: 'must' | 'nice' };

export function requirementsOf(jd: ParsedJD): Requirement[] {
  return [
    ...jd.must_haves.map((m) => ({
      id: m.id,
      req: m.req,
      weight: m.weight,
      kind: 'must' as const,
    })),
    ...jd.nice_to_haves.map((n) => ({
      id: n.id,
      req: n.req,
      weight: n.weight,
      kind: 'nice' as const,
    })),
  ];
}

export type Score = 0 | 1 | 2 | 3;
export type EvidenceMatrix = Record<string, Record<string, { score: Score; reason: string }>>;

/** Stage 4a: how relevant each project is for the JD as a whole (keyed by project id). */
export type ProjectScore = { score: number; requirementsProven: string[]; reason: string };
export type ProjectScores = Record<string, ProjectScore>;

export type SelectedProject = { projectId: string; achievementIds: string[] };
export type Selection = {
  roles: { roleId: string; projects: SelectedProject[]; gapFill?: boolean }[];
  sideProjects: SelectedProject[];
  coverage: Record<string, { bestScore: number; achievementId: string | null }>;
  gaps: string[];
  /** marginal value at pick time — used for ordering and the swap UI */
  pickValue: Record<string, number>;
  /** The chosen projects, best first (Stage A). */
  rankedProjects: string[];
};

export type StageName =
  | 'parse_jd'
  | 'retrieve'
  | 'score_projects'
  | 'score'
  | 'select'
  | 'rewrite'
  | 'verify'
  | 'recruiter_sim'
  | 'assemble'
  | 'done';

export type ProgressEvent = {
  stage: StageName;
  status: 'start' | 'done' | 'error';
  message: string;
  resumeId?: string;
};
