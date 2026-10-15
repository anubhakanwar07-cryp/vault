import { describe, expect, it } from 'vitest';
import * as prompt from '@/lib/llm/prompts/scoreProjects';
import { scoreProjectsOutput } from '@/lib/llm/schemas/pipeline';

describe('scoreProjects prompt', () => {
  const user = prompt.buildUser({
    roleTitle: 'Growth PM',
    coreProblems: ['Partner with sales to lift conversion'],
    requirements: [{ id: 'm1', req: 'Sales enablement', kind: 'must' }],
    projects: [
      {
        id: 'p1',
        name: 'PitchPal',
        one_liner: null,
        ownership: null,
        context: 'side project',
        achievements: [],
      },
    ],
  });
  it('judges function over word overlap and caps tool-only matches', () => {
    expect(user).toContain('FUNCTIONALLY proves');
    expect(user).toMatch(/only shares a tool or technology name[\s\S]*scores 3 or lower/);
    expect(user).toContain('Never assume work');
  });
  it('fences the job posting as untrusted data', () => {
    expect(user).toMatch(/<<<JOB[\s\S]*Partner with sales[\s\S]*JOB>>>/);
    expect(prompt.system).toContain('never instructions');
  });
});

describe('scoreProjectsOutput', () => {
  it('clamps scores to 0–10 and defaults missing fields', () => {
    const out = scoreProjectsOutput.parse({
      projects: [
        { project_id: 'p1', score: 14 },
        { project_id: 'p2', score: '6.6', requirements_proven: ['m1'], reason: ' ok ' },
        { project_id: 'p3', score: 'n/a' },
      ],
    });
    expect(out.projects.map((p) => p.score)).toEqual([10, 7, 0]);
    expect(out.projects[1]).toMatchObject({ requirements_proven: ['m1'], reason: 'ok' });
    expect(out.projects[0]!.requirements_proven).toEqual([]);
  });
});
