'use client';

import { Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  deleteVaultItemAction,
  saveEducationAction,
  saveExtraAction,
  saveProjectAction,
  saveRoleAction,
} from '@/app/(app)/vault/actions';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ProjectNode, VaultTree } from '@/lib/db/queries/vault';
import type { VaultEntity } from '@/lib/db/queries/vault';
import { average, DEEPEN_THRESHOLD } from '@/lib/vault/completeness';
import { AchievementCard } from './achievement-card';
import { EntityForm } from './entity-form';
import type { FieldDef, FormValues } from './fields';
import { ScoreBar } from './score-bar';
import { educationToForm, extraToForm, formatRange, projectToForm, roleToForm } from './to-form';
import { EDUCATION_FIELDS, EXTRA_FIELDS, PROJECT_FIELDS, ROLE_FIELDS } from './vault-fields';

type Editing = {
  title: string;
  fields: FieldDef[];
  values: FormValues;
  save: (values: FormValues) => ReturnType<typeof saveRoleAction>;
} | null;

export function VaultView({ tree }: { tree: VaultTree }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [, startTransition] = useTransition();

  const roleOptions = tree.roles.map((r) => ({ value: r.id, label: `${r.title} — ${r.company}` }));
  const allScores = [...tree.roles.flatMap((r) => r.projects), ...tree.sideProjects].flatMap((p) =>
    p.achievements.map((a) => a.completenessScore),
  );
  const vaultAvg = average(allScores);
  const isEmpty = tree.roles.length === 0 && tree.sideProjects.length === 0;

  const editRole = (role?: VaultTree['roles'][number]) =>
    setEditing({
      title: role ? 'Edit role' : 'Add role',
      fields: ROLE_FIELDS,
      values: roleToForm(role),
      save: (v) => saveRoleAction(role?.id ?? null, v),
    });
  const editProject = (project?: Partial<ProjectNode>) =>
    setEditing({
      title: project?.id ? 'Edit project' : 'Add project',
      fields: PROJECT_FIELDS(roleOptions),
      values: projectToForm(project),
      save: (v) => saveProjectAction(project?.id ?? null, v),
    });

  const remove = (entity: VaultEntity, id: string, what: string) => {
    if (!confirm(`Delete ${what}? This also deletes everything inside it.`)) return;
    startTransition(async () => {
      const res = await deleteVaultItemAction(entity, id);
      if (res.ok) toast.success('Deleted');
      else toast.error(res.error);
    });
  };

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Career vault</h1>
          <p className="text-sm text-muted-foreground">
            Everything you’ve done, stored once. Resumes are built from these entries — never beyond
            them.
          </p>
          {vaultAvg !== null && (
            <div className="flex items-center gap-2 text-sm">
              Vault completeness <ScoreBar score={vaultAvg} />
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Link href="/vault/import" className={buttonVariants({ variant: 'outline' })}>
            Add work
          </Link>
          <Button onClick={() => editRole()}>
            <Plus /> Add role
          </Button>
        </div>
      </header>

      {isEmpty && (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-6">
          <p className="font-medium">Your vault is empty.</p>
          <p className="text-sm text-muted-foreground">
            The fastest start is importing your current resume — every bullet becomes an achievement
            you can deepen later.
          </p>
          <Link href="/vault/import" className={buttonVariants()}>
            Import your current resume
          </Link>
        </div>
      )}

      {tree.roles.map((role) => (
        <section key={role.id} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2">
            <div>
              <h2 className="font-semibold">
                {role.title} · {role.company}
              </h2>
              <p className="text-xs text-muted-foreground">
                {formatRange(role.startDate, role.endDate)}
                {role.location ? ` · ${role.location}` : ''}
              </p>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => editProject({ roleId: role.id })}>
                <Plus /> Project
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Edit role"
                onClick={() => editRole(role)}
              >
                <Pencil />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Delete role"
                onClick={() => remove('role', role.id, `${role.title} at ${role.company}`)}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
          {role.projects.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No projects yet. Add one to start recording achievements.
            </p>
          )}
          {role.projects.map((p) => (
            <ProjectBlock
              key={p.id}
              project={p}
              onEdit={() => editProject(p)}
              onDelete={() => remove('project', p.id, p.name)}
            />
          ))}
        </section>
      ))}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between border-b pb-2">
          <h2 className="font-semibold">Side projects</h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => editProject({ roleId: null, isSideProject: true })}
          >
            <Plus /> Side project
          </Button>
        </div>
        {tree.sideProjects.map((p) => (
          <ProjectBlock
            key={p.id}
            project={p}
            onEdit={() => editProject(p)}
            onDelete={() => remove('project', p.id, p.name)}
          />
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between border-b pb-2">
          <h2 className="font-semibold">Education</h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setEditing({
                title: 'Add education',
                fields: EDUCATION_FIELDS,
                values: educationToForm(),
                save: (v) => saveEducationAction(null, v),
              })
            }
          >
            <Plus /> Education
          </Button>
        </div>
        {tree.education.map((e) => (
          <Row
            key={e.id}
            title={[e.degree, e.field].filter(Boolean).join(', ') || e.institution || 'Education'}
            sub={[e.institution, formatRange(e.startDate, e.endDate, false), e.grade]
              .filter(Boolean)
              .join(' · ')}
            onEdit={() =>
              setEditing({
                title: 'Edit education',
                fields: EDUCATION_FIELDS,
                values: educationToForm(e),
                save: (v) => saveEducationAction(e.id, v),
              })
            }
            onDelete={() => remove('education', e.id, 'this education entry')}
          />
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between border-b pb-2">
          <h2 className="font-semibold">Awards, certifications & leadership</h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setEditing({
                title: 'Add extra',
                fields: EXTRA_FIELDS,
                values: extraToForm(),
                save: (v) => saveExtraAction(null, v),
              })
            }
          >
            <Plus /> Extra
          </Button>
        </div>
        {tree.extras.map((x) => (
          <Row
            key={x.id}
            title={x.title ?? x.kind ?? 'Extra'}
            sub={[x.kind, x.issuer, x.date?.slice(0, 4)].filter(Boolean).join(' · ')}
            onEdit={() =>
              setEditing({
                title: 'Edit extra',
                fields: EXTRA_FIELDS,
                values: extraToForm(x),
                save: (v) => saveExtraAction(x.id, v),
              })
            }
            onDelete={() => remove('extra', x.id, 'this entry')}
          />
        ))}
      </section>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing?.title}</DialogTitle>
          </DialogHeader>
          {editing && (
            <EntityForm
              fields={editing.fields}
              defaultValues={editing.values}
              onSubmit={editing.save}
              onSaved={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProjectBlock({
  project,
  onEdit,
  onDelete,
}: {
  project: ProjectNode;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const avg = average(project.achievements.map((a) => a.completenessScore));
  const needsDeepening = avg === null || avg < DEEPEN_THRESHOLD;
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-muted/30 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{project.name}</h3>
          {project.oneLiner && <p className="text-xs text-muted-foreground">{project.oneLiner}</p>}
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`/vault/interview/${project.id}`}
            className={buttonVariants({
              size: 'sm',
              variant: needsDeepening ? 'default' : 'outline',
            })}
          >
            <Sparkles /> Deepen with AI
          </Link>
          <Link
            href={`/vault/achievement/new?projectId=${project.id}`}
            className={buttonVariants({ size: 'sm', variant: 'ghost' })}
          >
            <Plus /> Achievement
          </Link>
          <Button size="icon-sm" variant="ghost" aria-label="Edit project" onClick={onEdit}>
            <Pencil />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Delete project" onClick={onDelete}>
            <Trash2 />
          </Button>
        </div>
      </div>
      {project.achievements.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No achievements yet — add one or use “Deepen with AI”.
        </p>
      ) : (
        <div className="grid gap-2">
          {project.achievements.map((a) => (
            <AchievementCard key={a.id} a={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  title,
  sub,
  onEdit,
  onDelete,
}: {
  title: string;
  sub: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-sm">
      <div className="min-w-0">
        <p className="truncate">{title}</p>
        {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
      </div>
      <div className="flex shrink-0 gap-1">
        <Button size="icon-sm" variant="ghost" aria-label="Edit" onClick={onEdit}>
          <Pencil />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Delete" onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}
