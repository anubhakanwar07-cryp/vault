'use client';

import { EntityForm } from '@/components/vault/entity-form';
import type { FieldDef, FormValues } from '@/components/vault/fields';
import { ROLE_FAMILIES } from '@/lib/llm/schemas/vault';
import { saveProfileAction } from './actions';

const FIELDS: FieldDef[] = [
  { name: 'fullName', label: 'Full name', type: 'text', required: true },
  { name: 'email', label: 'Email on resume', type: 'text' },
  { name: 'phone', label: 'Phone', type: 'text' },
  { name: 'location', label: 'Location', type: 'text', placeholder: 'e.g. Bengaluru, India' },
  {
    name: 'links',
    label: 'Links',
    type: 'tags',
    placeholder: 'Paste a URL and press Enter (LinkedIn, portfolio, GitHub)',
  },
  {
    name: 'targetRoleFamilies',
    label: 'Roles you’re targeting',
    type: 'tags',
    suggestions: ROLE_FAMILIES,
    hint: 'Pick from the suggestions',
  },
  {
    name: 'baseSummary',
    label: 'Base summary',
    type: 'textarea',
    hint: 'Optional. Tailored resumes write their own summary from your vault.',
  },
];

export function ProfileForm({ values }: { values: FormValues }) {
  return (
    <EntityForm fields={FIELDS} defaultValues={values} onSubmit={(v) => saveProfileAction(v)} />
  );
}
