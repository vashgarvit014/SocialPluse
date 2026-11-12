'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MediaItem } from './social-media-manager';

type UploadView = {
  id: string; bytesTotal: number; bytesUploaded: number; progress: number;
  status: string; videoId?: string | null; videoUrl?: string | null;
  publishAt?: string | null; error?: string | null;
};

type Props = {
  connected: boolean;
  available: boolean;
  channelName?: string;
  channelThumbnail?: string;
  mediaItems: MediaItem[];
  generated?: { title?: string; caption: string; hashtags: string[] };
  // Step 2's choice. Without it the panel uploaded immediately even when the
  // wizard was set to "Schedule for Later".
  publishMode?: 'now' | 'later';
  scheduledAt?: string;
  onConnect: () => void;
};

type GalleryVideo = { id: string; filename: string; type: 'video'; mime: string; size: number; width: number | null; height: number | null; durationMs?: number | null };

const CHUNK_FALLBACK = 8 * 1024 * 1024;
const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', border: '1px solid #D8DEEA', borderRadius: 10, padding: '10px 12px', font: 'inherit', fontSize: 13, color: '#0F172A', background: '#fff' };
const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 800, color: '#475569', marginBottom: 5, letterSpacing: '.03em' };

function mediaSize(item: MediaItem) {
  if (item.size && item.size > 0) return item.size;
  if (item.url.startsWith('data:')) {
    const comma = item.url.indexOf(',');
    return comma >= 0 ? Math.floor((item.url.length - comma - 1) * 0.75) : 0;
  }
  return 0;
}

async function videoFacts(file: File): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => { const result = { width: video.videoWidth, height: video.videoHeight, duration: video.duration }; URL.revokeObjectURL(url); resolve(result); };
    video.onerror = () => { URL.revokeObjectURL(url); resolve({ width: 0, height: 0, duration: 0 }); };
    video.src = url;
  });
}

// datetime-local renders and parses in the viewer's local zone, so its min must
// be local too. Formatting with toISOString() put it in UTC and mis-bounded the
// field by the viewer's offset.
export function localDateTimeValue(epochMs: number): string {
  const local = new Date(epochMs - new Date(epochMs).getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

// The upload path crosses nginx, Next.js and the gateway, any of which can
// answer with an HTML error page. response.json() on that throws
// "Unexpected token '<'", which surfaced to users as a broken upload.
export function parseApiResponse(
  status: number,
  contentType: string | null,
  bodyText: string,
): { ok: boolean; data: Record<string, unknown> | null; message: string } {
  const isJson = (contentType || '').toLowerCase().includes('application/json');
  if (isJson) {
    try {
      const data = JSON.parse(bodyText) as Record<string, unknown>;
      const message = typeof data.message === 'string' ? data.message : '';
      return { ok: status >= 200 && status < 300, data, message };
    } catch { /* a JSON content-type with an unparseable body falls through */ }
  }
  // Never surface raw HTML; map the proxies' own error pages instead.
  const byStatus: Record<number, string> = {
    401: 'Your session expired. Sign in again, then resume the upload.',
    403: 'This account is not allowed to upload to YouTube.',
    404: 'The upload endpoint was not found. The server may be mid-deploy — retry shortly.',
    413: 'The server rejected the upload chunk as too large. This is a server limit, not your video — the chunk size needs raising on the proxy.',
    429: 'YouTube is rate limiting this channel. Wait a few minutes, then resume.',
    502: 'The publishing service is unreachable. Retry in a moment.',
    503: 'The publishing service is temporarily unavailable. Retry in a moment.',
    504: 'The upload timed out at the proxy. Resume to continue from the saved offset.',
  };
  return {
    ok: false,
    data: null,
    message: byStatus[status] || `The server returned an unexpected ${status} response. Resume to continue from the saved offset.`,
  };
}

async function readApi(response: Response) {
  const text = await response.text();
  return parseApiResponse(response.status, response.headers.get('content-type'), text);
}

// Pure decision helpers, exported so the rules can be tested without rendering.
export type MetadataFields = { title: string; description: string; tags: string };

export function aiMetadataPlan(
  generated: { title?: string; caption?: string; hashtags?: string[] } | undefined,
  current: MetadataFields,
  edited: Record<keyof MetadataFields, boolean>,
): { apply: Partial<MetadataFields>; clobbered: Array<keyof MetadataFields> } {
  const incoming: MetadataFields = {
    title: (generated?.title || '').trim(),
    description: (generated?.caption || '').trim(),
    tags: (generated?.hashtags || []).join(', ').trim(),
  };
  const keys: Array<keyof MetadataFields> = ['title', 'description', 'tags'];
  const apply: Partial<MetadataFields> = {};
  const clobbered: Array<keyof MetadataFields> = [];
  for (const key of keys) {
    // An empty generated value never erases what the author wrote.
    if (!incoming[key]) continue;
    apply[key] = incoming[key];
    if (edited[key] && current[key].trim() && current[key].trim() !== incoming[key]) clobbered.push(key);
  }
  return { apply, clobbered };
}

export function youtubeRequirements(input: {
  connected: boolean; sourceSize: number; title: string;
  audience: '' | 'kids' | 'general'; scheduleRequired: boolean; schedule: string; now?: number;
}): Array<{ ok: boolean; label: string }> {
  const trimmed = input.title.trim();
  const now = input.now ?? Date.now();
  // Date.parse on a zone-less datetime-local string yields local time, which is
  // what toISOString() later converts to UTC for the API.
  const when = input.schedule ? Date.parse(input.schedule) : NaN;
  const scheduleOk = !input.schedule
    ? !input.scheduleRequired
    : Number.isFinite(when) && when > now + 5 * 60_000;
  const scheduleLabel = !input.schedule
    ? (input.scheduleRequired ? 'Pick a date and time (Step 2 is set to Schedule for Later)' : 'Publishing immediately')
    : !Number.isFinite(when) ? 'That schedule is not a valid date and time'
      : when <= now + 5 * 60_000 ? 'Choose a time at least five minutes from now'
        : 'Scheduled';
  return [
    { ok: input.connected, label: input.connected ? 'YouTube channel connected' : 'Connect a YouTube channel' },
    { ok: input.sourceSize > 0, label: input.sourceSize > 0 ? 'Video selected' : 'Select a video file' },
    { ok: trimmed.length > 0 && trimmed.length <= 100, label: !trimmed ? 'Add a title' : trimmed.length > 100 ? 'Title is over 100 characters' : 'Title set' },
    { ok: input.audience !== '', label: input.audience === '' ? 'Declare the audience' : 'Audience declared' },
    { ok: scheduleOk, label: scheduleLabel },
  ];
}

export default function YouTubePublisher(p: Props) {
  const videos = p.mediaItems.filter((item) => item.type === 'video');
  const [selectedId, setSelectedId] = useState(videos[0]?.id || 'device');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(p.generated?.title || '');
  const [description, setDescription] = useState(p.generated?.caption || '');
  const [tags, setTags] = useState((p.generated?.hashtags || []).join(', '));
  const [privacyStatus, setPrivacyStatus] = useState<'private' | 'unlisted' | 'public'>('private');
  // '' means the author has not declared an audience yet. YouTube requires an
  // explicit declaration, so it must not silently default to "not for kids".
  const [audience, setAudience] = useState<'' | 'kids' | 'general'>('');
  const [schedule, setSchedule] = useState(p.publishMode === 'later' ? p.scheduledAt || '' : '');
  // Tracks which metadata fields the author typed into, so "Use AI metadata"
  // can warn before replacing their work.
  const [edited, setEdited] = useState({ title: false, description: false, tags: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [upload, setUpload] = useState<UploadView | null>(null);
  const [facts, setFacts] = useState<{ width: number; height: number; duration: number } | null>(null);
  const [galleryVideos, setGalleryVideos] = useState<GalleryVideo[]>([]);
  const [minSchedule] = useState(() => localDateTimeValue(Date.now() + 5 * 60_000));
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/media-assets').then((response) => response.ok ? response.json() : null).then((data) => {
      if (!active || !Array.isArray(data?.assets)) return;
      setGalleryVideos(data.assets.filter((asset: GalleryVideo) => asset.type === 'video'));
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!upload?.id || !['PROCESSING', 'SCHEDULED', 'PRIVATE'].includes(upload.status)) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/youtube/uploads/${encodeURIComponent(upload.id)}`);
        const parsed = await readApi(response);
        if (active && parsed.ok && parsed.data?.upload) setUpload(parsed.data.upload as UploadView);
      } catch { /* the saved provider status remains visible */ }
    };
    const timer = window.setInterval(() => { void refresh(); }, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [upload?.id, upload?.status]);

  const selectedAsset = useMemo(() => videos.find((item) => item.id === selectedId) || null, [videos, selectedId]);
  const selectedGallery = useMemo(() => selectedId.startsWith('asset:') ? galleryVideos.find((item) => `asset:${item.id}` === selectedId) || null : null, [galleryVideos, selectedId]);
  const sourceFacts = selectedGallery ? { width: selectedGallery.width || 0, height: selectedGallery.height || 0, duration: (selectedGallery.durationMs || 0) / 1000 } : facts;
  const shortsLabel = sourceFacts
    ? (sourceFacts.duration > 0 && sourceFacts.duration <= 180 && sourceFacts.height >= sourceFacts.width ? 'Appears Shorts-ready' : 'Standard video format')
    : 'Shorts check runs after choosing a device file';

  const applyAi = () => {
    const { apply, clobbered } = aiMetadataPlan(p.generated, { title, description, tags }, edited);
    if (clobbered.length && !window.confirm(`Replace your edited ${clobbered.join(', ')} with the AI version?`)) return;
    if (apply.title !== undefined) { setTitle(apply.title); setEdited((e) => ({ ...e, title: false })); }
    if (apply.description !== undefined) { setDescription(apply.description); setEdited((e) => ({ ...e, description: false })); }
    if (apply.tags !== undefined) { setTags(apply.tags); setEdited((e) => ({ ...e, tags: false })); }
  };

  const sourceSize = useMemo(
    () => (selectedId === 'device' ? file?.size || 0 : selectedGallery?.size || (selectedAsset ? mediaSize(selectedAsset) : 0)),
    [selectedId, file, selectedGallery, selectedAsset],
  );
  const trimmedTitle = title.trim();
  const scheduleRequired = p.publishMode === 'later';
  // Mirrors the server's own checks so the button never promises something
  // validateYouTubeMetadata would reject.
  const requirements = youtubeRequirements({ connected: p.connected, sourceSize, title, audience, scheduleRequired, schedule });
  const ready = requirements.every((item) => item.ok);

  async function sourceChunk(start: number, end: number): Promise<Blob | ArrayBuffer> {
    if (selectedId === 'device') {
      if (!file) throw new Error('Choose a video file first.');
      return file.slice(start, end);
    }
    if (selectedGallery) {
      const response = await fetch(`/api/media-assets/${encodeURIComponent(selectedGallery.id)}`, { headers: { Range: `bytes=${start}-${end - 1}` } });
      if (response.status !== 206 && !response.ok) throw new Error('Could not read the selected gallery video.');
      return response.arrayBuffer();
    }
    if (!selectedAsset) throw new Error('Choose a video first.');
    if (selectedAsset.sourceMediaId) {
      const response = await fetch(`/api/media-assets/${encodeURIComponent(selectedAsset.sourceMediaId)}`, { headers: { Range: `bytes=${start}-${end - 1}` } });
      if (response.status !== 206 && !response.ok) throw new Error('Could not read the selected gallery video.');
      return response.arrayBuffer();
    }
    if (selectedAsset.url.startsWith('data:')) {
      const response = await fetch(selectedAsset.url);
      const blob = await response.blob();
      return blob.slice(start, end);
    }
    const response = await fetch(selectedAsset.url, { headers: { Range: `bytes=${start}-${end - 1}` } });
    if (!response.ok) throw new Error('Could not read the selected video.');
    return response.arrayBuffer();
  }

  async function runUpload() {
    if (busy) return;
    const chosenSize = sourceSize;
    const filename = selectedId === 'device' ? file?.name || '' : selectedGallery?.filename || selectedAsset?.name || 'gallery-video.mp4';
    const mime = selectedId === 'device' ? file?.type || 'video/mp4' : selectedGallery?.mime || selectedAsset?.mime || 'video/mp4';
    if (!chosenSize) { setMessage('Choose an original device file or a saved gallery video with a known size.'); return; }
    if (!title.trim()) { setMessage('Add a YouTube title.'); return; }
    if (audience === '') { setMessage('Declare whether this video is made for kids.'); return; }
    if (scheduleRequired && !schedule) { setMessage('Step 2 is set to Schedule for Later — pick a date and time before uploading.'); return; }
    const publishAt = schedule ? new Date(schedule).toISOString() : undefined;
    setBusy(true);
    setMessage('Starting a secure resumable upload…');
    try {
      const fingerprint = `${filename}:${chosenSize}:${title.trim()}:${publishAt || 'now'}`;
      const attemptId = `yt_${Array.from(new TextEncoder().encode(fingerprint)).reduce((h, b) => Math.imul(h ^ b, 16777619), 2166136261).toString(36)}`;
      const start = await fetch('/api/youtube/uploads', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attemptId, filename, mime, size: chosenSize, title, description, tags, privacyStatus, madeForKids: audience === 'kids', publishAt }),
      });
      const started = await readApi(start);
      if (!started.ok || !started.data?.upload) throw new Error(started.message || 'Could not start the upload.');
      let current = started.data.upload as UploadView;
      const chunkSize = Number(started.data.chunkSize) || CHUNK_FALLBACK;
      setUpload(current);
      while (current.bytesUploaded < current.bytesTotal) {
        const from = current.bytesUploaded;
        const to = Math.min(from + chunkSize, current.bytesTotal);
        const chunk = await sourceChunk(from, to);
        const response = await fetch(`/api/youtube/uploads/${encodeURIComponent(current.id)}`, {
          method: 'PUT',
          headers: { 'content-type': mime, 'content-range': `bytes ${from}-${to - 1}/${current.bytesTotal}` },
          body: chunk,
        });
        const parsed = await readApi(response);
        if (!parsed.ok || !parsed.data?.upload) throw new Error(parsed.message || 'Upload interrupted. Click Resume to continue.');
        current = parsed.data.upload as UploadView;
        setUpload(current);
        setMessage(parsed.data.complete ? 'Upload accepted by YouTube. Checking its real processing status…' : `Uploading… ${current.progress}%`);
      }
      const check = await fetch(`/api/youtube/uploads/${encodeURIComponent(current.id)}`);
      const checked = await readApi(check);
      if (checked.ok && checked.data?.upload) current = checked.data.upload as UploadView;
      setUpload(current);
      setMessage(current.status === 'SCHEDULED' ? 'Video uploaded and scheduled by YouTube.' : current.status === 'PUBLISHED' ? 'Video is public on YouTube.' : 'Video uploaded. YouTube is processing it.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelUpload() {
    if (!upload?.id || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/youtube/uploads/${encodeURIComponent(upload.id)}`, { method: 'DELETE' });
      const parsed = await readApi(response);
      if (!parsed.ok) throw new Error(parsed.message || 'Could not cancel the upload.');
      setUpload((parsed.data?.upload as UploadView | undefined) || upload);
      setMessage('Upload cancelled. An uploaded video was kept private.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not cancel.'); }
    finally { setBusy(false); }
  }

  return (
    <section style={{ border: '1px solid #FECACA', borderRadius: 16, overflow: 'hidden', background: '#fff' }} aria-labelledby="youtube-publisher-title">
      <div style={{ padding: '15px 18px', display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(135deg,#FFF7F7,#FFF)', borderBottom: '1px solid #FEE2E2' }}>
        <span style={{ width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center', background: '#FF0000', color: '#fff', fontSize: 20 }}>▶</span>
        <div style={{ flex: 1 }}><h3 id="youtube-publisher-title" style={{ margin: 0, fontSize: 15, color: '#0F172A' }}>YouTube Video</h3><div style={{ fontSize: 11.5, color: '#64748B', marginTop: 2 }}>{p.connected ? `Connected to ${p.channelName || 'your channel'}` : 'Connect an approved test channel to upload'}</div></div>
        {p.channelThumbnail && <img src={p.channelThumbnail} alt="Connected YouTube channel" width={36} height={36} style={{ width: 36, height: 36, borderRadius: '50%' }} />}
      </div>
      <div style={{ padding: 18, display: 'grid', gap: 14 }}>
        {!p.available ? <div style={{ padding: 12, borderRadius: 10, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', fontSize: 12.5 }}>YouTube is currently restricted to configured test users. Set the server-side feature flag and allowlist before testing.</div>
          : !p.connected ? <button type="button" onClick={p.onConnect} style={{ border: 0, borderRadius: 10, padding: '11px 16px', background: '#FF0000', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>Connect YouTube</button>
            : <>
              <div><label style={label}>VIDEO SOURCE</label><select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={field}><option value="device">Upload from this device</option>{galleryVideos.map((video) => <option key={video.id} value={`asset:${video.id}`}>Asset Gallery — {video.filename}</option>)}{videos.map((video) => <option key={video.id} value={video.id}>Current Studio — {video.name || 'video'}</option>)}</select></div>
              {selectedId === 'device' && <div><input ref={fileRef} type="file" accept="video/*,.mp4,.mov,.webm" onChange={async (e) => { const next = e.target.files?.[0] || null; setFile(next); setFacts(next ? await videoFacts(next) : null); }} style={field} /></div>}
              <div style={{ fontSize: 11.5, color: sourceFacts && sourceFacts.duration <= 180 && sourceFacts.height >= sourceFacts.width ? '#047857' : '#64748B' }}>{shortsLabel}. Square or vertical videos up to three minutes may be categorized as Shorts by YouTube; SocialPulse uses the standard video upload API.</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}><label style={{ ...label, margin: 0 }}>METADATA</label><button type="button" onClick={applyAi} disabled={!p.generated} style={{ border: '1px solid #DDD6FE', borderRadius: 9, padding: '7px 10px', background: '#F5F3FF', color: '#6D28D9', fontWeight: 800, fontSize: 11, cursor: p.generated ? 'pointer' : 'not-allowed' }}>✨ Use AI metadata</button></div>
              <div><label style={label}>TITLE ({title.length}/100)</label><input value={title} maxLength={100} onChange={(e) => { setTitle(e.target.value); setEdited((x) => ({ ...x, title: true })); }} style={field} /></div>
              <div><label style={label}>DESCRIPTION</label><textarea value={description} maxLength={5000} rows={5} onChange={(e) => { setDescription(e.target.value); setEdited((x) => ({ ...x, description: true })); }} style={{ ...field, resize: 'vertical' }} /></div>
              <div><label style={label}>TAGS (COMMA-SEPARATED)</label><input value={tags} onChange={(e) => { setTags(e.target.value); setEdited((x) => ({ ...x, tags: true })); }} style={field} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
                <div><label style={label}>PRIVACY</label><select value={privacyStatus} onChange={(e) => setPrivacyStatus(e.target.value as typeof privacyStatus)} style={field}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select>{schedule && <div style={{ fontSize: 10.5, color: '#92400E', marginTop: 4, lineHeight: 1.5 }}>Scheduling overrides this: YouTube holds the video private until the publish time, then makes it public.</div>}</div>
                <div><label style={label}>{scheduleRequired ? 'SCHEDULE (REQUIRED)' : 'SCHEDULE (OPTIONAL)'}</label><input type="datetime-local" value={schedule} min={minSchedule} onChange={(e) => setSchedule(e.target.value)} style={field} /></div>
              </div>
              <div><label style={label}>AUDIENCE (REQUIRED)</label><select value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)} style={field}><option value="">Select an audience…</option><option value="general">Not made for kids</option><option value="kids">Made for kids</option></select></div>
              {upload && <div aria-live="polite"><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#475569' }}><span>{upload.status}</span><strong>{upload.progress}%</strong></div><div style={{ height: 8, background: '#F1F5F9', borderRadius: 99, overflow: 'hidden', marginTop: 5 }}><div style={{ width: `${upload.progress}%`, height: '100%', background: '#FF0000', transition: 'width .2s' }} /></div>{upload.videoUrl && <a href={upload.videoUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8, color: '#DC2626', fontSize: 12, fontWeight: 800 }}>Open video on YouTube ↗</a>}</div>}
              {message && <div role="status" style={{ fontSize: 12.5, padding: '9px 11px', borderRadius: 9, background: '#F8FAFC', color: '#334155' }}>{message}</div>}
              <p style={{ margin: 0, fontSize: 11, lineHeight: 1.55, color: '#64748B' }}>By clicking upload, you certify that your content complies with the <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer" style={{ color: '#DC2626', fontWeight: 800 }}>YouTube Terms of Service and Community Guidelines</a>. Do not violate anyone else&apos;s copyright or privacy rights.</p>
              <div style={{ border: `1px solid ${ready ? '#A7F3D0' : '#FDE68A'}`, background: ready ? '#ECFDF5' : '#FFFBEB', borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: ready ? '#047857' : '#92400E', marginBottom: requirements.every((r) => r.ok) ? 0 : 6 }}>{ready ? '✓ Ready to publish' : 'Not ready to publish'}</div>
                {requirements.filter((item) => !item.ok).map((item) => (
                  <div key={item.label} style={{ fontSize: 11.5, color: '#92400E', lineHeight: 1.6 }}>• {item.label}</div>
                ))}
                {ready && schedule && (
                  <div style={{ fontSize: 11.5, color: '#047857', lineHeight: 1.6 }}>YouTube keeps this video private until {new Date(schedule).toLocaleString()}, then publishes it <strong>publicly</strong> — scheduling cannot end in unlisted or private.</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button type="button" onClick={() => void runUpload()} disabled={busy || !ready} style={{ flex: 1, border: 0, borderRadius: 10, padding: '12px 16px', background: busy ? '#FCA5A5' : '#FF0000', color: '#fff', fontWeight: 800, cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'Working…' : upload && upload.progress < 100 ? 'Resume Upload' : schedule ? 'Upload & Schedule' : 'Upload to YouTube'}</button>{upload && !['PUBLISHED', 'CANCELLED'].includes(upload.status) && <button type="button" onClick={() => void cancelUpload()} disabled={busy} style={{ border: '1px solid #FECACA', borderRadius: 10, padding: '12px 16px', background: '#fff', color: '#DC2626', fontWeight: 800, cursor: 'pointer' }}>Cancel</button>}</div>
            </>}
      </div>
    </section>
  );
}
