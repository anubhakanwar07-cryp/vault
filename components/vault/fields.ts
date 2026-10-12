export type FieldType = 'text' | 'textarea' | 'month' | 'select' | 'tags' | 'checkbox' | 'url';

export type FieldDef = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  options?: readonly { value: string; label: string }[];
  /** Suggested values shown as quick-add chips for tag fields. */
  suggestions?: readonly string[];
  /** Spans both columns in the 2-column grid. */
  wide?: boolean;
};

export type FormValues = Record<string, string | string[] | boolean | null>;

/** DB date (YYYY-MM-DD) → <input type="month"> value (YYYY-MM). */
export function toMonth(d: string | null | undefined): string {
  return d ? d.slice(0, 7) : '';
}

export function opts(values: readonly string[]): { value: string; label: string }[] {
  return values.map((v) => ({ value: v, label: v }));
}
