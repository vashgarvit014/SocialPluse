'use client';

import { useState, useEffect, useRef } from 'react';
import type { StudioWorkspaceProps } from './studio-workspace';

// ---------------------------------------------------------------------------
// Tokens (same SaaS system as studio-workspace)
// ---------------------------------------------------------------------------
const C = {
  card: '#ffffff',
  border: '#E8EAF1',
  borderSoft: '#F1F3F9',
  ink: '#0F172A',
  muted: '#64748B',
  faint: '#94A3B8',
  primary: '#7C3AED',
  primaryDark: '#6D28D9',
  primarySoft: '#F1EBFF',
  primaryBorder: '#C4B5FD',
};

const card: React.CSSProperties = {
  backgroundColor: C.card,
  borderRadius: 16,
  border: `1px solid ${C.border}`,
  boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 8px 28px rgba(15,23,42,0.06)',
  overflow: 'hidden',
};

const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  minHeight: 42, padding: '10px 20px', borderRadius: 10,
  fontSize: 13, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
  fontFamily: 'inherit', transition: 'all 0.18s',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  border: 'none',
  background: disabled ? '#DDD6FE' : 'linear-gradient(135deg, #7C3AED, #8B5CF6)',
  color: '#fff',
  boxShadow: disabled ? 'none' : '0 3px 12px rgba(124,58,237,0.28)',
});

const ghostBtn: React.CSSProperties = {
  minHeight: 42, padding: '10px 18px', borderRadius: 10,
  fontSize: 13, fontWeight: 700, cursor: 'pointer',
  fontFamily: 'inherit', transition: 'all 0.18s',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  border: `1.5px solid ${C.border}`, backgroundColor: '#fff', color: '#334155',
};

const selectCard = (active: boolean): React.CSSProperties => ({
  padding: 14, borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
  border: active ? `1.5px solid ${C.primary}` : `1px solid ${C.border}`,
  background: active ? C.primarySoft : '#fff',
  boxShadow: active ? '0 3px 12px rgba(124,58,237,0.14)' : 'none',
  display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%',
  transition: 'all 0.18s',
});

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{children}</div>
      {hint && <div style={{ fontSize: 11, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}

function WizardNav({ onBack, backLabel = '← Back', next }: { onBack?: () => void; backLabel?: string; next: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 24, paddingTop: 18, borderTop: `1px solid ${C.borderSoft}` }}>
      <div style={{ flex: 1 }}>
        {onBack && <button onClick={onBack} style={ghostBtn}>{backLabel}</button>}
      </div>
      {next}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------
const STEPS = [
  { n: 1, t: 'Idea' },
  { n: 2, t: 'Settings' },
  { n: 3, t: 'Content' },
  { n: 4, t: 'Media' },
  { n: 5, t: 'Preview' },
  { n: 6, t: 'Publish' },
];

function WizardStepper({ step, go }: { step: number; go: (n: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 2, overflowX: 'auto', padding: '4px 2px' }}>
      {STEPS.map((s, i) => {
        const done = s.n < step;
        const active = s.n === step;
        return (
          <div key={s.n} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 96 }}>
            <button
              onClick={() => { if (s.n < step) go(s.n); }}
              disabled={s.n > step}
              style={{ background: 'none', border: 'none', cursor: s.n < step ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 8, padding: 0, fontFamily: 'inherit' }}
              title={s.n < step ? `Go back to ${s.t}` : s.t}
            >
              <span style={{
                width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800,
                background: done ? C.primary : active ? 'linear-gradient(135deg,#7C3AED,#8B5CF6)' : '#EEF0F6',
                color: done || active ? '#fff' : '#9AA1B5',
                boxShadow: active ? '0 3px 10px rgba(124,58,237,0.35)' : 'none',
              }}>{done ? '✓' : s.n}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: active ? C.primaryDark : done ? C.ink : '#9AA1B5' }}>{s.t}</span>
            </button>
            {i < STEPS.length - 1 && <span style={{ flex: 1, height: 2, borderRadius: 2, margin: '0 10px', background: s.n < step ? C.primary : '#E9ECF3', minWidth: 12 }} />}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wizard — presentation only, all logic via props (existing handlers)
// ---------------------------------------------------------------------------
export default function StudioWizard(p: StudioWorkspaceProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [publishMode, setPublishMode] = useState<'now' | 'later'>('now');
  const [studioTab, setStudioTab] = useState<'caption' | 'hashtags' | 'prompt'>('caption');
  const [previewPlatform, setPreviewPlatform] = useState('linkedin');
  const [copiedText, setCopiedText] = useState(false);

  // Reference (topic) images ride along into the Step 5 preview and the
  // publish payload (deduped by URL) - skipped when the post carries video.
  const postExtraImages = p.topicMediaItems.filter(t => t.type === 'image' && !p.mediaItems.some(m => m.url === t.url));
  const postHasVideoItem = p.mediaItems.some(m => m.type === 'video') || !!p.generatedVideo;
  const postPublishMedia = (postHasVideoItem ? p.mediaItems : [...p.mediaItems, ...postExtraImages]).slice(0, 9);
  const previewItems = postPublishMedia.length
    ? postPublishMedia.slice(0, 4)
    : p.generatedVideo
      ? [{ id: 'v', url: p.generatedVideo, type: 'video' as const }]
      : [{ id: 'i', url: p.generatedImage, type: 'image' as const }];
  const previewMediaCount = postPublishMedia.length || ((p.generatedImage || p.generatedVideo) ? 1 : 0);

  // Auto-advance: when AI content finishes generating, move to Step 3 (review)
  const wasGeneratingContent = useRef(false);
  useEffect(() => {
    if (wasGeneratingContent.current && !p.isGeneratingContent && p.content.trim() && currentStep === 2) {
      setCurrentStep(3);
    }
    wasGeneratingContent.current = p.isGeneratingContent;
  }, [p.isGeneratingContent, p.content, currentStep]);

  const hasTopic = !!p.prompt.trim() || p.topicMediaItems.length > 0;
  const hasSettings = !!p.aspectRatio;
  const hasContent = !!p.content.trim();
  const hasMedia = p.mediaItems.length > 0 || !!p.generatedImage || !!p.generatedVideo;
  // Publishing needs a CONNECTED platform (the OAuth token actually posts).
  // Unlike generation, selection alone is not enough here.
  const connectedSelected = p.selectedPlatforms.filter(pl =>
    p.accounts.some(a => a.platform === pl && a.connected));
  const canPublish = hasContent && connectedSelected.length > 0;
  const publishBlocker = !hasContent
    ? 'Generate content first'
    : p.selectedPlatforms.length === 0
      ? 'Select a platform above first'
      : 'Connect the selected platform first';
  // Content generation needs only a SELECTED platform - no connection
  // required (connection is only needed later, to publish). Any selected
  // platform unlocks it, so the button state stays honest.
  const genPlatformSelected = p.selectedPlatforms.length > 0;
  const canGenContent = !p.isGeneratingContent && hasTopic && genPlatformSelected;
  const genContentBlocker = !hasTopic
    ? 'Enter a topic first (Step 1)'
    : !genPlatformSelected
      ? 'Select a platform above first — then Generate Content unlocks'
      : '';
  const canGenImage = !p.isGeneratingImage && !!p.aspectRatio && !!p.content.trim();

  const activeTags = p.platformContent[p.activePreviewPlatform]?.hashtags || [];
  const sentences = p.content ? p.content.split(/[.!?]+/).filter(s => s.trim()).length : 0;

  const saveDraft = () => {
    try {
      const drafts = JSON.parse(localStorage.getItem('socialDrafts') || '[]');
      drafts.push({ content: p.content, prompt: p.prompt, tone: p.tone, imageStyle: p.imageStyle, aspectRatio: p.aspectRatio, savedAt: new Date().toISOString() });
      localStorage.setItem('socialDrafts', JSON.stringify(drafts));
      p.setPublishResult(`Draft saved locally (${drafts.length} total)`);
      p.setPublishResultType('success'); p.setShowToast(true);
      setTimeout(() => p.setShowToast(false), 3000);
    } catch { /* ignore */ }
  };

  const goNext = () => setCurrentStep(s => Math.min(6, s + 1));
  const goBack = () => setCurrentStep(s => Math.max(1, s - 1));

  const header = (title: string, sub: string, badge?: string) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em' }}>{title}</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{sub}</div>
      </div>
      {badge && <span style={{ fontSize: 11, color: C.primaryDark, backgroundColor: C.primarySoft, border: `1px solid ${C.primaryBorder}`, padding: '7px 11px', borderRadius: 9, maxWidth: 230, lineHeight: 1.5 }}>{badge}</span>}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 20, flex: 1, alignItems: 'stretch', minHeight: 'calc(100vh - 64px)', maxWidth: 1120, width: '100%', margin: '0 auto' }}>
      <style>{`
        .sp-wiz-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .sp-wiz-prev { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 14px; align-items: start; }
        @media (max-width: 900px) { .sp-wiz-grid2, .sp-wiz-prev { grid-template-columns: 1fr; } }
      `}</style>

      <div style={{ ...card, padding: '14px 20px' }}>
        <WizardStepper step={currentStep} go={setCurrentStep} />
      </div>

      <div style={{ ...card, padding: '28px 32px' }}>
        {/* ================= STEP 1 — IDEA ================= */}
        {currentStep === 1 && (
          <div>
            {header('Create Your Post', 'Step 1 of 6: Tell us what you want to create', 'A great idea leads to great content! Be specific for better results.')}
            <SectionTitle>Topic & Idea</SectionTitle>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>Describe your post idea, topic, or key message. The more details you provide, the better the results.</div>
            <textarea
              value={p.prompt}
              onChange={e => p.setPrompt(e.target.value.slice(0, 2000))}
              placeholder="Describe the social media post you want to create..."
              style={{ width: '100%', minHeight: 130, padding: '13px 14px', border: `1.5px solid ${C.border}`, borderRadius: 12, fontSize: 13, lineHeight: 1.65, color: C.ink, backgroundColor: '#FCFCFE', fontFamily: 'inherit', resize: 'vertical', outline: 'none' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <span style={{ fontSize: 11, color: C.faint, fontStyle: 'italic' }}>Example: “5 tips for staying productive while working from home, target audience is remote professionals, friendly tone”</span>
              <span style={{ fontSize: 11, color: C.faint, flexShrink: 0, marginLeft: 12 }}>{p.prompt.length}/500</span>
            </div>

            <div style={{ marginTop: 20 }}>
              <SectionTitle>Reference Images (Optional)</SectionTitle>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>Upload up to 4 images to guide AI and match your vision.</div>
              <div
                onDragOver={p.handleDragOver}
                onDragEnter={e => { e.preventDefault(); p.setDragOverTopic(true); p.setTopicDragOver(true); }}
                onDragLeave={e => { e.preventDefault(); p.setDragOverTopic(false); p.setTopicDragOver(false); }}
                onDrop={p.handleTopicDrop}
                style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}
              >
                {p.topicMediaItems.filter(i => i.type === 'image').map(item => (
                  <div key={item.id} style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.border}`, aspectRatio: '1', backgroundColor: '#000' }}>
                    <img src={item.url} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    <button onClick={() => p.removeTopicMedia(item.id)} style={{ position: 'absolute', top: 5, right: 5, width: 20, height: 20, borderRadius: '50%', backgroundColor: 'rgba(15,23,42,0.78)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                    <button onClick={() => p.openInCanva(item.url)} disabled={p.isSendingToCanva} title="Edit this image in Canva" style={{ position: 'absolute', bottom: 5, right: 5, height: 20, padding: '0 7px', borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.92)', color: '#0F172A', border: '1px solid #E2E8F0', cursor: p.isSendingToCanva ? 'wait' : 'pointer', fontSize: 10, fontWeight: 800 }}>🎨 Edit</button>
                  </div>
                ))}
                {p.topicMediaItems.length < 4 && (
                  <button onClick={() => p.topicFileInputRef.current?.click()} style={{ borderRadius: 10, border: '1.5px dashed #C4B5FD', backgroundColor: C.primarySoft, cursor: 'pointer', aspectRatio: '1', color: C.primary, fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                )}
              </div>
              <input ref={p.topicFileInputRef} type="file" accept="image/*" multiple onChange={p.handleTopicUpload} style={{ display: 'none' }} />
            </div>

            <WizardNav next={<button onClick={goNext} disabled={!hasTopic} style={primaryBtn(!hasTopic)} title={!hasTopic ? 'Enter a topic or add a reference image first' : 'Continue'}>Next →</button>} />
            {!hasTopic && <div style={{ fontSize: 11, color: '#92400E', marginTop: 8 }}>Topic required — describe your post or add a reference image to continue.</div>}
          </div>
        )}

        {/* ================= STEP 2 — SETTINGS ================= */}
        {currentStep === 2 && (
          <div>
            {header('Creative Settings', 'Step 2 of 6: Customize your content style', 'Choose settings that match your audience and platform.')}
            <SectionTitle>Tone</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
              {[['Professional', '💼'], ['Casual', '😊'], ['Inspirational', '✨'], ['Educational', '📚']].map(([k, i]) => {
                const active = p.tone === k;
                return (
                  <button key={k} onClick={() => p.setTone(k)} style={selectCard(active)}>
                    <span style={{ fontSize: 18 }}>{i}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: active ? C.primaryDark : C.ink }}>{k}</span>
                    <span style={{ marginLeft: 'auto', width: 18, height: 18, borderRadius: '50%', border: active ? `2px solid ${C.primary}` : `1.5px solid ${C.border}`, backgroundColor: active ? C.primary : '#fff', color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{active ? '✓' : ''}</span>
                  </button>
                );
              })}
            </div>
            <SectionTitle>Image Style</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
              {[['Photographic', '📷'], ['Digital Art', '🎨'], ['Cinematic', '🎬'], ['Anime', '🌸']].map(([k, i]) => {
                const active = p.imageStyle === k;
                return (
                  <button key={k} onClick={() => p.setImageStyle(k)} style={selectCard(active)}>
                    <span style={{ fontSize: 18 }}>{i}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: active ? C.primaryDark : C.ink }}>{k}</span>
                    <span style={{ marginLeft: 'auto', width: 18, height: 18, borderRadius: '50%', border: active ? `2px solid ${C.primary}` : `1.5px solid ${C.border}`, backgroundColor: active ? C.primary : '#fff', color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{active ? '✓' : ''}</span>
                  </button>
                );
              })}
            </div>
            <SectionTitle>Aspect Ratio</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {Object.entries(p.aspectRatioMap).map(([key, val]) => {
                const active = p.aspectRatio === key;
                return (
                  <button key={key} onClick={() => p.setAspectRatio(key)} style={selectCard(active)}>
                    <span style={{
                      width: key === '1:1' ? 26 : key === '16:9' ? 34 : key === '9:16' ? 18 : 28,
                      height: key === '1:1' ? 26 : key === '16:9' ? 19 : key === '9:16' ? 30 : 21,
                      borderRadius: 5, border: `2px solid ${active ? C.primary : '#CBD5E1'}`,
                      backgroundColor: active ? '#fff' : '#F8FAFC', flexShrink: 0, display: 'block',
                    }} />
                    <span>
                      <span style={{ display: 'block', fontSize: 9, fontWeight: 800, color: active ? C.primaryDark : C.muted }}>{key}</span>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: active ? C.primaryDark : C.ink }}>{val.label}</span>
                    </span>
                    <span style={{ marginLeft: 'auto', width: 18, height: 18, borderRadius: '50%', border: active ? `2px solid ${C.primary}` : `1.5px solid ${C.border}`, backgroundColor: active ? C.primary : '#fff', color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{active ? '✓' : ''}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.ink, marginBottom: 6 }}>PLATFORM {p.accounts.some(a => a.connected) ? (
                <span style={{ fontWeight: 600, color: '#059669', backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0', padding: '1px 7px', borderRadius: 999 }}>Active</span>
              ) : (
                <span style={{ fontWeight: 600, color: '#92400E', backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', padding: '1px 7px', borderRadius: 999 }}>Connect to continue</span>
              )}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {([
                  { id: 'linkedin', label: 'LinkedIn' },
                  { id: 'facebook', label: 'Facebook' },
                ] as const).map(cfg => {
                  const connected = p.accounts.some(a => a.platform === cfg.id && a.connected);
                  const selected = p.selectedPlatforms.includes(cfg.id);
                  const brand = p.platformColors[cfg.id] || C.primary;
                  return (
                    <div key={cfg.id} style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                      <button onClick={() => p.togglePlatform(cfg.id)} style={{
                        flex: 1, padding: 10, borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                        border: selected ? `1.5px solid ${brand}` : `1px solid ${C.border}`,
                        backgroundColor: selected ? '#EFF6FF' : '#fff',
                      }}>
                        <span style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: brand, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <p.PlatformIcon platform={cfg.id} size={13} />
                        </span>
                        <span>
                          <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.ink }}>{cfg.label} {selected ? '✓' : ''}</span>
                          <span style={{ display: 'block', fontSize: 10, fontWeight: 600, color: connected ? '#059669' : C.faint }}>{connected ? '● Connected' : '○ Not connected'}</span>
                        </span>
                      </button>
                      {!connected && (
                        <button onClick={() => p.connectPlatform(cfg.id)} style={{ padding: '10px 14px', borderRadius: 10, fontSize: 11, fontWeight: 700, border: 'none', background: 'linear-gradient(135deg,#7C3AED,#8B5CF6)', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>Connect</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <WizardNav
              onBack={goBack}
              next={<span style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { p.generateContent(); }} disabled={!canGenContent} title={!canGenContent ? genContentBlocker : 'Generate content'} style={primaryBtn(!canGenContent)}>✨ Generate Content →</button>
                <button onClick={goNext} disabled={!hasSettings} title={!hasSettings ? 'Choose an aspect ratio to continue' : 'Continue'} style={{ ...primaryBtn(!hasSettings), background: hasSettings ? '#0F172A' : '#DDD6FE', boxShadow: 'none' }}>Next →</button>
              </span>}
            />
            {!hasSettings && <div style={{ fontSize: 11, color: '#92400E', marginTop: 8 }}>Aspect ratio required before the image flow — pick one above.</div>}
            {!canGenContent && !p.isGeneratingContent && (
              <div style={{ fontSize: 11, color: '#92400E', marginTop: 8 }}>
                To enable Generate Content: {[!hasTopic ? 'add a topic (Step 1)' : null, !genPlatformSelected ? 'select a platform above' : null].filter(Boolean).join(' and ')}.
              </div>
            )}
          </div>
        )}

        {/* ================= STEP 3 — CONTENT ================= */}
        {currentStep === 3 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 19, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em' }}>AI Content Editor</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>Step 3 of 6: Review and refine your generated content</div>
              </div>
              <button onClick={p.generateContent} disabled={!canGenContent} style={{ padding: '8px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, border: `1px solid ${C.primaryBorder}`, backgroundColor: '#fff', color: C.primaryDark, cursor: canGenContent ? 'pointer' : 'not-allowed', opacity: canGenContent ? 1 : 0.5 }}>↻ Regenerate</button>
            </div>
            {!p.content.trim() ? (
              <div style={{ border: '1.5px dashed #C4B5FD', borderRadius: 12, backgroundColor: '#FCFCFE', padding: 36, textAlign: 'center' }}>
                <div style={{ fontSize: 30 }}>📝</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginTop: 8 }}>No content yet</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Go back to Settings and click Generate Content.</div>
                <button onClick={() => setCurrentStep(2)} style={{ ...primaryBtn(false), width: 'auto', marginTop: 14, padding: '10px 20px' }}>← Back to Settings</button>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.borderSoft}`, marginBottom: 12 }}>
                  {([['caption', 'Caption'], ['hashtags', 'Hashtags'], ['prompt', 'Image Prompt']] as const).map(([k, label]) => (
                    <button key={k} onClick={() => setStudioTab(k)} style={{ padding: '9px 15px', fontSize: 12, fontWeight: 700, border: 'none', borderBottom: studioTab === k ? `2px solid ${C.primary}` : '2px solid transparent', background: 'none', color: studioTab === k ? C.primaryDark : C.faint, cursor: 'pointer' }}>{label}</button>
                  ))}
                </div>
                {studioTab === 'caption' && (
                  <div>
                    <div style={{ fontSize: 11, color: C.primaryDark, backgroundColor: C.primarySoft, border: `1px solid ${C.primaryBorder}`, padding: '7px 11px', borderRadius: 8, marginBottom: 10 }}>✨ AI-generated suggestion — review and edit before publishing.</div>
                    <textarea value={p.content} onChange={e => {
                      const v = e.target.value;
                      p.setContent(v);
                      // Write edits back so Publish sends the current edited caption, never a stale value.
                      if (p.activePreviewPlatform && p.platformContent[p.activePreviewPlatform]) {
                        p.setPlatformContent({
                          ...p.platformContent,
                          [p.activePreviewPlatform]: {
                            ...p.platformContent[p.activePreviewPlatform],
                            caption: v.replace(/\n\n(#[A-Za-z0-9_]+\s*)+$/, '').trim(),
                          },
                        });
                      }
                    }} style={{ width: '100%', minHeight: 210, padding: 14, border: `1.5px solid ${C.border}`, borderRadius: 12, fontSize: 13.5, lineHeight: 1.75, color: C.ink, backgroundColor: '#fff', fontFamily: 'inherit', resize: 'vertical', outline: 'none' }} />
                    <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 11, color: C.muted }}>
                      <span><b style={{ color: C.primaryDark }}>{p.charCount}</b> characters</span>
                      <span><b style={{ color: C.primaryDark }}>{p.wordCount}</b> words • ~{Math.max(1, Math.ceil(p.wordCount / 200))} min read</span>
                      <span style={{ marginLeft: 'auto' }}>{sentences} sentences • LinkedIn-ready</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <button onClick={() => { try { navigator.clipboard.writeText(p.content); setCopiedText(true); setTimeout(() => setCopiedText(false), 2000); } catch {} }} style={{ padding: '8px 16px', borderRadius: 9, fontSize: 12, fontWeight: 700, border: `1.5px solid ${C.border}`, backgroundColor: copiedText ? '#ECFDF5' : '#fff', color: copiedText ? '#059669' : C.ink, cursor: 'pointer' }}>📋 {copiedText ? 'Copied ✓' : 'Copy text'}</button>
                    </div>
                  </div>
                )}
                {studioTab === 'hashtags' && (
                  <div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {activeTags.length === 0 && <span style={{ fontSize: 12, color: C.faint }}>Hashtags appear here after generation.</span>}
                      {activeTags.map((t, i) => (
                        <button key={i} onClick={() => { try { navigator.clipboard.writeText('#' + String(t).replace(/^#+/, '')); } catch {} }} title="Click to copy" style={{ fontSize: 12, fontWeight: 600, backgroundColor: C.primarySoft, color: C.primaryDark, border: `1px solid ${C.primaryBorder}`, padding: '6px 12px', borderRadius: 999, cursor: 'pointer' }}>#{String(t).replace(/^#+/, '')}</button>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>From generate-content — click a chip to copy.</div>
                  </div>
                )}
                {studioTab === 'prompt' && (
                  <div>
                    <textarea value={p.imagePrompt} onChange={() => {}} placeholder="Image prompt appears here…" style={{ width: '100%', minHeight: 120, padding: 14, border: `1.5px solid ${C.border}`, borderRadius: 12, fontSize: 13, lineHeight: 1.7, color: C.ink, backgroundColor: '#FCFCFE', fontFamily: 'inherit', resize: 'vertical', outline: 'none' }} />
                    <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>Powers Generate AI Image with your Image Style + Aspect Ratio.</div>
                  </div>
                )}
                <div className="sp-wiz-grid2" style={{ marginTop: 16 }}>
                  <div style={{ backgroundColor: '#F8FAFC', border: `1px solid ${C.borderSoft}`, borderRadius: 12, padding: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 8 }}>Suggested Hashtags</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {activeTags.slice(0, 8).map((t, i) => (
                        <span key={i} style={{ fontSize: 11, fontWeight: 600, backgroundColor: '#fff', color: C.primaryDark, border: `1px solid ${C.primaryBorder}`, padding: '4px 9px', borderRadius: 999 }}>#{String(t).replace(/^#+/, '')}</span>
                      ))}
                      {activeTags.length === 0 && <span style={{ fontSize: 11, color: C.faint }}>#Productivity #RemoteWork #Growth</span>}
                    </div>
                  </div>
                  <div style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 12, padding: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#92400E', marginBottom: 8 }}>AI Suggestions</div>
                    <div style={{ fontSize: 11, color: '#92400E', lineHeight: 1.8 }}>
                      • Consider a stronger call-to-action<br />
                      • Try a shorter opening sentence<br />
                      • Add a personal example
                    </div>
                  </div>
                </div>
              </div>
            )}
            <WizardNav onBack={goBack} next={<button onClick={goNext} disabled={!hasContent} style={primaryBtn(!hasContent)} title={!hasContent ? 'Generate content first' : 'Continue'}>Next →</button>} />
          </div>
        )}

        {/* ================= STEP 4 — MEDIA ================= */}
        {currentStep === 4 && (
          <div>
            {header('Media & Branding', 'Step 4 of 6: Add visuals and your brand', 'Use branded visuals for a stronger identity.')}
            {p.generationError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: '#B91C1C', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', padding: '10px 12px', borderRadius: 10, marginBottom: 12 }}>
                <span style={{ flex: 1 }}>⚠️ {p.generationError}</span>
                <button onClick={() => p.setGenerationError('')} style={{ border: 'none', background: 'none', color: '#B91C1C', fontSize: 14, fontWeight: 700, cursor: 'pointer', padding: '0 2px' }}>×</button>
              </div>
            )}
            <SectionTitle>Media Files</SectionTitle>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>Add images or videos to bring your post to life. Upload your own files or generate AI images.</div>
            <div
              onClick={() => p.fileInputRef.current?.click()}
              onDragOver={p.handleDragOver}
              onDragEnter={e => { e.preventDefault(); p.setDragOverPreview(true); }}
              onDragLeave={e => { e.preventDefault(); p.setDragOverPreview(false); }}
              onDrop={p.handleDrop}
              style={{ borderRadius: 12, border: p.dragOverPreview ? `1.5px dashed ${C.primary}` : `1.5px dashed ${C.border}`, backgroundColor: p.dragOverPreview ? C.primarySoft : '#FCFCFE', padding: 22, textAlign: 'center', cursor: 'pointer' }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Drag & drop images or videos here</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Supports JPG, PNG, MP4, MOV • Max 10MB images / 50MB videos • Up to 9 files</div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={() => p.fileInputRef.current?.click()} style={{ flex: 1, minHeight: 42, borderRadius: 10, fontSize: 12, fontWeight: 700, border: `1.5px solid ${C.border}`, backgroundColor: '#fff', color: C.ink, cursor: 'pointer' }}>📤 Upload Media</button>
              <button onClick={p.generateImage} disabled={!canGenImage} title={!p.aspectRatio ? 'Choose aspect ratio in Settings first' : 'Generate AI image'} style={{ flex: 1.4, minHeight: 42, borderRadius: 10, fontSize: 12, fontWeight: 700, border: 'none', background: !canGenImage ? '#DDD6FE' : 'linear-gradient(135deg,#7C3AED,#8B5CF6)', color: '#fff', cursor: !canGenImage ? 'not-allowed' : 'pointer' }}>
                {p.isGeneratingImage ? 'Generating…' : '✨ Generate AI Image'}
              </button>
            </div>

            {/* Canva — optional editing source. Edit sends the current image
                out to Canva; Import brings the edited result back as a new
                media item (it never overwrites anything automatically). */}
            <div style={{ marginTop: 14, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, backgroundColor: '#F8FAFC' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>🎨 Canva</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
                  color: p.canvaConnected ? '#059669' : C.muted,
                  backgroundColor: p.canvaConnected ? '#ECFDF5' : '#F1F3F9',
                  border: `1px solid ${p.canvaConnected ? '#A7F3D0' : C.border}`,
                }}>
                  {p.canvaConnected ? `Connected${p.canvaName ? ` as ${p.canvaName}` : ''}` : 'Not Connected'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {!p.canvaConnected ? (
                  <button onClick={() => p.openInCanva()} style={{ ...ghostBtn, minHeight: 38, fontSize: 12, flex: 1 }}>Connect Canva</button>
                ) : (
                  <>
                    <button
                      onClick={() => p.openInCanva()}
                      disabled={p.isSendingToCanva || !p.canvaSourceImage}
                      title={!p.canvaSourceImage ? 'Generate or upload an image first' : 'Send the current image to Canva for editing'}
                      style={{ ...ghostBtn, minHeight: 38, fontSize: 12, flex: 1, opacity: p.isSendingToCanva || !p.canvaSourceImage ? 0.5 : 1, cursor: p.isSendingToCanva || !p.canvaSourceImage ? 'not-allowed' : 'pointer' }}
                    >
                      {p.isSendingToCanva ? 'Opening Canva…' : 'Edit in Canva'}
                    </button>
                    <button
                      onClick={p.importFromCanva}
                      disabled={!p.canvaReadyId || p.isImportingFromCanva}
                      title={p.canvaReadyId ? 'Bring your edited design back as a new media item' : 'Finish editing in Canva first'}
                      style={{ ...primaryBtn(!p.canvaReadyId || p.isImportingFromCanva), minHeight: 38, fontSize: 12, flex: 1 }}
                    >
                      {p.isImportingFromCanva ? 'Importing…' : p.canvaReadyId ? 'Import from Canva ●' : 'Import from Canva'}
                    </button>
                    <button onClick={p.disconnectCanva} style={{ ...ghostBtn, minHeight: 38, fontSize: 12, color: '#DC2626', borderColor: '#FECACA' }}>Disconnect</button>
                  </>
                )}
              </div>
              {p.canvaConnected && (
                <button
                  onClick={p.createInCanva}
                  disabled={p.isCreatingInCanva}
                  title="Start a blank design in Canva and build it with Canva's own tools"
                  style={{ ...ghostBtn, minHeight: 38, fontSize: 12, width: '100%', marginTop: 8 }}
                >
                  {p.isCreatingInCanva ? 'Creating…' : '＋ Create in Canva'}
                </button>
              )}
              {p.canvaReadyId && (
                <div style={{ marginTop: 8, fontSize: 11, color: C.primaryDark, backgroundColor: C.primarySoft, border: `1px solid ${C.primaryBorder}`, padding: '7px 10px', borderRadius: 8 }}>
                  ✓ Your Canva design is ready — click Import from Canva to bring it in.
                </div>
              )}
            </div>

            {p.mediaItems.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 12 }}>
                {p.mediaItems.map((m, i) => (
                  <div key={m.id} draggable
                    onDragStart={() => p.handleMediaDragStart(m.id)}
                    onDragOver={e => p.handleMediaDragOver(e, m.id)}
                    onDrop={e => p.handleMediaDrop(e, m.id)}
                    onDragEnd={p.handleMediaDragEnd}
                    title="Drag to reorder"
                    style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', border: p.dragOverMediaId === m.id ? `2px solid ${C.primary}` : `1px solid ${C.border}`, aspectRatio: '1', backgroundColor: '#000', cursor: 'grab', opacity: p.draggedMediaId === m.id ? 0.5 : 1 }}>
                    {m.type === 'video' ? <video src={m.url} style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} muted /> : <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />}
                    <span style={{ position: 'absolute', bottom: 5, left: 5, fontSize: 9, fontWeight: 700, backgroundColor: 'rgba(15,23,42,0.75)', color: '#fff', padding: '2px 6px', borderRadius: 999 }}>{i === 0 ? '★ Cover' : `#${i + 1}`} • {m.type === 'video' ? 'VIDEO' : 'IMAGE'}{p.burnedLogoIds[m.id] ? ' • 🏷️' : ''}</span>
                    <span style={{ display: 'flex', gap: 4, position: 'absolute', top: 5, right: 5 }}>
                      {m.type === 'image' && (
                        <button onClick={() => p.openInCanva(m.url)} disabled={p.isSendingToCanva} title="Edit this image in Canva" style={{ height: 20, padding: '0 6px', borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.92)', color: '#0F172A', border: '1px solid #E2E8F0', cursor: p.isSendingToCanva ? 'wait' : 'pointer', fontSize: 9, fontWeight: 800 }}>🎨</button>
                      )}
                      <button onClick={() => { p.setLogoTargetId(m.id); p.setLogoModalOpen(true); }} title={p.logoTargetId === m.id ? 'Logo target ✓ — open logo dialog' : 'Apply logo to this image only'} style={{ height: 20, padding: '0 6px', borderRadius: 6, backgroundColor: p.logoTargetId === m.id ? C.primary : 'rgba(255,255,255,0.92)', color: p.logoTargetId === m.id ? '#fff' : '#0F172A', border: p.logoTargetId === m.id ? 'none' : '1px solid #E2E8F0', cursor: 'pointer', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 3 }}>🏷️{p.logoTargetId === m.id ? ' ✓' : ''}</button>
                      <button onClick={() => p.moveMedia(m.id, -1)} disabled={i === 0} style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 10, opacity: i === 0 ? 0.4 : 1 }}>‹</button>
                      <button onClick={() => p.moveMedia(m.id, 1)} disabled={i === p.mediaItems.length - 1} style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 10, opacity: i === p.mediaItems.length - 1 ? 0.4 : 1 }}>›</button>
                      <button onClick={() => p.removeMediaItem(m.id)} style={{ width: 20, height: 20, borderRadius: '50%', backgroundColor: 'rgba(220,38,38,0.9)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 10 }}>×</button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <input ref={p.fileInputRef} type="file" accept="image/*,video/*" multiple onChange={p.handleUploadImage} style={{ display: 'none' }} />

            <div style={{ marginTop: 20 }}>
              <SectionTitle>Branding</SectionTitle>
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, backgroundColor: '#F8FAFC', display: 'flex', alignItems: 'center', gap: 10 }}>
                {p.logoImage
                  ? <><img src={p.logoImage} alt="logo" style={{ width: 34, height: 34, objectFit: 'contain', backgroundColor: '#fff', borderRadius: 8, border: `1px solid ${C.border}`, padding: 3 }} /><span style={{ fontSize: 12, fontWeight: 600, color: C.ink }}>Logo ready ✓ • {p.logoPosition} • {Math.round(p.logoScale * 100)}%</span></>
                  : <span style={{ fontSize: 12, color: C.muted }}>No logo yet — upload your brand logo (PNG recommended).</span>}
                <button onClick={() => p.setLogoModalOpen(true)} style={{ marginLeft: 'auto', padding: '8px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, border: `1px solid ${C.primaryBorder}`, backgroundColor: '#fff', color: C.primaryDark, cursor: 'pointer' }}>🏷️ {p.logoImage ? 'Adjust Logo' : 'Upload Logo'}</button>
              </div>
              {p.logoImage && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.ink, marginBottom: 6 }}>Logo Position</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'] as const).map(_pos => (
                      <span key={_pos} style={{ fontSize: 11, padding: '6px 10px', borderRadius: 999, border: p.logoPosition === _pos ? `1.5px solid ${C.primary}` : `1px solid ${C.border}`, backgroundColor: p.logoPosition === _pos ? C.primarySoft : '#fff', color: p.logoPosition === _pos ? C.primaryDark : C.muted, fontWeight: 600, textTransform: 'capitalize' }}>
                        {_pos.replace('-', ' ')}
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: C.faint, marginTop: 6 }}>Change position/size in the logo dialog — POST /api/ffmpeg/logo unchanged.</div>
                  <button onClick={() => { p.setLogoTargetId(null); p.setLogoModalOpen(true); }} style={{ ...ghostBtn, marginTop: 10, minHeight: 40, fontSize: 12, width: '100%' }}>
                    🏷️ {p.logoImage ? 'Adjust Logo' : 'Upload Logo'}
                  </button>
                  <button onClick={() => p.applyLogoToAllMedia()} disabled={p.isApplyingLogo} style={{ ...primaryBtn(p.isApplyingLogo), marginTop: 8, minHeight: 40, fontSize: 12 }}>
                    {p.isApplyingLogo ? 'Applying Logo…' : 'Apply Logo'}
                  </button>
                  {p.logoTargetId && p.mediaItems.some(m => m.id === p.logoTargetId) && (
                    <div style={{ marginTop: 8, fontSize: 11, color: C.primaryDark, backgroundColor: C.primarySoft, border: `1px solid ${C.primaryBorder}`, padding: '7px 10px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ flex: 1 }}>🎯 Will apply to {(() => { const i = p.mediaItems.findIndex(m => m.id === p.logoTargetId); return i === 0 ? '★ Cover image' : `Image #${i + 1}`; })()} only</span>
                      <button onClick={() => p.setLogoTargetId(null)} style={{ fontSize: 10, fontWeight: 700, background: 'none', border: 'none', color: C.primaryDark, cursor: 'pointer', textDecoration: 'underline' }}>All instead</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <WizardNav onBack={goBack} next={<button onClick={goNext} style={primaryBtn(false)}>Next →</button>} />
          </div>
        )}

        {/* ================= STEP 5 — PREVIEW ================= */}
        {currentStep === 5 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 19, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em' }}>Preview Your Post</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>Step 5 of 6: See how your content will look before publishing</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {([...p.selectedPlatforms].length ? p.selectedPlatforms : ['linkedin']).map(pl => (
                  <button key={pl} onClick={() => { setPreviewPlatform(pl); if (p.platformContent[pl]) p.switchPreviewPlatform(pl); }} style={{ padding: '7px 13px', borderRadius: 999, fontSize: 11, fontWeight: 700, textTransform: 'capitalize', border: previewPlatform === pl ? `1.5px solid ${p.platformColors[pl] || '#0A66C2'}` : `1px solid ${C.border}`, backgroundColor: previewPlatform === pl ? '#EFF6FF' : '#fff', color: previewPlatform === pl ? (p.platformColors[pl] || '#0A66C2') : C.muted, cursor: 'pointer' }}>{pl}</button>
                ))}
              </div>
            </div>
            <div className="sp-wiz-prev">
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', backgroundColor: '#fff' }}>
                <div style={{ padding: '12px 14px', display: 'flex', gap: 10 }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: p.logoImage ? `url(${p.logoImage}) center/cover` : 'linear-gradient(135deg,#0A66C2,#004182)', border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 12, overflow: 'hidden', flexShrink: 0 }}>{!p.logoImage && 'SP'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>SocialPulse <span style={{ fontSize: 10, color: C.muted, fontWeight: 400 }}>• 1st</span></div>
                    <div style={{ fontSize: 11, color: C.muted }}>Just now • 🌐 Public</div>
                  </div>
                  <span style={{ color: C.faint }}>⋯</span>
                </div>
                <div style={{ padding: '0 14px 4px', fontSize: 13, lineHeight: 1.65, color: C.ink, whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'hidden' }}>
                  {(() => {
                    if (!p.content.trim()) return 'Your amazing post will appear here...\nThis is how it will look on LinkedIn.';
                    // Caption already carries appended hashtags — strip the trailing tag block for display
                    // (tags render separately below in LinkedIn blue, exactly as published)
                    const tags = p.platformContent[p.activePreviewPlatform]?.hashtags || [];
                    if (!tags.length) return p.content;
                    return p.content.replace(/\n\n(#[A-Za-z0-9_]+\s*)+$/, '').trim() || p.content;
                  })()}
                </div>
                {(p.platformContent[p.activePreviewPlatform]?.hashtags || []).length > 0 && (
                  <div style={{ padding: '0 14px 12px', fontSize: 13, lineHeight: 1.7, color: '#0A66C2', fontWeight: 600 }}>
                    {(p.platformContent[p.activePreviewPlatform]?.hashtags || []).map(t => '#' + String(t).replace(/^#+/, '')).join(' ')}
                  </div>
                )}
                {(p.mediaItems.length > 0 || postExtraImages.length > 0 || p.generatedImage || p.generatedVideo) ? (
                  <div style={{ backgroundColor: '#000' }}>
                    {(() => {
                      const items = previewItems;
                      const single = items.length === 1;
                      return (
                        <div style={{ display: 'grid', gridTemplateColumns: single ? '1fr' : '1fr 1fr', gap: 2 }}>
                          {items.map(it => (
                            <div key={it.id} style={{ position: 'relative', aspectRatio: single ? '16/9' : '1', overflow: 'hidden', backgroundColor: '#000' }}>
                              {it.type === 'video' ? <video src={it.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted /> : <img src={it.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                              {it.type === 'image' && !!it.url && (
                                <button onClick={() => p.varyImageFromUrl(it.url)} disabled={!!p.varyingImageUrl || p.isGeneratingImage} title="Generate an AI variation of this image (added as a new item)" style={{ position: 'absolute', bottom: 8, right: 8, padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700, border: 'none', background: 'rgba(124,58,237,0.92)', color: '#fff', cursor: (!!p.varyingImageUrl || p.isGeneratingImage) ? 'wait' : 'pointer' }}>
                                  {p.varyingImageUrl === it.url ? 'Varying…' : '✨ Vary'}
                                </button>
                              )}
                              {p.logoImage && !p.burnedLogoIds[it.id] && (
                                <img src={p.logoImage} alt="logo" style={{
                                  position: 'absolute', width: `${Math.round(p.logoScale * 100)}%`, maxWidth: '28%', opacity: p.logoOpacity,
                                  ...(p.logoPosition === 'top-left' ? { top: 8, left: 8 } : p.logoPosition === 'top-right' ? { top: 8, right: 8 } : p.logoPosition === 'bottom-left' ? { bottom: 8, left: 8 } : p.logoPosition === 'bottom-right' ? { bottom: 8, right: 8 } : { top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }),
                                  backgroundColor: 'rgba(255,255,255,0.92)', padding: 4, borderRadius: 6,
                                }} />
                              )}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div style={{ margin: '0 14px 12px', border: '1.5px dashed #CBD5E1', borderRadius: 10, backgroundColor: '#F8FAFC', padding: 28, textAlign: 'center', color: C.faint, fontSize: 12 }}>🖼️ No image yet — add media in Step 4</div>
                )}
                <div style={{ padding: '10px 14px', display: 'flex', gap: 18, borderTop: `1px solid ${C.borderSoft}`, fontSize: 11, color: C.muted, fontWeight: 600 }}>
                  <span>👍 Like</span><span>💬 Comment</span><span>↗️ Repost</span><span style={{ marginLeft: 'auto' }}>✈️ Send</span>
                </div>
              </div>
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, backgroundColor: '#F8FAFC' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 12 }}>Final Review</div>
                {[
                  ['Topic', p.prompt ? (p.prompt.length > 60 ? p.prompt.slice(0, 60) + '…' : p.prompt) : '—'],
                  ['Tone', p.tone],
                  ['Image Style', p.imageStyle],
                  ['Aspect Ratio', p.aspectRatio || '—'],
                  ['Media Count', `${previewMediaCount} file${previewMediaCount === 1 ? '' : 's'}`],
                  ['Branding', p.logoImage ? `Logo • ${p.logoPosition}` : 'No logo'],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.borderSoft}`, fontSize: 12 }}>
                    <span style={{ color: C.muted }}>{k}</span>
                    <span style={{ color: C.ink, fontWeight: 600, textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <WizardNav onBack={goBack} next={<button onClick={goNext} style={primaryBtn(false)}>Continue to Publish →</button>} />
          </div>
        )}

        {/* ================= STEP 6 — PUBLISH ================= */}
        {currentStep === 6 && (
          <div>
            {header('Publish Your Post', 'Step 6 of 6: Share now or schedule for later', 'Great content is meant to be shared! Choose your platform and timing.')}
            <div className="sp-wiz-grid2" style={{ alignItems: 'start' }}>
              <div>
                <SectionTitle>Publishing Platforms</SectionTitle>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                  {['linkedin', 'instagram', 'facebook', 'twitter'].map(pl => {
                    const label = pl === 'twitter' ? 'X (Twitter)' : pl.charAt(0).toUpperCase() + pl.slice(1);
                    const comingSoon = pl !== 'linkedin' && pl !== 'facebook';
                    const selected = p.selectedPlatforms.includes(pl);
                    const connected = p.accounts.some(a => a.platform === pl && a.connected);
                    return (
                      <button key={pl} onClick={() => { if (!comingSoon) p.togglePlatform(pl); }} disabled={comingSoon}
                        style={{ padding: 10, borderRadius: 10, border: selected && !comingSoon ? `1.5px solid ${p.platformColors[pl] || C.primary}` : `1px solid ${C.border}`, backgroundColor: comingSoon ? '#F8FAFC' : '#fff', opacity: comingSoon ? 0.65 : 1, cursor: comingSoon ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }}>
                        <span style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: p.platformColors[pl], color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <p.PlatformIcon platform={pl} size={13} />
                        </span>
                        <span>
                          <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.ink }}>{label}</span>
                          <span style={{ display: 'block', fontSize: 9, fontWeight: 600, color: comingSoon ? '#B45309' : connected ? '#059669' : C.faint }}>{comingSoon ? 'Coming Soon' : connected ? '● Connected' : '○ Not connected'}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <SectionTitle>Connected Accounts</SectionTitle>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(['linkedin', 'facebook'] as const).map(pl => {
                    const acc = p.accounts.find(a => a.platform === pl && a.connected);
                    const label = pl.charAt(0).toUpperCase() + pl.slice(1);
                    if (!acc) return (
                      <div key={pl} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, textAlign: 'center', backgroundColor: '#FCFCFE' }}>
                        <div style={{ fontSize: 11, color: C.muted }}>No {label} account connected yet</div>
                        <button onClick={() => p.connectPlatform(pl)} style={{ marginTop: 8, padding: '8px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, border: 'none', background: 'linear-gradient(135deg,#7C3AED,#8B5CF6)', color: '#fff', cursor: 'pointer' }}>Connect {label}</button>
                      </div>
                    );
                    return (
                      <div key={pl} style={{ padding: 12, border: `1px solid ${C.border}`, borderRadius: 10, backgroundColor: '#F8FAFC' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: p.platformColors[pl], color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <p.PlatformIcon platform={pl} size={14} />
                          </span>
                          <span style={{ flex: 1 }}>
                            <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: C.ink }}>{acc.name || 'Admin / SocialPulse'}</span>
                            <span style={{ display: 'block', fontSize: 10, color: '#059669', fontWeight: 600 }}>● Connected{acc.email ? ` • ${acc.email}` : ''}{pl === 'facebook' && acc.pages?.length ? ` • ${(acc.pages.find(pg => pg.id === acc.pageId) || acc.pages[0]).name}` : ''}</span>
                          </span>
                          <button onClick={() => p.disconnectPlatform(pl)} style={{ fontSize: 10, fontWeight: 700, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 7, padding: '5px 9px', cursor: 'pointer' }}>Disconnect</button>
                        </div>
                        {pl === 'facebook' && (acc.pages?.length || 0) > 1 && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 11, fontWeight: 600, color: C.muted }}>
                            Page
                            <select
                              value={acc.pageId || acc.pages![0].id}
                              onChange={e => p.setAccountPageId('facebook', e.target.value)}
                              style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.border}`, backgroundColor: '#fff', color: C.ink, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
                            >
                              {acc.pages!.map(pg => (
                                <option key={pg.id} value={pg.id}>{pg.name}</option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 16 }}>
                  <SectionTitle>Publishing Options</SectionTitle>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {([['now', 'Publish Now', 'Share immediately'], ['later', 'Schedule for Later', 'Pick a date and time']] as const).map(([k, t, s]) => (
                      <button key={k} onClick={() => setPublishMode(k)} style={{ padding: 12, borderRadius: 10, border: publishMode === k ? `1.5px solid ${C.primary}` : `1px solid ${C.border}`, backgroundColor: publishMode === k ? C.primarySoft : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
                        <span style={{ width: 18, height: 18, borderRadius: '50%', border: publishMode === k ? `2px solid ${C.primary}` : `1.5px solid ${C.border}`, backgroundColor: publishMode === k ? C.primary : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10 }}>{publishMode === k ? '●' : ''}</span>
                        <span><span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: publishMode === k ? C.primaryDark : C.ink }}>{t}</span><span style={{ display: 'block', fontSize: 10, color: C.muted }}>{s}</span></span>
                      </button>
                    ))}
                  </div>
                  {publishMode === 'later' && (
                    <button onClick={() => p.setScheduleModalOpen(true)} style={{ marginTop: 8, width: '100%', padding: 11, borderRadius: 10, border: `1.5px dashed ${C.primaryBorder}`, backgroundColor: '#fff', color: C.primaryDark, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>📅 Pick a date & time (5+ min ahead)</button>
                  )}
                </div>
              </div>
              <div>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, backgroundColor: '#F8FAFC' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 10 }}>Ready to Go</div>
                  <div style={{ fontSize: 12, color: C.ink, backgroundColor: '#fff', border: `1px solid ${C.borderSoft}`, borderRadius: 8, padding: 10, maxHeight: 90, overflow: 'hidden' }}>
                    {(p.content.split('\n')[0] || 'No caption yet').slice(0, 140)}
                  </div>
                  {p.mediaItems.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      {p.mediaItems.slice(0, 4).map(m => (
                        <span key={m.id} style={{ width: 40, height: 40, borderRadius: 8, overflow: 'hidden', border: `1px solid ${C.border}`, backgroundColor: '#000', display: 'block' }}>
                          {m.type === 'video' ? <video src={m.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted /> : <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        </span>
                      ))}
                      {p.mediaItems.length > 4 && <span style={{ fontSize: 11, color: C.muted, alignSelf: 'center' }}>+{p.mediaItems.length - 4}</span>}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>Platforms: <b style={{ color: C.ink }}>{p.selectedPlatforms.length ? p.selectedPlatforms.map(pl => `${pl.charAt(0).toUpperCase() + pl.slice(1)} ${p.accounts.some(a => a.platform === pl && a.connected) ? '● Connected' : '○ Not connected'}`).join(' • ') : '—'}</b></div>
                  <div style={{ marginTop: 10, padding: 10, borderRadius: 9, fontSize: 11, fontWeight: 600,
                    backgroundColor: canPublish ? '#ECFDF5' : '#FFFBEB',
                    border: `1px solid ${canPublish ? '#A7F3D0' : '#FDE68A'}`,
                    color: canPublish ? '#065F46' : '#92400E' }}>
                    {canPublish ? '✓ All required fields completed.' : '⚠ Missing: ' + [
                      !hasContent ? 'content' : null,
                      p.selectedPlatforms.length === 0 ? 'platform selection' : (connectedSelected.length === 0 ? 'connection for the selected platform' : null),
                    ].filter(Boolean).join(' • ')}
                  </div>
                </div>
              </div>
            </div>
            <WizardNav
              onBack={goBack}
              next={<span style={{ display: 'flex', gap: 8 }}>
                <button onClick={saveDraft} style={{ ...ghostBtn, width: 'auto' }}>💾 Save Draft</button>
                {publishMode === 'now' ? (
                  <button onClick={p.publishToAll} disabled={p.isPublishing || p.publishCooldown > 0 || !canPublish} title={!canPublish ? publishBlocker : p.publishCooldown > 0 ? `Wait ${p.publishCooldown}s before publishing again` : 'Publish now'}
                    style={{ ...primaryBtn(p.isPublishing || p.publishCooldown > 0 || !canPublish), width: 'auto', background: (p.isPublishing || p.publishCooldown > 0 || !canPublish) ? '#DDD6FE' : 'linear-gradient(135deg,#059669,#10B981)', boxShadow: '0 4px 14px rgba(5,150,105,0.3)' }}>
                    {p.isPublishing ? 'Publishing…' : p.publishCooldown > 0 ? `Wait ${p.publishCooldown}s` : '🚀 Publish Now →'}
                  </button>
                ) : (
                  <button onClick={() => p.setScheduleModalOpen(true)} disabled={!canPublish} style={primaryBtn(!canPublish)}>📅 Schedule Post →</button>
                )}
              </span>}
            />
          </div>
        )}
      </div>
    </div>
  );
}
