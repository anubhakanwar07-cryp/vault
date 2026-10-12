import {
  EMPLOYMENT_TYPES,
  EXTRA_KINDS,
  FUNCTION_TAGS,
  METRIC_CONFIDENCE,
} from '@/lib/llm/schemas/vault';
import { opts, type FieldDef } from './fields';

export const ROLE_FIELDS: FieldDef[] = [
  { name: 'company', label: 'Company', type: 'text', required: true },
  { name: 'title', label: 'Title', type: 'text', required: true },
  { name: 'startDate', label: 'Start', type: 'month', required: true },
  { name: 'endDate', label: 'End', type: 'month', hint: 'Leave empty if current' },
  { name: 'location', label: 'Location', type: 'text' },
  { name: 'employmentType', label: 'Type', type: 'select', options: opts(EMPLOYMENT_TYPES) },
  {
    name: 'companyContext',
    label: 'What the company does',
    type: 'text',
    wide: true,
    placeholder: 'One line, e.g. "Series B edtech serving 2M students"',
  },
];

export const PROJECT_FIELDS = (roleOptions: { value: string; label: string }[]): FieldDef[] => [
  { name: 'name', label: 'Project name', type: 'text', required: true },
  {
    name: 'roleId',
    label: 'Role',
    type: 'select',
    options: roleOptions,
    hint: 'Empty = side project',
  },
  { name: 'oneLiner', label: 'What it is', type: 'text', wide: true, placeholder: 'One line' },
  {
    name: 'ownership',
    label: 'What you owned vs. the team',
    type: 'textarea',
    placeholder: 'e.g. "I owned the eval pipeline; a team of 3 engineers built the app"',
  },
  { name: 'proofUrl', label: 'Proof link', type: 'url', placeholder: 'https://…' },
  { name: 'startDate', label: 'Start', type: 'month' },
  { name: 'endDate', label: 'End', type: 'month' },
];

export const ACHIEVEMENT_FIELDS = (
  projectOptions: { value: string; label: string }[],
): FieldDef[] => [
  { name: 'projectId', label: 'Project', type: 'select', options: projectOptions, wide: true },
  {
    name: 'situation',
    label: 'Situation',
    type: 'textarea',
    placeholder: 'The problem or context',
  },
  {
    name: 'action',
    label: 'What you personally did',
    type: 'textarea',
    required: true,
  },
  { name: 'result', label: 'Result', type: 'textarea', placeholder: 'What changed afterwards' },
  {
    name: 'metricValue',
    label: 'Metric',
    type: 'text',
    placeholder: 'e.g. 40%, 2,000 users, 3 weeks',
  },
  {
    name: 'metricConfidence',
    label: 'How sure is the number?',
    type: 'select',
    options: METRIC_CONFIDENCE.map((v) => ({
      value: v,
      label: v === 'exact' ? 'Exact' : v === 'estimate' ? 'Estimate (~)' : 'No number',
    })),
  },
  { name: 'skills', label: 'Skills', type: 'tags', placeholder: 'e.g. A/B testing, SQL' },
  { name: 'tools', label: 'Tools', type: 'tags', placeholder: 'e.g. Amplitude, Python' },
  { name: 'functionTags', label: 'Function', type: 'tags', suggestions: FUNCTION_TAGS },
  {
    name: 'domainTags',
    label: 'Domain',
    type: 'tags',
    suggestions: ['edtech', 'healthcare', 'b2c', 'b2b', 'fintech'],
  },
  {
    name: 'senioritySignals',
    label: 'Seniority signals',
    type: 'tags',
    placeholder: 'e.g. led team of 4, presented to founder',
  },
  {
    name: 'rawNotes',
    label: 'Notes',
    type: 'textarea',
    placeholder: 'Anything else — never shown on the resume directly',
  },
];

export const EDUCATION_FIELDS: FieldDef[] = [
  { name: 'institution', label: 'Institution', type: 'text' },
  { name: 'degree', label: 'Degree', type: 'text' },
  { name: 'field', label: 'Field', type: 'text' },
  { name: 'grade', label: 'Grade', type: 'text' },
  { name: 'startDate', label: 'Start', type: 'month' },
  { name: 'endDate', label: 'End', type: 'month' },
  { name: 'highlights', label: 'Highlights', type: 'tags' },
];

export const EXTRA_FIELDS: FieldDef[] = [
  { name: 'kind', label: 'Kind', type: 'select', options: opts(EXTRA_KINDS) },
  { name: 'title', label: 'Title', type: 'text' },
  { name: 'issuer', label: 'Issuer', type: 'text' },
  { name: 'date', label: 'Date', type: 'month' },
  { name: 'description', label: 'Description', type: 'textarea' },
  { name: 'tags', label: 'Tags', type: 'tags' },
];
