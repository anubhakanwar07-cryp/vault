import 'server-only';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type ResumeKind = 'pdf' | 'docx';

export function resumeKind(name: string, mime: string): ResumeKind | null {
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    /\.docx$/i.test(name)
  )
    return 'docx';
  return null;
}

/** Plain text from a resume file (SPEC §6.2 step 1). */
export async function extractResumeText(data: Uint8Array, kind: ResumeKind): Promise<string> {
  let text: string;
  if (kind === 'pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data });
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  } else {
    const mammoth = await import('mammoth');
    text = (await mammoth.extractRawText({ buffer: Buffer.from(data) })).value;
  }
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
