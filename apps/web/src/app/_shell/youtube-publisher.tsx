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

export default function YouTubePublisher(p: Props) {
  const videos = p.mediaItems.filter((item) => item.type === 'video');
  const [selectedId, setSelectedId] = useState(videos[0]?.id || 'device');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(p.generated?.title || '');
  const [description, setDescription] = useState(p.generated?.caption || '');
  const [tags, setTags] = useState((p.generated?.hashtags || []).join(', '));
  const [privacyStatus, setPrivacyStatus] = useState<'private' | 'unlisted' | 'public'>('private');
  const [madeForKids, setMadeForKids] = useState(false);
  const [schedule, setSchedule] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [upload, setUpload] = useState<UploadView | null>(null);
  const [facts, setFacts] = useState<{ width: number; height: number; duration: number } | null>(null);
  const [galleryVideos, setGalleryVideos] = useState<GalleryVideo[]>([]);
  const [minSchedule] = useState(() => new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 16));
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
        const data = await response.json();
        if (active && response.ok && data.upload) setUpload(data.upload);
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
    setTitle(p.generated?.title || '');
    setDescription(p.generated?.caption || '');
    setTags((p.generated?.hashtags || []).join(', '));
  };

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
    const chosenSize = selectedId === 'device' ? file?.size || 0 : selectedGallery?.size || (selectedAsset ? mediaSize(selectedAsset) : 0);
    const filename = selectedId === 'device' ? file?.name || '' : selectedGallery?.filename || selectedAsset?.name || 'gallery-video.mp4';
    const mime = selectedId === 'device' ? file?.type || 'video/mp4' : selectedGallery?.mime || selectedAsset?.mime || 'video/mp4';
    if (!chosenSize) { setMessage('Choose an original device file or a saved gallery video with a known size.'); return; }
    if (!title.trim()) { setMessage('Add a YouTube title.'); return; }
    const publishAt = schedule ? new Date(schedule).toISOString() : undefined;
    setBusy(true);
    setMessage('Starting a secure resumable upload…');
    try {
      const fingerprint = `${filename}:${chosenSize}:${title.trim()}:${publishAt || 'now'}`;
      const attemptId = `yt_${Array.from(new TextEncoder().encode(fingerprint)).reduce((h, b) => Math.imul(h ^ b, 16777619), 2166136261).toString(36)}`;
      const start = await fetch('/api/youtube/uploads', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attemptId, filename, mime, size: chosenSize, title, description, tags, privacyStatus, madeForKids, publishAt }),
      });
      const started = await start.json();
      if (!start.ok || !started.upload) throw new Error(started.message || 'Could not start the upload.');
      let current = started.upload as UploadView;
      const chunkSize = Number(started.chunkSize) || CHUNK_FALLBACK;
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
        const data = await response.json();
        if (!response.ok || !data.upload) throw new Error(data.message || 'Upload interrupted. Click Resume to continue.');
        current = data.upload;
        setUpload(current);
        setMessage(data.complete ? 'Upload accepted by YouTube. Checking its real processing status…' : `Uploading… ${current.progress}%`);
      }
      const check = await fetch(`/api/youtube/uploads/${encodeURIComponent(current.id)}`);
      const checked = await check.json();
      if (check.ok && checked.upload) current = checked.upload;
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
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not cancel the upload.');
      setUpload(data.upload || upload);
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
              <div><label style={label}>TITLE ({title.length}/100)</label><input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} style={field} /></div>
              <div><label style={label}>DESCRIPTION</label><textarea value={description} maxLength={5000} rows={5} onChange={(e) => setDescription(e.target.value)} style={{ ...field, resize: 'vertical' }} /></div>
              <div><label style={label}>TAGS (COMMA-SEPARATED)</label><input value={tags} onChange={(e) => setTags(e.target.value)} style={field} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
                <div><label style={label}>PRIVACY</label><select value={privacyStatus} onChange={(e) => setPrivacyStatus(e.target.value as typeof privacyStatus)} style={field}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></div>
                <div><label style={label}>SCHEDULE (OPTIONAL)</label><input type="datetime-local" value={schedule} min={minSchedule} onChange={(e) => setSchedule(e.target.value)} style={field} /></div>
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: '#334155' }}><input type="checkbox" checked={madeForKids} onChange={(e) => setMadeForKids(e.target.checked)} /> This video is made for kids</label>
              {upload && <div aria-live="polite"><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#475569' }}><span>{upload.status}</span><strong>{upload.progress}%</strong></div><div style={{ height: 8, background: '#F1F5F9', borderRadius: 99, overflow: 'hidden', marginTop: 5 }}><div style={{ width: `${upload.progress}%`, height: '100%', background: '#FF0000', transition: 'width .2s' }} /></div>{upload.videoUrl && <a href={upload.videoUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8, color: '#DC2626', fontSize: 12, fontWeight: 800 }}>Open video on YouTube ↗</a>}</div>}
              {message && <div role="status" style={{ fontSize: 12.5, padding: '9px 11px', borderRadius: 9, background: '#F8FAFC', color: '#334155' }}>{message}</div>}
              <p style={{ margin: 0, fontSize: 11, lineHeight: 1.55, color: '#64748B' }}>By clicking upload, you certify that your content complies with the <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer" style={{ color: '#DC2626', fontWeight: 800 }}>YouTube Terms of Service and Community Guidelines</a>. Do not violate anyone else&apos;s copyright or privacy rights.</p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button type="button" onClick={() => void runUpload()} disabled={busy} style={{ flex: 1, border: 0, borderRadius: 10, padding: '12px 16px', background: busy ? '#FCA5A5' : '#FF0000', color: '#fff', fontWeight: 800, cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'Working…' : upload && upload.progress < 100 ? 'Resume Upload' : schedule ? 'Upload & Schedule' : 'Upload to YouTube'}</button>{upload && !['PUBLISHED', 'CANCELLED'].includes(upload.status) && <button type="button" onClick={() => void cancelUpload()} disabled={busy} style={{ border: '1px solid #FECACA', borderRadius: 10, padding: '12px 16px', background: '#fff', color: '#DC2626', fontWeight: 800, cursor: 'pointer' }}>Cancel</button>}</div>
            </>}
      </div>
    </section>
  );
}
