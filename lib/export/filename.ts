const join = (parts: string[], ext: string) =>
  `${[parts[0] || 'Resume', ...parts.slice(1)].filter(Boolean).join('_')}.${ext}`;

/** `{FullName}_{Company}_{RoleTitle}.{ext}` (SPEC §11), ASCII and filesystem-safe. */
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
  return join([part(name), part(company), part(role)], ext);
}

/** Same name keeping any script's letters (李小龙, Zoë), for the RFC 5987 `filename*` parameter. */
export function unicodeFilename(
  name: string,
  company: string | null,
  role: string | null,
  ext: 'pdf' | 'docx',
): string {
  const part = (s: string | null) =>
    (s ?? '')
      .normalize('NFC')
      .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s+/g, '');
  return join([part(name), part(company), part(role)], ext);
}

/** Content-Disposition with an ASCII fallback and a UTF-8 name for browsers that support it. */
export function contentDisposition(ascii: string, unicode: string): string {
  const encoded = encodeURIComponent(unicode).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii.replace(/["\\\r\n]/g, '')}"; filename*=UTF-8''${encoded}`;
}
