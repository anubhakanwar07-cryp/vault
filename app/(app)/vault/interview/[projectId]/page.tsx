import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { getProjectWithAchievements } from '@/lib/db/queries/vault';
import { InterviewChat } from './interview-chat';

export default async function InterviewPage({ params }: PageProps<'/vault/interview/[projectId]'>) {
  const { projectId } = await params;
  const user = await requireUser();
  const data = await getProjectWithAchievements(user.id, projectId).catch(() => null);
  if (!data) notFound();
  const { project, role, achievements } = data;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Deepen: {project.name}</h1>
        <p className="text-sm text-muted-foreground">
          {role ? `${role.title} at ${role.company}` : 'Side project'} · I’ll ask a few questions,
          one at a time. I never suggest numbers — if you don’t have one, that’s fine.
        </p>
      </div>
      <InterviewChat
        projectId={project.id}
        existing={achievements.map((a) => ({
          id: a.id,
          situation: a.situation,
          action: a.action,
          result: a.result,
          metricValue: a.metricValue,
          metricConfidence: a.metricConfidence,
        }))}
      />
    </div>
  );
}
