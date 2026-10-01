'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaItem } from './social-media-manager';

interface StoredAsset {
  id: string;
  filename: string;
  type: 'image' | 'video';
  mime: string;
  size: number;
  /** Real origin of the asset. Never fabricated. */
  source: 'UPLOAD' | 'AI_GENERATED' | 'CANVA_IMPORT' | 'BRANDED' | 'CAROUSEL' | 'OTHER' | string;
  width: number | null;
  height: number | null;
  altText: string | null;
  createdAt: string;
  updatedAt: string;
  /** created_at + 30 days. The server hides the asset once this passes. */
  expiresAt: string;
}

type SourceFilter = 'ALL' | 'UPLOAD' | 'AI_GENERATED' | 'CANVA_IMPORT' | 'BRANDED' | 'SESSION';
type FileState = 'queued' | 'uploading' | 'done' | 'error';

interface QueuedFile {
  key: string;
  file: File;
  progress: number;
  state: FileState;
  error?: string;
}

const ACCEPT = '.jpg,.jpeg,.png,.webp,.mp4,.mov';
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_VIDEO = 50 * 1024 * 1024;

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

const SOURCE_LABELS: Record<string, string> = {
  UPLOAD: 'Uploaded',
  AI_GENERATED: 'AI generated',
  CANVA_IMPORT: 'Canva import',
  BRANDED: 'Branded',
  CAROUSEL: 'Carousel',
  OTHER: 'Other',
};

/** Legacy source values kept readable for rows written before normalisation. */
function sourceLabel(source: string): string {
  if (SOURCE_LABELS[source]) return SOURCE_LABELS[source];
  if (source === 'AI') return 'AI generated';
  if (source === 'CANVA') return 'Canva import';
  if (source === 'SESSION') return 'Session';
  return source.replace(/_/g, ' ').toLowerCase();
}

/** "Expires in 23 days" / "Expires today" — the 30-day retention countdown. */
function expiryLabel(expiresAt: string): string {
  const ms = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(ms)) return '';
  const days = Math.ceil(ms / 86400000);
  if (days <= 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  return `Expires in ${days} days`;
}

const FILTERS: Array<{ key: SourceFilter; label: string }> = [
  { key: 'ALL', label: 'All Assets' },
  { key: 'UPLOAD', label: 'Uploaded' },
  { key: 'AI_GENERATED', label: 'AI generated' },
  { key: 'CANVA_IMPORT', label: 'Canva' },
  { key: 'BRANDED', label: 'Branded' },
  { key: 'SESSION', label: 'Session' },
];

function clientCheck(file: File): string | null {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const isImage = file.type.startsWith('image/') && ['jpg', 'jpeg', 'png', 'webp'].includes(ext);
  const isVideo = file.type.startsWith('video/') && ['mp4', 'mov'].includes(ext);
  if (!isImage && !isVideo) return `${file.name}: unsupported type. Images: JPG, JPEG, PNG, WEBP. Videos: MP4, MOV.`;
  const cap = isVideo ? MAX_VIDEO : MAX_IMAGE;
  if (file.size > cap) return `${file.name}: too large. Max ${isVideo ? '50MB' : '10MB'}.`;
  if (file.size === 0) return `${file.name}: empty file.`;
  return null;
}

export default function AssetLibrary({ sessionItems, onUseAsset }: {
  sessionItems: MediaItem[];
  onUseAsset: (item: { url: string; type: 'image' | 'video'; name: string }) => void;
}) {
  const [assets, setAssets] = useState<StoredAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<SourceFilter>('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; type: 'image' | 'video'; name: string; note?: string } | null>(null);
  const [useBusyId, setUseBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const uploadingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/media-assets');
      const data = await res.json();
      if (res.ok && Array.isArray(data.assets)) setAssets(data.assets);
    } catch { /* gallery keeps session items regardless */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/media-assets')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then((data: { assets?: StoredAsset[] }) => {
        if (!cancelled && Array.isArray(data.assets)) setAssets(data.assets);
      })
      .catch(() => { /* gallery keeps session items regardless */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function addFiles(files: FileList | File[]) {
    const list = Array.from(files || []);
    if (list.length === 0) return;
    setNotice('');
    setQueue(prev => {
      const room = Math.max(0, 10 - prev.filter(q => q.state === 'queued' || q.state === 'uploading').length);
      const next = list.slice(0, Math.max(room, 0)).map((file, i) => {
        const err = clientCheck(file);
        return {
          key: `${Date.now().toString(36)}${i}${Math.random().toString(36).slice(2, 6)}`,
          file,
          progress: 0,
          state: (err ? 'error' : 'queued') as FileState,
          error: err || undefined,
        };
      });
      if (list.length > next.length) setNotice(`Only 10 files at once — ${list.length - next.length} skipped.`);
      return [...prev, ...next];
    });
  }

  function uploadOne(q: QueuedFile): Promise<void> {
    return new Promise(resolve => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/media-assets');
      xhr.upload.onprogress = e => {
        if (!e.lengthComputable) return;
        const progress = Math.round((e.loaded / e.total) * 100);
        setQueue(prev => prev.map(x => (x.key === q.key ? { ...x, progress } : x)));
      };
      xhr.onload = () => {
        let body: { uploaded?: StoredAsset[]; failed?: Array<{ filename: string; error: string }>; error?: string } = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* fall through */ }
        if (xhr.status >= 200 && xhr.status < 300 && (body.uploaded || []).length > 0) {
          const done = (body.uploaded || [])[0];
          setAssets(prev => [done, ...prev.filter(a => a.id !== done.id)]);
          setQueue(prev => prev.map(x => (x.key === q.key ? { ...x, state: 'done', progress: 100 } : x)));
        } else {
          const msg = body.failed?.[0]?.error || body.error || `Upload failed (${xhr.status}).`;
          setQueue(prev => prev.map(x => (x.key === q.key ? { ...x, state: 'error', error: msg } : x)));
        }
        resolve();
      };
      xhr.onerror = () => {
        setQueue(prev => prev.map(x => (x.key === q.key ? { ...x, state: 'error', error: 'Network error.' } : x)));
        resolve();
      };
      const form = new FormData();
      form.append('files', q.file, q.file.name);
      setQueue(prev => prev.map(x => (x.key === q.key ? { ...x, state: 'uploading', progress: 0 } : x)));
      xhr.send(form);
    });
  }

  async function uploadAll() {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    try {
      const pending = queue.filter(q => q.state === 'queued' || q.state === 'error');
      for (const q of pending) {
        await uploadOne({ ...q, state: 'queued', progress: q.state === 'error' ? 0 : q.progress, error: undefined });
      }
      await load();
    } finally {
      uploadingRef.current = false;
    }
  }

  async function removeAsset(id: string, filename: string) {
    if (!window.confirm(`Delete "${filename}" permanently?`)) return;
    try {
      const res = await fetch(`/api/media-assets/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setNotice(typeof data.error === 'string' ? data.error : 'Could not delete the asset.');
        return;
      }
      setAssets(prev => prev.filter(a => a.id !== id));
    } catch {
      setNotice('Network error. Please try again.');
    }
  }

  // Takes the projected card, which only carries the fields the editor needs.
  async function loadAssetForEditor(a: { id: string; filename: string; type: 'image' | 'video' }) {
    if (useBusyId) return;
    setUseBusyId(a.id);
    try {
      const res = await fetch(`/api/media-assets/${encodeURIComponent(a.id)}`);
      if (!res.ok) throw new Error('Could not load the asset.');
      const blob = await res.blob();
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Could not read the asset.'));
        reader.readAsDataURL(blob);
      });
      onUseAsset({ url: dataUrl, type: a.type, name: a.filename });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not use the asset.');
    } finally {
      setUseBusyId(null);
    }
  }

  const sessionCards = sessionItems.map(m => ({ key: `s-${m.id}`, kind: 'SESSION' as const, name: m.name || 'session media', type: m.type, url: m.url, date: '' }));
  // Preview URLs point at /api/media-assets/:id, which verifies ownership
  // before returning bytes — so a card here can only ever resolve to this
  // user's own asset, and a copied URL 404s for anybody else.
  const storedCards = assets
    .filter(a => filter === 'ALL' || a.source === filter)
    .map(a => ({
      key: `u-${a.id}`,
      kind: 'UPLOAD' as const,
      name: a.filename,
      type: a.type,
      url: `/api/media-assets/${encodeURIComponent(a.id)}`,
      date: fmtDate(a.createdAt),
      id: a.id,
      size: fmtSize(a.size),
      source: a.source,
      expires: expiryLabel(a.expiresAt),
      dimensions: a.width && a.height ? `${a.width}×${a.height}` : '',
    }));
  const visibleSession = filter === 'ALL' || filter === 'SESSION' ? sessionCards : [];
  const visible = filter === 'SESSION' ? visibleSession : [...storedCards, ...visibleSession];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E8EAF1', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: 'linear-gradient(135deg,#7C3AED,#8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🖼️</div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>Asset Gallery</div>
          <div style={{ fontSize: 11, color: '#64748B' }}>
            Manage your images, videos and generated content. {assets.length} saved • {sessionItems.length} session files • each saved asset is kept for 30 days
          </div>
        </div>
        <button onClick={() => { setModalOpen(true); setNotice(''); }} style={{ padding: '9px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, border: 'none', background: 'linear-gradient(135deg,#7C3AED,#8B5CF6)', color: '#fff', cursor: 'pointer' }}>+ Upload Media</button>
      </div>

      {notice && <div style={{ fontSize: 12.5, color: '#B91C1C', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 12px' }}>{notice}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              padding: '7px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              border: filter === f.key ? '2px solid #7C3AED' : '1.5px solid #E8EAF1',
              backgroundColor: filter === f.key ? '#F5F0FF' : '#fff',
              color: filter === f.key ? '#6D28D9' : '#64748B',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E8EAF1', padding: 18 }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#94A3B8', fontSize: 12, padding: 32 }}>Loading library…</div>
        ) : visible.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#94A3B8', fontSize: 12, padding: 32 }}>
            {filter === 'SESSION'
              ? 'No files in the current editing session. Saved assets are kept in the other tabs.'
              : filter === 'UPLOAD'
                ? 'No uploads yet — click + Upload Media to add your first files.'
                : filter === 'AI_GENERATED'
                  ? 'No AI-generated images yet. Generate one in the studio and it will appear here.'
                  : filter === 'CANVA_IMPORT'
                    ? 'No Canva imports yet.'
                    : 'Nothing here yet.'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
            {visible.map(c => (
              <div key={c.key} style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid #E8EAF1', backgroundColor: '#fff', display: 'flex', flexDirection: 'column' }}>
                <button onClick={() => setLightbox({ url: c.url, type: c.type, name: c.name, note: 'expires' in c && c.expires ? c.expires : undefined })} title="Preview" style={{ border: 'none', padding: 0, cursor: 'zoom-in', background: '#000', aspectRatio: '1', display: 'block', width: '100%' }}>
                  {c.type === 'video'
                    ? <video src={c.url} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} muted preload="metadata" />
                    : <img src={c.url} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                </button>
                <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.name}>{c.name}</div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#6D28D9', backgroundColor: '#F5F0FF', border: '1px solid #DDD6FE', padding: '2px 8px', borderRadius: 999 }}>{c.type}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: c.kind === 'UPLOAD' ? '#065F46' : '#475569', backgroundColor: c.kind === 'UPLOAD' ? '#ECFDF5' : '#F1F5F9', border: '1px solid #E2E8F0', padding: '2px 8px', borderRadius: 999 }}>{c.kind === 'UPLOAD' ? sourceLabel(c.source) : 'Session'}</span>
                    {'date' in c && c.date ? <span style={{ fontSize: 10, color: '#94A3B8' }}>{c.date}</span> : null}
                    {'size' in c && c.size ? <span style={{ fontSize: 10, color: '#94A3B8' }}>{c.size}</span> : null}
                    {'dimensions' in c && c.dimensions ? <span style={{ fontSize: 10, color: '#94A3B8' }}>{c.dimensions}</span> : null}
                  </div>
                  {'expires' in c && c.expires ? (
                    <div style={{ fontSize: 10, color: '#B45309', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', padding: '2px 8px', borderRadius: 999, alignSelf: 'flex-start' }}>
                      {c.expires}
                    </div>
                  ) : null}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setLightbox({ url: c.url, type: c.type, name: c.name, note: 'expires' in c && c.expires ? c.expires : undefined })} style={{ flex: 1, padding: '6px 0', borderRadius: 7, fontSize: 11, fontWeight: 700, border: '1px solid #E2E8F0', background: '#fff', color: '#334155', cursor: 'pointer' }}>Preview</button>
                    <button
                      onClick={() => {
                        if (c.kind === 'UPLOAD') void loadAssetForEditor({ id: (c as { id: string }).id, filename: c.name, type: c.type });
                        else onUseAsset({ url: c.url, type: c.type, name: c.name });
                      }}
                      disabled={useBusyId !== null}
                      style={{ flex: 1, padding: '6px 0', borderRadius: 7, fontSize: 11, fontWeight: 700, border: 'none', background: 'linear-gradient(135deg,#7C3AED,#8B5CF6)', color: '#fff', cursor: useBusyId !== null ? 'wait' : 'pointer' }}
                    >
                      {c.kind === 'UPLOAD' && useBusyId ? '…' : 'Use'}
                    </button>
                    {c.kind === 'UPLOAD' && (
                      <button onClick={() => removeAsset((c as { id: string }).id, c.name)} style={{ padding: '6px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer' }}>🗑</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <div onClick={() => setModalOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1000, backgroundColor: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div role="dialog" aria-modal="true" aria-label="Upload media" onClick={e => e.stopPropagation()} style={{ width: 'min(560px, 94vw)', maxHeight: '88vh', overflowY: 'auto', backgroundColor: '#fff', borderRadius: 18, padding: 22, fontFamily: 'inherit' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 4 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A' }}>Upload Media</div>
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>Images: JPG, JPEG, PNG, WEBP (max 10MB) • Videos: MP4, MOV (max 50MB) • up to 10 files</div>
              </div>
              <button onClick={() => setModalOpen(false)} aria-label="Close" style={{ width: 30, height: 30, borderRadius: 9, border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', cursor: 'pointer' }}>✕</button>
            </div>

            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
              onClick={() => fileRef.current?.click()}
              style={{ marginTop: 14, border: `2px dashed ${dragOver ? '#7C3AED' : '#CBD5E1'}`, borderRadius: 14, backgroundColor: dragOver ? '#F5F0FF' : '#F8FAFC', padding: '30px 18px', textAlign: 'center', cursor: 'pointer' }}
            >
              <div style={{ fontSize: 28 }}>📤</div>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: '#0F172A', marginTop: 8 }}>Drag files here</div>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>or <span style={{ color: '#6D28D9', fontWeight: 800 }}>Browse Files</span></div>
              <input ref={fileRef} type="file" accept={ACCEPT} multiple style={{ display: 'none' }} onChange={e => { addFiles(e.target.files || []); e.target.value = ''; }} />
            </div>

            {queue.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                {queue.map(q => (
                  <div key={q.key} style={{ border: '1px solid #E2E8F0', borderRadius: 10, padding: '9px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.file.name}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: q.state === 'done' ? '#059669' : q.state === 'error' ? '#DC2626' : '#6D28D9', whiteSpace: 'nowrap' }}>
                        {q.state === 'done' ? '✓ 100%' : q.state === 'error' ? 'Failed' : q.state === 'uploading' ? `${q.progress}%` : 'Queued'}
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 4, backgroundColor: '#F1F5F9', marginTop: 7, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${q.state === 'done' ? 100 : q.progress}%`, borderRadius: 4, background: q.state === 'error' ? '#FCA5A5' : 'linear-gradient(90deg,#7C3AED,#A855F7)', transition: 'width 0.2s' }} />
                    </div>
                    {q.state === 'error' && q.error && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                        <span style={{ fontSize: 11.5, color: '#B91C1C' }}>{q.error}</span>
                        {!q.error.startsWith('Unsupported') && !q.error.includes('too large') && (
                          <button onClick={() => { setQueue(prev => prev.map(x => (x.key === q.key ? { ...x, state: 'queued' as FileState, progress: 0, error: undefined } : x))); }} style={{ fontSize: 11, fontWeight: 800, color: '#6D28D9', background: 'none', border: 'none', cursor: 'pointer' }}>Retry</button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={() => { setModalOpen(false); setQueue([]); }} style={{ flex: 1, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 700, border: '1px solid #E2E8F0', background: '#fff', color: '#475569', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={uploadAll} disabled={!queue.some(q => q.state === 'queued' || q.state === 'error')} style={{ flex: 2, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 800, border: 'none', background: queue.some(q => q.state === 'queued' || q.state === 'error') ? 'linear-gradient(135deg,#7C3AED,#A855F7)' : '#E2E8F0', color: '#fff', cursor: queue.some(q => q.state === 'queued' || q.state === 'error') ? 'pointer' : 'default', fontFamily: 'inherit' }}>Upload</button>
            </div>
            {queue.some(q => q.state === 'done') && !queue.some(q => q.state === 'queued' || q.state === 'uploading') && (
              <button onClick={() => { setModalOpen(false); setQueue([]); }} style={{ width: '100%', marginTop: 10, padding: '11px 0', borderRadius: 10, fontSize: 13, fontWeight: 800, border: 'none', background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Done — Close</button>
            )}
          </div>
        </div>
      )}

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, zIndex: 1100, backgroundColor: 'rgba(15,23,42,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ maxWidth: 'min(720px, 92vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', gap: 10 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ color: '#fff', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lightbox.name}</div>
              {lightbox.note ? <div style={{ color: '#CBD5E1', fontSize: 11 }}>{lightbox.note}</div> : null}
            </div>
            {lightbox.type === 'video'
              ? <video src={lightbox.url} controls style={{ maxWidth: '100%', maxHeight: '76vh', borderRadius: 12 }} />
              : <img src={lightbox.url} alt={lightbox.name} style={{ maxWidth: '100%', maxHeight: '76vh', borderRadius: 12, objectFit: 'contain' }} />}
          </div>
        </div>
      )}
    </div>
  );
}
