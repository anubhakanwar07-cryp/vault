import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

/** Private bucket for resume uploads and exports (SPEC §16). Created on first use. */
export const UPLOADS_BUCKET = 'uploads';

let ensured = false;

async function ensureBucket() {
  if (ensured) return;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.storage.getBucket(UPLOADS_BUCKET);
  if (!data) {
    const { error } = await admin.storage.createBucket(UPLOADS_BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) throw error;
  }
  ensured = true;
}

/** Stores a file under `${userId}/…`. Server-only (service role); never exposed publicly. */
export async function uploadUserFile(
  userId: string,
  folder: string,
  name: string,
  data: Uint8Array,
  contentType: string,
): Promise<string> {
  await ensureBucket();
  const safe = name.replace(/[^\w.-]+/g, '_').slice(-80);
  const path = `${userId}/${folder}/${Date.now()}-${safe}`;
  const { error } = await createSupabaseAdminClient()
    .storage.from(UPLOADS_BUCKET)
    .upload(path, data, { contentType, upsert: false });
  if (error) throw error;
  return path;
}

/** 10-minute signed URL (SPEC §16). */
export async function signedUrl(path: string): Promise<string> {
  const { data, error } = await createSupabaseAdminClient()
    .storage.from(UPLOADS_BUCKET)
    .createSignedUrl(path, 600);
  if (error) throw error;
  return data.signedUrl;
}
