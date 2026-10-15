import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { sniffResumeKind } from '@/lib/import/parse-resume';

describe('sniffResumeKind', () => {
  it('recognises real PDF and DOCX files', async () => {
    expect(sniffResumeKind(await readFile('tests/fixtures/sample-resume.pdf'))).toBe('pdf');
    expect(sniffResumeKind(await readFile('tests/fixtures/sample-resume.docx'))).toBe('docx');
  });
  it('rejects anything else, whatever its name says', async () => {
    expect(sniffResumeKind(await readFile('tests/fixtures/sample-resume.txt'))).toBeNull();
    expect(sniffResumeKind(new TextEncoder().encode('<html>'))).toBeNull();
  });
});
