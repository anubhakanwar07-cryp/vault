'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/lib/actions';
import { requireUser } from '@/lib/auth';
import { addVaultSource } from '@/lib/db/queries/vault';
import { FetchPageError, fetchPortfolio } from '@/lib/import/fetch-page';
import type { MergeInfo } from '@/lib/import/merge';
import {
  CONTENT_TYPES,
  extractResumeText,
  MAX_UPLOAD_BYTES,
  resumeKind,
  sniffResumeKind,
  type ResumeKind,
} from '@/lib/import/parse-resume';
import { saveImport, type ImportCounts } from '@/lib/import/save-import';
import type { ImportFlag } from '@/lib/import/source-check';
import { MAX_SOURCE_TEXT, structureSource, type SourceKind } from '@/lib/import/structure';
import { LLMValidationError } from '@/lib/llm/client';
import { importResumeOutput, type ImportResumeOutput } from '@/lib/llm/schemas/import';
import { uploadUserFile } from '@/lib/storage';
import { refreshAchievements } from '@/lib/vault/embed';

export type ImportDraft = {
  draft: ImportResumeOutput;
  flags: ImportFlag[];
  merge: MergeInfo;
  sourceKind: SourceKind;
  sourceLabel: string;
};

const MIN_TEXT = 150;

type Extracted =
  | {
      text: string;
      label: string;
      url?: string;
      /** Uploaded to Storage only once the import succeeds, so failures leave no orphan files. */
      file?: { name: string; bytes: Uint8Array; kind: ResumeKind };
    }
  | { error: string };

async function extract(kind: SourceKind, formData: FormData): Promise<Extracted> {
  if (kind === 'brief') {
    const text = String(formData.get('text') ?? '').trim();
    if (text.length < 40)
      return { error: 'Write a little more — a few sentences about what you did.' };
    return { text, label: 'Your brief' };
  }

  if (kind === 'portfolio') {
    const url = String(formData.get('url') ?? '').trim();
    if (!url) return { error: 'Paste your portfolio link.' };
    try {
      const site = await fetchPortfolio(url);
      return { text: site.text, label: site.title || site.url, url: site.url };
    } catch (err) {
      if (err instanceof FetchPageError) return { error: err.userMessage };
      console.error('[import] portfolio fetch failed', err);
      return { error: 'We couldn’t read that site. Paste the text into “Write a brief” instead.' };
    }
  }

  // resume: file upload, or pasted text
  const pasted = String(formData.get('text') ?? '').trim();
  if (pasted) return { text: pasted, label: 'Pasted resume' };
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose a PDF or DOCX file, or paste your resume text.' };
  }
  if (file.size > MAX_UPLOAD_BYTES) return { error: 'That file is over 5 MB.' };
  const claimed = resumeKind(file.name, file.type);
  if (!claimed) return { error: 'Only PDF and DOCX files are supported.' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Trust the bytes, not the name or browser-supplied type.
  const fileKind = sniffResumeKind(bytes);
  if (fileKind !== claimed) {
    return {
      error: 'That file isn’t a valid PDF or DOCX. Try exporting it again, or paste the text.',
    };
  }
  try {
    const text = await extractResumeText(bytes, fileKind);
    if (text.length < MIN_TEXT) {
      return {
        error:
          'That file has almost no selectable text (it may be a scanned image). Paste the text instead.',
      };
    }
    return { text, label: file.name, file: { name: file.name, bytes, kind: fileKind } };
  } catch (err) {
    console.error('[import] text extraction failed', err);
    return { error: 'We couldn’t read that file. Try the other format, or paste the text.' };
  }
}

export async function importSourceAction(formData: FormData): Promise<ActionResult<ImportDraft>> {
  const user = await requireUser();
  const kind = z.enum(['resume', 'portfolio', 'brief']).parse(formData.get('kind'));

  const got = await extract(kind, formData);
  if ('error' in got) return { ok: false, error: got.error };
  const text = got.text.slice(0, MAX_SOURCE_TEXT);

  try {
    const { draft, flags, merge } = await structureSource(user.id, kind, text);
    const filePath = got.file
      ? await uploadUserFile(
          user.id,
          'imports',
          got.file.name,
          got.file.bytes,
          CONTENT_TYPES[got.file.kind],
        )
      : undefined;
    // Keep the raw source: provenance for the vault and for later fact-checking.
    await addVaultSource(user.id, {
      kind,
      title: got.label,
      url: got.url,
      filePath,
      text,
    });
    revalidatePath('/vault/import');
    return { ok: true, data: { draft, flags, merge, sourceKind: kind, sourceLabel: got.label } };
  } catch (err) {
    console.error('[import] structuring failed', err);
    return {
      ok: false,
      error:
        err instanceof LLMValidationError
          ? 'The AI couldn’t structure this reliably. Try again, or shorten the text.'
          : 'Something went wrong reading that. Please try again.',
    };
  }
}

export async function saveImportAction(
  draft: unknown,
): Promise<ActionResult<{ counts: ImportCounts }>> {
  const user = await requireUser();
  const parsed = importResumeOutput.safeParse(draft);
  if (!parsed.success) {
    return { ok: false, error: 'Some items are incomplete. Every achievement needs an action.' };
  }

  let res;
  try {
    res = await saveImport(user.id, parsed.data);
  } catch (err) {
    console.error('[import] save failed', err);
    return {
      ok: false,
      error: 'Something in your vault changed while you were reviewing. Re-import and try again.',
    };
  }
  if (!res.ok) return res;

  const { embeddingError } = await refreshAchievements(user.id, res.achievementIds);
  revalidatePath('/vault');
  revalidatePath('/dashboard');
  return {
    ok: true,
    data: { counts: res.counts },
    warning: embeddingError
      ? 'Saved, but search indexing failed — edit any achievement to retry.'
      : undefined,
  };
}
