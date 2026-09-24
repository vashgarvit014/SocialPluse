import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PostRecord } from './posts';
const file = () => join(process.cwd(), 'scheduled-posts.json');
export function loadPosts(): PostRecord[] {
  if (!existsSync(file())) return [];
  const posts: unknown = JSON.parse(readFileSync(file(), 'utf8'));
  if (!Array.isArray(posts) || posts.some(p => !p || typeof p.id !== 'string' || !Array.isArray(p.platforms))) throw new Error('Post storage is invalid. Existing data has not been changed.');
  return posts;
}
// Synchronous mutations within the existing single Node server. Atomic rename
// avoids partial JSON. Never replace corrupt storage with an empty array.
export function savePosts(posts: PostRecord[]) {
  const temp = `${file()}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(posts, null, 2), { mode: 0o600 });
  try {
    renameSync(temp, file());
  } catch (err) {
    // Bind-mounted host file (Docker) lives on a different mount than the
    // container's overlay where the temp file is created — rename fails with
    // EXDEV/EBUSY/EPERM (cross-device / busy). Fall back to copy+unlink which
    // is still safe for this single-instance app and preserves Docker persistence.
    const code = (err as NodeJS.ErrnoException)?.code;
    // EBUSY is observed on Docker Desktop's gRPC-FUSE/virtiofs bind mounts.
    if (code === 'EXDEV' || code === 'EPERM' || code === 'EBUSY' || code === 'EACCES' || code === 'EEXIST') {
      copyFileSync(temp, file());
      try { unlinkSync(temp); } catch {}
    } else {
      // Fallback for any other rename error as well — copy is always safe.
      try {
        copyFileSync(temp, file());
        try { unlinkSync(temp); } catch {}
      } catch {
        try { unlinkSync(temp); } catch {}
        throw err;
      }
    }
  }
}
export function updatePost(id: string, update: (post: PostRecord) => PostRecord) {
  const posts = loadPosts();
  const index = posts.findIndex(p => p.id === id);
  if (index < 0) throw new Error('Post not found');
  posts[index] = update(posts[index]); savePosts(posts); return posts[index];
}
