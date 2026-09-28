import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth/api';
import { requireApiSuperadmin } from '@/lib/auth/roles';
import { listMediaAssets, saveMediaAsset, sanitizeFilename, validateUpload } from '@/lib/media-assets';
import { logSystem, sanitizeLogValue } from '@/lib/system-log';

// GET /api/media-assets — own assets (Superadmin: ?all=1 lists everything).
export async function GET(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const all = request.nextUrl.searchParams.get('all') === '1';
  if (all) {
    const admin = await requireApiSuperadmin();
    if (admin instanceof NextResponse) return admin;
    return NextResponse.json({ assets: await listMediaAssets('', true) });
  }
  return NextResponse.json({ assets: await listMediaAssets(session.userId) });
}

// POST /api/media-assets — multipart form-data, one or more files under
// field "files". Per-file validation (extension + mime + size + magic
// bytes) with per-file results so one bad file never blocks the rest.
export async function POST(request: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid upload body. Send multipart form-data with files.' }, { status: 400 });
  }
  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return NextResponse.json({ error: 'No files received.' }, { status: 400 });
  }
  if (files.length > 10) {
    return NextResponse.json({ error: 'Upload at most 10 files at once.' }, { status: 400 });
  }

  const uploaded: Array<{ id: string; filename: string; type: string; mime: string; size: number; source: string; createdAt: string }> = [];
  const failed: Array<{ filename: string; error: string }> = [];
  for (const file of files.slice(0, 10)) {
    const filename = sanitizeFilename(file.name);
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const checked = validateUpload(filename, file.type, file.size, bytes);
      if (checked.error) {
        failed.push({ filename, error: checked.error });
        logSystem({ level: 'WARN', category: 'MEDIA', event: 'MEDIA_UPLOAD_FAILED', userId: session.userId, resourceId: filename, message: `Upload rejected: ${sanitizeLogValue(checked.error)}` });
        continue;
      }
      const asset = await saveMediaAsset({ userId: session.userId, filename, mime: file.type, bytes, source: 'UPLOAD' });
      uploaded.push({ id: asset.id, filename: asset.filename, type: asset.type, mime: asset.mime, size: asset.size, source: asset.source, createdAt: asset.createdAt });
      logSystem({
        level: 'SUCCESS', category: 'MEDIA', event: 'MEDIA_UPLOADED', userId: session.userId, resourceId: asset.id,
        message: `Uploaded ${asset.filename} (${(asset.size / 1024 / 1024).toFixed(1)} MB)`,
        metadata: { filename: asset.filename, size: asset.size, mime: asset.mime, type: asset.type },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      failed.push({ filename, error: msg });
      logSystem({ level: 'ERROR', category: 'MEDIA', event: 'MEDIA_UPLOAD_FAILED', userId: session.userId, resourceId: filename, message: sanitizeLogValue(msg) });
    }
  }
  return NextResponse.json({ uploaded, failed }, { status: failed.length > 0 && uploaded.length === 0 ? 400 : 200 });
}
