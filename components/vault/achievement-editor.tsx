'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { deleteVaultItemAction, saveAchievementAction } from '@/app/(app)/vault/actions';
import { Button } from '@/components/ui/button';
import { EntityForm } from './entity-form';
import type { FormValues } from './fields';
import { ACHIEVEMENT_FIELDS } from './vault-fields';

export function AchievementEditor({
  id,
  values,
  projectOptions,
}: {
  id: string | null;
  values: FormValues;
  projectOptions: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [deleting, startDelete] = useTransition();

  return (
    <EntityForm
      fields={ACHIEVEMENT_FIELDS(projectOptions)}
      defaultValues={values}
      onSubmit={(v) => saveAchievementAction(id, v)}
      onSaved={(savedId) => {
        if (!id) router.replace(`/vault/achievement/${savedId}`);
        else router.refresh();
      }}
      extraActions={
        <>
          <Button type="button" variant="ghost" onClick={() => router.push('/vault')}>
            Back to vault
          </Button>
          {id && (
            <Button
              type="button"
              variant="destructive"
              className="ml-auto"
              disabled={deleting}
              onClick={() => {
                if (!confirm('Delete this achievement?')) return;
                startDelete(async () => {
                  const res = await deleteVaultItemAction('achievement', id);
                  if (!res.ok) return void toast.error(res.error);
                  toast.success('Deleted');
                  router.push('/vault');
                });
              }}
            >
              <Trash2 /> Delete
            </Button>
          )}
        </>
      }
    />
  );
}
