/** `{FullName}_{Company}_{RoleTitle}.{ext}` (SPEC §11), filesystem-safe. */
export function exportFilename(
  name: string,
  company: string | null,
  role: string | null,
  ext: 'pdf' | 'docx',
): string {
  const part = (s: string | null) =>
    (s ?? '')
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '');
  return `${[part(name) || 'Resume', part(company), part(role)].filter(Boolean).join('_')}.${ext}`;
}
