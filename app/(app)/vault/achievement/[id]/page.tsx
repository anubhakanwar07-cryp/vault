import { notFound } from 'next/navigation';
import { AchievementEditor } from '@/components/vault/achievement-editor';
import type { FormValues } from '@/components/vault/fields';
import { ScoreBar } from '@/components/vault/score-bar';
import { requireUser } from '@/lib/auth';
import { getAchievement, getVaultTree } from '@/lib/db/queries/vault';

export default async function AchievementPage({
  params,
  searchParams,
}: PageProps<'/vault/achievement/[id]'>) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const isNew = id === 'new';

  const tree = await getVaultTree(user.id);
  const projectOptions = [
    ...tree.roles.flatMap((r) =>
      r.projects.map((p) => ({ value: p.id, label: `${p.name} (${r.title}, ${r.company})` })),
    ),
    ...tree.sideProjects.map((p) => ({ value: p.id, label: `${p.name} (side project)` })),
  ];

  let values: FormValues;
  let score: number | null = null;
  if (isNew) {
    const projectId = typeof sp.projectId === 'string' ? sp.projectId : '';
    values = {
      projectId,
      situation: '',
      action: '',
      result: '',
      metricValue: '',
      metricConfidence: 'none',
      skills: [],
      tools: [],
      functionTags: [],
      domainTags: [],
      senioritySignals: [],
      rawNotes: typeof sp.note === 'string' ? sp.note : '',
    };
  } else {
    const row = await getAchievement(user.id, id).catch(() => null);
    if (!row) notFound();
    const a = row.achievement;
    score = a.completenessScore;
    values = {
      projectId: a.projectId ?? '',
      situation: a.situation ?? '',
      action: a.action,
      result: a.result ?? '',
      metricValue: a.metricValue ?? '',
      metricConfidence: a.metricConfidence,
      skills: a.skills,
      tools: a.tools,
      functionTags: a.functionTags,
      domainTags: a.domainTags,
      senioritySignals: a.senioritySignals,
      rawNotes: a.rawNotes ?? '',
    };
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {isNew ? 'New achievement' : 'Achievement'}
        </h1>
        <p className="text-sm text-muted-foreground">
          Record what actually happened. Resumes can reframe this, but never add to it.
        </p>
        {score !== null && (
          <div className="flex items-center gap-2 text-sm">
            Completeness <ScoreBar score={score} />
          </div>
        )}
      </div>
      <AchievementEditor id={isNew ? null : id} values={values} projectOptions={projectOptions} />
    </div>
  );
}
