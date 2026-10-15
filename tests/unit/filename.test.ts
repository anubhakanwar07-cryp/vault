import { describe, expect, it } from 'vitest';
import { contentDisposition, exportFilename, unicodeFilename } from '@/lib/export/filename';

describe('export filenames', () => {
  it('builds Name_Company_Role (SPEC §11)', () =>
    expect(exportFilename('Aarav Mehta', 'Habitly', 'Growth PM', 'pdf')).toBe(
      'AaravMehta_Habitly_GrowthPM.pdf',
    ));

  it('strips characters that could break the header', () =>
    expect(exportFilename('A"b\r\nc', null, null, 'pdf')).toBe('Abc.pdf'));

  it('keeps non-Latin names in the UTF-8 variant', () => {
    expect(exportFilename('李小龙', '字节跳动', '产品经理', 'pdf')).toBe('Resume.pdf');
    expect(unicodeFilename('李小龙', '字节跳动', '产品经理', 'pdf')).toBe(
      '李小龙_字节跳动_产品经理.pdf',
    );
    expect(unicodeFilename('Zoë Brontë', 'Acme/Corp', null, 'docx')).toBe(
      'ZoëBrontë_AcmeCorp.docx',
    );
  });

  it('sends both filename and filename*', () => {
    const h = contentDisposition('Resume.pdf', '李小龙.pdf');
    expect(h).toContain('filename="Resume.pdf"');
    expect(h).toContain(`filename*=UTF-8''${encodeURIComponent('李小龙.pdf')}`);
    expect(h).not.toMatch(/[\r\n]/);
  });
});
