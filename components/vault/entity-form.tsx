'use client';

import { useTransition } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ActionResult } from '@/lib/actions';
import { cn } from '@/lib/utils';
import type { FieldDef, FormValues } from './fields';
import { TagInput } from './tag-input';

const selectClass =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

/** Config-driven form for vault entities. Validation happens server-side with the shared Zod schemas. */
export function EntityForm({
  fields,
  defaultValues,
  onSubmit,
  onSaved,
  submitLabel = 'Save',
  extraActions,
}: {
  fields: readonly FieldDef[];
  defaultValues: FormValues;
  onSubmit: (values: FormValues) => Promise<ActionResult<string>>;
  onSaved?: (id: string) => void;
  submitLabel?: string;
  extraActions?: React.ReactNode;
}) {
  const form = useForm<FormValues>({ defaultValues });
  const [pending, startTransition] = useTransition();
  const formError = form.formState.errors._form?.message;

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const res = await onSubmit(values);
      if (!res.ok) {
        for (const [name, message] of Object.entries(res.fieldErrors ?? {})) {
          form.setError(name, { message });
        }
        if (!res.fieldErrors) form.setError('_form', { message: res.error });
        return;
      }
      if (res.warning) toast.warning(res.warning);
      else toast.success('Saved');
      onSaved?.(res.data);
    }),
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => {
          const error = form.formState.errors[f.name]?.message;
          const id = `field-${f.name}`;
          return (
            <div
              key={f.name}
              className={cn(
                'flex flex-col gap-1.5',
                (f.wide || f.type === 'textarea' || f.type === 'tags') && 'sm:col-span-2',
              )}
            >
              {f.type !== 'checkbox' && (
                <Label htmlFor={id}>
                  {f.label}
                  {f.required && <span className="text-destructive">*</span>}
                </Label>
              )}
              {f.type === 'textarea' ? (
                <Textarea
                  id={id}
                  placeholder={f.placeholder}
                  rows={3}
                  aria-invalid={!!error}
                  {...form.register(f.name)}
                />
              ) : f.type === 'select' ? (
                <select
                  id={id}
                  className={selectClass}
                  aria-invalid={!!error}
                  {...form.register(f.name)}
                >
                  <option value="">—</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === 'tags' ? (
                <Controller
                  control={form.control}
                  name={f.name}
                  render={({ field }) => (
                    <TagInput
                      id={id}
                      value={Array.isArray(field.value) ? field.value : []}
                      onChange={field.onChange}
                      suggestions={f.suggestions}
                      placeholder={f.placeholder}
                    />
                  )}
                />
              ) : f.type === 'checkbox' ? (
                <Controller
                  control={form.control}
                  name={f.name}
                  render={({ field }) => (
                    <label htmlFor={id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        id={id}
                        checked={field.value === true}
                        onCheckedChange={(c) => field.onChange(c === true)}
                      />
                      {f.label}
                    </label>
                  )}
                />
              ) : (
                <Input
                  id={id}
                  type={f.type === 'month' ? 'month' : f.type === 'url' ? 'url' : 'text'}
                  placeholder={f.placeholder}
                  aria-invalid={!!error}
                  {...form.register(f.name)}
                />
              )}
              {f.hint && !error && <p className="text-xs text-muted-foreground">{f.hint}</p>}
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          );
        })}
      </div>
      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
        {extraActions}
      </div>
    </form>
  );
}
