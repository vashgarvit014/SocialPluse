'use client';

/* Local-only preview harness: mounts the REAL production StudioWizard with
   mock props so any single step/state can be reviewed directly, without
   walking the wizard flow. Never linked from the app; page.tsx 404s in prod. */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import StudioWizard from '@/app/_shell/studio-wizard';

// Loose mount for preview only (real component, mock props).
const WizardAny = StudioWizard as unknown as React.ComponentType<Record<string, unknown>>;

function StubIcon({ platform, size = 14 }: { platform: string; size?: number }) {
  return <span style={{ fontSize: size }}>{platform.slice(0, 2)}</span>;
}

const SEED: Record<string, { caption: string; hashtags: string[] }> = {
  linkedin: { caption: 'Preview mock: growing an audience is a system, not luck. Pick one problem weekly. #innovation', hashtags: ['innovation', 'technology'] },
  facebook: { caption: 'Preview mock: one problem, one fix, every week! #Community', hashtags: ['Community'] },
  instagram: { caption: 'Preview mock growth era, one fix weekly #instagood', hashtags: ['instagood'] },
  whatsapp: { caption: 'Preview mock: weekly growth tip, one problem one fix.', hashtags: [] },
};

export default function PreviewClient() {
  const search = useSearchParams();
  const stepParam = Math.max(1, Math.min(8, Number(search.get('step') || '1') || 1));
  const genParam = search.get('gen') === '1';
  const [wizardState, setWizardState] = useState<Record<string, unknown>>({ currentStep: stepParam });
  const [prompt, setPrompt] = useState('Preview fixture topic idea');
  const [tone, setTone] = useState('Professional');
  const [plats, setPlats] = useState<string[]>(['facebook']);
  const [content, setContentState] = useState('');
  const [platContent, setPlatContent] = useState<Record<string, { caption: string; hashtags: string[] }>>({});
  const [active, setActive] = useState('facebook');
  const [generating, setGenerating] = useState(false);
  const [genErr, setGenErr] = useState('');
  const [imgPrompt, setImgPrompt] = useState('');
  const [ratio, setRatio] = useState('1:1');
  const [style, setStyle] = useState('Photographic');
  const [genImg, setGenImg] = useState('');
  const [busyImg, setBusyImg] = useState(false);
  const noop = () => {};
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;

  // ?gen=1 starts a mock generation shortly after mount (for animation states).
  useEffect(() => {
    if (stepParam !== 3 || !genParam) return;
    const kick = setTimeout(() => {
      setGenerating(true);
      const done = setTimeout(() => {
        const next: Record<string, { caption: string; hashtags: string[] }> = {};
        for (const k of Object.keys(SEED)) next[k] = { caption: SEED[k].caption, hashtags: SEED[k].hashtags.slice() };
        setPlatContent(next);
        setActive(cur => {
          setContentState((next[cur] || next.facebook).caption);
          return cur;
        });
        setGenerating(false);
      }, 4000);
      (kick as unknown as { __done?: unknown }).__done = done;
    }, 600);
    return () => clearTimeout(kick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const p: Record<string, unknown> = useMemo(() => ({
    wizardState,
    setWizardState: (updater: unknown) => setWizardState(prev => (typeof updater === 'function' ? (updater as (v: Record<string, unknown>) => Record<string, unknown>)(prev) : { ...prev, ...(updater as object) })),
    prompt, setPrompt: (v: string) => setPrompt(v),
    content, setContent: (v: string) => setContentState(v),
    charCount: content.length, wordCount: words,
    imagePrompt: imgPrompt, setImagePrompt: (v: string) => setImgPrompt(v),
    tone, setTone: (v: string) => setTone(v),
    imageStyle: style, setImageStyle: (v: string) => setStyle(v),
    aspectRatio: ratio, setAspectRatio: (v: string) => setRatio(v),
    aspectRatioMap: {
      '1:1': { width: 768, height: 768, label: 'Square' },
      '9:16': { width: 720, height: 1280, label: 'Portrait' },
      '16:9': { width: 1280, height: 720, label: 'Landscape' },
      '4:3': { width: 1024, height: 768, label: 'Standard' },
    },
    selectedPlatforms: plats,
    togglePlatform: (id: string) => setPlats(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]),
    toggleAccount: noop,
    selectedAccountKeys: [] as string[], selectAllAccountsFor: noop, clearAccountsFor: noop,
    accounts: [] as unknown[],
    platformColors: { linkedin: '#0A66C2', instagram: '#E1306C', facebook: '#1877F2', whatsapp: '#25D366' },
    PlatformIcon: StubIcon,
    activePreviewPlatform: active,
    switchPreviewPlatform: (pl: string) => { setActive(pl); setContentState((platContent[pl] || SEED[pl] || { caption: '' }).caption); },
    previewPlatform: active, setPreviewPlatform: noop,
    platformContent: platContent, setPlatformContent: (v: unknown) => setPlatContent(v as Record<string, { caption: string; hashtags: string[] }>),
    topicMediaItems: [] as unknown[], removeTopicMedia: noop, clearTopicMedia: noop,
    topicFileInputRef: { current: null }, handleTopicUpload: noop, handleTopicDrop: noop,
    topicDragOver: false, setTopicDragOver: noop,
    dragOverTopic: false, setDragOverTopic: noop, handleDragOver: (e: { preventDefault: () => void }) => e.preventDefault(),
    fileInputRef: { current: null }, handleDrop: noop,
    dragOverPreview: false, setDragOverPreview: noop,
    mediaItems: [] as unknown[], removeMediaItem: noop,
    generatedImage: genImg, generatedVideo: '', mediaType: null,
    clearGeneratedImage: () => setGenImg(''),
    burnedLogoIds: {},
    isCarousel: false, carouselSlides: [] as unknown[], carouselValidation: { valid: true, reason: '' },
    isGeneratingContent: generating,
    generateContent: () => {
      setGenErr(''); setGenerating(true); setContentState('');
      setTimeout(() => {
        const next: Record<string, { caption: string; hashtags: string[] }> = {};
        for (const k of Object.keys(SEED)) next[k] = { caption: SEED[k].caption, hashtags: SEED[k].hashtags.slice() };
        setPlatContent(next);
        setActive(cur => {
          setContentState((next[cur] || next.facebook).caption);
          return cur;
        });
        setGenerating(false);
      }, 2500);
    },
    regeneratePlatform: (pl: string) => {
      setGenErr(''); setGenerating(true);
      setTimeout(() => {
        setPlatContent(prev => ({ ...prev, [pl]: { caption: SEED[pl].caption + ' (v2)', hashtags: SEED[pl].hashtags.slice() } }));
        setGenerating(false);
      }, 1500);
    },
    isGeneratingImage: busyImg,
    generateImage: () => {
      setBusyImg(true);
      setTimeout(() => {
        setGenImg('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="teal"/></svg>');
        setBusyImg(false);
      }, 1200);
    },
    altBusy: false, updateAltText: noop, generateAltText: noop,
    saveFullDraft: noop, cancelPreview: noop,
    openInCanva: noop, isSendingToCanva: false,
    whapiConnected: false, whapiCanConnect: false, startWhatsAppConnect: noop,
    disconnectPlatform: noop, disconnectWhatsApp: noop, whatsappDisconnecting: false, whapiLoading: false,
    connectPlatform: noop,
    logoImage: '',
    generationError: genErr, setGenerationError: (v: string) => setGenErr(v),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [wizardState, prompt, content, imgPrompt, tone, style, ratio, plats, active, platContent, generating, genErr, genImg, busyImg, words]);

  return (
    <div style={{ background: '#F4F5FA', minHeight: '100vh' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '10px 20px 0', fontSize: 11, color: '#94A3B8', fontFamily: 'system-ui' }}>
        LOCAL PREVIEW ONLY — mock state, nothing here touches production. Step from <code>?step=1–8</code>
        {stepParam === 3 ? <> · <code>?gen=1</code> starts mock generation</> : null}
      </div>
      <WizardAny {...p} />
    </div>
  );
}
