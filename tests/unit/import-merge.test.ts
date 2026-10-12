import { describe, expect, it } from 'vitest';
import {
  dedupeWithinProjects,
  resolveMerge,
  similarity,
  type ExistingVault,
} from '@/lib/import/merge';
import { importResumeOutput } from '@/lib/llm/schemas/import';

const ROLE = '11111111-1111-4111-8111-111111111111';
const PROJ = '22222222-2222-4222-8222-222222222222';
const SIDE = '33333333-3333-4333-8333-333333333333';
const FOREIGN = '99999999-9999-4999-8999-999999999999';

const vault: ExistingVault = {
  roles: [
    {
      id: ROLE,
      title: 'APM',
      company: 'LearnLoop',
      startDate: '2023-06-01',
      endDate: null,
      projects: [
        {
          id: PROJ,
          name: 'AI homework helper',
          oneLiner: null,
          achievements: [{ action: 'Launched an AI homework helper using GPT-4 and LangChain' }],
        },
      ],
    },
  ],
  sideProjects: [{ id: SIDE, name: 'Resume Ranker', oneLiner: null, achievements: [] }],
};

const parse = (o: unknown) => importResumeOutput.parse(o);

describe('resolveMerge', () => {
  it('keeps valid existing ids and labels them', () => {
    const { draft, merge } = resolveMerge(
      parse({
        roles: [
          {
            existing_role_id: ROLE,
            company: 'LearnLoop',
            title: 'APM',
            projects: [
              {
                existing_project_id: PROJ,
                name: 'Helper',
                achievements: [{ action: 'Designed hint-first mode' }],
              },
            ],
          },
        ],
      }),
      vault,
    );
    expect(draft.roles[0]!.existing_role_id).toBe(ROLE);
    expect(draft.roles[0]!.projects[0]!.existing_project_id).toBe(PROJ);
    expect(merge.roleTargets['roles.0']).toBe('APM at LearnLoop');
    expect(merge.projectTargets['roles.0.projects.0']).toBe('AI homework helper');
    expect(merge.duplicates).toHaveLength(0);
  });

  it('drops ids that are not in the user’s vault', () => {
    const { draft } = resolveMerge(
      parse({
        roles: [
          {
            existing_role_id: FOREIGN,
            company: 'X',
            title: 'Y',
            projects: [{ existing_project_id: PROJ, name: 'P' }],
          },
        ],
        side_projects: [{ existing_project_id: FOREIGN, name: 'Z' }],
      }),
      vault,
    );
    expect(draft.roles[0]!.existing_role_id).toBeNull();
    // a new role can't contain an existing project
    expect(draft.roles[0]!.projects[0]!.existing_project_id).toBeNull();
    expect(draft.side_projects[0]!.existing_project_id).toBeNull();
  });

  it('refuses to merge a side project into a work project', () => {
    const { draft } = resolveMerge(
      parse({ side_projects: [{ existing_project_id: PROJ, name: 'Helper' }] }),
      vault,
    );
    expect(draft.side_projects[0]!.existing_project_id).toBeNull();
  });

  it('flags near-duplicate achievements', () => {
    const { merge } = resolveMerge(
      parse({
        side_projects: [
          {
            name: 'New thing',
            achievements: [
              { action: 'Launched the AI homework helper with GPT-4 and LangChain' },
              { action: 'Negotiated a vendor contract' },
            ],
          },
        ],
      }),
      vault,
    );
    expect(merge.duplicates).toEqual(['side_projects.0.achievements.0']);
  });
});

describe('similarity', () => {
  it('is 1 for identical text and 0 for unrelated', () => {
    expect(similarity('Built a search bar', 'Built a search bar')).toBe(1);
    expect(similarity('Built a search bar', 'Negotiated payroll')).toBe(0);
  });
});

describe('dedupeWithinProjects', () => {
  it('keeps the more informative of two near-identical achievements', () => {
    const out = dedupeWithinProjects(
      parse({
        side_projects: [
          {
            name: 'Bot',
            achievements: [
              { action: 'Built a WhatsApp ordering bot for a local bakery' },
              {
                action: 'Built a WhatsApp ordering bot for a local bakery',
                metric_value: 'about 40 orders a week',
                metric_confidence: 'estimate',
              },
              { action: 'Wrote the menu sync job in Python' },
            ],
          },
        ],
      }),
    );
    const achs = out.side_projects[0]!.achievements;
    expect(achs).toHaveLength(2);
    expect(achs[0]!.metric_value).toBe('about 40 orders a week');
  });
});
