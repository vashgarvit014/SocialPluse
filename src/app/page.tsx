'use client';

import { useState, useEffect, useRef } from 'react';
import StudioWorkspace from './studio-workspace';

interface SocialAccount {
  platform: string;
  connected: boolean;
  name: string;
  email: string;
  // OAuth tokens live server-side only (linkedin-tokens.json /
  // facebook-tokens.json vaults).
  // accessToken may exist on legacy entries; never display or log it.
  accessToken?: string;
  userId: string;
  // Facebook Pages the account can publish to (id+name only, no secrets);
  // pageId is the selected publishing target.
  pages?: Array<{ id: string; name: string }>;
  pageId?: string;
}

const platformColors: Record<string, string> = {
  linkedin: '#0A66C2',
  instagram: '#E1306C',
  facebook: '#1877F2',
  twitter: '#000000',
};

const platformInitials: Record<string, string> = {
  linkedin: 'LI',
  instagram: 'IG',
  facebook: 'FB',
  twitter: 'TW',
};

// Real platform glyphs (inline SVG, white fill/stroke — sits on the platform's
// brand-color circle) instead of plain two-letter initials. Falls back to the
// initials text for any platform not in this set.
function PlatformIcon({ platform, size = 16 }: { platform: string; size?: number }) {
  switch (platform) {
    case 'linkedin':
      return (
        <span style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 700, fontSize: size, color: '#fff', lineHeight: 1, letterSpacing: '-0.03em' }}>
          in
        </span>
      );
    case 'facebook':
      return (
        <span style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontWeight: 700, fontStyle: 'italic', fontSize: size * 1.2, color: '#fff', lineHeight: 1 }}>
          f
        </span>
      );
    case 'twitter':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M4 4l16 16M20 4L4 20" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      );
    case 'instagram':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <rect x="3.5" y="3.5" width="17" height="17" rx="5.5" stroke="#fff" strokeWidth="1.8" />
          <circle cx="12" cy="12" r="4.3" stroke="#fff" strokeWidth="1.8" />
          <circle cx="17" cy="7" r="1.15" fill="#fff" />
        </svg>
      );
    default:
      return <>{platformInitials[platform] || platform.slice(0, 2).toUpperCase()}</>;
  }
}

// Prefixes each tag with a single "#", stripping any the AI already included
// so tags never render doubled up (e.g. "##AutoLaunch2024").
function formatHashtags(tags: string[]): string {
  return tags
    .map(t => `#${String(t).replace(/^#+/, '').trim()}`)
    .filter(t => t.length > 1)
    .join(' ');
}

// Calendar helpers — all operate in local time so "today"/day buckets match the viewer's clock.
function startOfWeekLocal(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  date.setDate(date.getDate() - date.getDay());
  return date;
}
function addDaysLocal(d: Date, days: number): Date {
  const date = new Date(d);
  date.setDate(date.getDate() + days);
  return date;
}
function localDateKey(d: Date): string {
  return d.toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
}

function getPostMedia(post: { imageUrl?: string; videoUrl?: string; mediaUrl?: string; mediaType?: string; mediaUrls?: string[]; mediaList?: MediaItem[] }) {
  const list = post.mediaList as MediaItem[] | undefined;
  if (list && list.length) {
    const first = list[0];
    const videoCount = list.filter(m=>m.type==='video').length;
    const imageCount = list.length - videoCount;
    return { url: first.url, type: first.type, isVideo: first.type==='video', list, count: list.length, videoCount, imageCount };
  }
  const urls = post.mediaUrls;
  if (urls && urls.length) {
    const first = urls[0];
    const isV = first.startsWith('data:video/');
    return { url: first, type: isV ? 'video' as const : 'image' as const, isVideo: isV, list: urls.map((u,i)=>({id:`${i}`,url:u,type:isV?'video':'image'} as MediaItem)), count: urls.length, videoCount: urls.filter(u=>u.startsWith('data:video/')).length, imageCount: urls.filter(u=>u.startsWith('data:image/')).length };
  }
  const url = post.mediaUrl || post.videoUrl || post.imageUrl || '';
  const type: 'image' | 'video' | null = (post.mediaType as 'image' | 'video' | null) || (post.videoUrl ? 'video' : post.imageUrl ? 'image' : null);
  const isVideo = type === 'video' || (url.startsWith('data:video/') || url.includes('video/'));
  return { url, type: isVideo ? 'video' as const : url ? 'image' as const : null, isVideo, list: url ? [{id:'0',url,type:isVideo?'video':'image'} as MediaItem] : [], count: url?1:0, videoCount: isVideo?1:0, imageCount: isVideo?0:(url?1:0) };
}

export interface MediaItem { id: string; url: string; type: 'image' | 'video'; name?: string }
export default function SocialMediaManager() {
  const [prompt, setPrompt] = useState('');
  const [content, setContent] = useState('');
  const [generatedImage, setGeneratedImage] = useState('');
  const [generatedVideo, setGeneratedVideo] = useState('');
  const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]); // Publish gallery (Media Preview) — up to 9
  const [topicMediaItems, setTopicMediaItems] = useState<MediaItem[]>([]); // Reference media for AI vision (Topic & Idea) — up to 4
  const [topicDragOver, setTopicDragOver] = useState(false);
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [tone, setTone] = useState('Professional');
  const [imageStyle, setImageStyle] = useState('Photographic');
  const [aspectRatio, setAspectRatio] = useState('');
  const aspectRatioMap: Record<string, {width:number,height:number,label:string,icon:string}> = {
    '1:1': { width: 768, height: 768, label: 'Square', icon: '⬜' },
    '16:9': { width: 1280, height: 720, label: 'Landscape', icon: '▬' },
    '9:16': { width: 720, height: 1280, label: 'Portrait', icon: '▮' },
    '4:3': { width: 1024, height: 768, label: 'Standard', icon: '🖼️' },
  };
  // Logo overlay (ffmpeg-style) — for generated + uploaded image/video
  const [logoImage, setLogoImage] = useState<string>(''); // dataURL of company logo
  const [logoPosition, setLogoPosition] = useState<'top-left'|'top-right'|'bottom-left'|'bottom-right'|'center'>('bottom-right');
  const [logoScale, setLogoScale] = useState(0.18); // 0.12 - 0.35 of base width
  const [logoOpacity, setLogoOpacity] = useState(1);
  const [isApplyingLogo, setIsApplyingLogo] = useState(false);
  const [logoModalOpen, setLogoModalOpen] = useState(false);
  // null = apply to all media; set to a media id to target a single image
  const [logoTargetId, setLogoTargetId] = useState<string | null>(null);
  // Images that already have the logo burned in — preview overlay must hide for these (else double logo)
  const [burnedLogoIds, setBurnedLogoIds] = useState<Record<string, boolean>>({});
  // Original (pre-logo) URLs so re-applying never stacks logos on top of logos
  const originalMediaRef = useRef<Record<string, string>>({});
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [publishResult, setPublishResult] = useState('');
  const [publishResultType, setPublishResultType] = useState<'success' | 'error'>('success');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [canvaConnected, setCanvaConnected] = useState(false);
  const [canvaName, setCanvaName] = useState('');
  const [isSendingToCanva, setIsSendingToCanva] = useState(false);
  const [isImportingFromCanva, setIsImportingFromCanva] = useState(false);
  const [canvaReadyId, setCanvaReadyId] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);
  const [justConnectedPlatform, setJustConnectedPlatform] = useState<string | null>(null);
  const [publishSuccessFlash, setPublishSuccessFlash] = useState(false);
  const [scheduleSuccessFlash, setScheduleSuccessFlash] = useState(false);
  const [editorTab, setEditorTab] = useState<'edit' | 'preview'>('preview');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [allPosts, setAllPosts] = useState<Array<{ id: string; content: string; platforms: string[]; scheduledAt: string; status: string; imageUrl?: string; videoUrl?: string; mediaType?: 'image' | 'video'; mediaUrl?: string; mediaUrls?: string[]; mediaList?: MediaItem[]; createdAt?: string }>>([]);
  const [isScheduling, setIsScheduling] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'studio' | 'scheduler' | 'analytics' | 'media' | 'drafts'>('studio');
  const [schedulerFilter, setSchedulerFilter] = useState<'all' | 'pending' | 'published' | 'failed' | 'cancelled'>('all');
  const [calendarWeekStart, setCalendarWeekStart] = useState<Date>(() => startOfWeekLocal(new Date()));
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const timePickerRef = useRef<HTMLDivElement>(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const topicFileInputRef = useRef<HTMLInputElement>(null);
  const [platformContent, setPlatformContent] = useState<Record<string, { caption: string; hashtags: string[] }>>({});
  const [imagePrompt, setImagePrompt] = useState('');
  const [activePreviewPlatform, setActivePreviewPlatform] = useState('');
  const [generationError, setGenerationError] = useState('');
  // Safety-filter popup: the image model refused the prompt (not an outage).
  const [safetyBlockedOpen, setSafetyBlockedOpen] = useState(false);
  const SAFETY_EXAMPLE_PROMPT = 'Modern office desk with a sleek tablet displaying a colorful analytics dashboard, warm morning light, photorealistic';
  const [statusMessage, setStatusMessage] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [draggedMediaId, setDraggedMediaId] = useState<string | null>(null);
  const [dragOverMediaId, setDragOverMediaId] = useState<string | null>(null);

  // ---- Reload persistence ----
  // Browsers forbid custom popups *during* a reload (beforeunload only gets
  // the native leave/stay dialog), so the two-choice popup lives right AFTER
  // the reload instead: work is autosaved continuously, and on load we ask
  // whether to keep it or start clean. Both buttons fully work - Keep
  // restores everything, Fresh wipes the saved draft and stays empty.
  const DRAFT_KEY = 'socialpulse-draft';
  interface SavedDraft {
    prompt: string; tone: string; imageStyle: string; aspectRatio: string;
    content: string; platformContent: Record<string, { caption: string; hashtags: string[] }>;
    imagePrompt: string; activePreviewPlatform: string; selectedPlatforms: string[];
    mediaItems: MediaItem[]; topicMediaItems: MediaItem[];
    generatedImage: string; generatedVideo: string; mediaType: 'image' | 'video' | null;
    originals: Record<string, string>; burnedLogoIds: Record<string, boolean>;
    logoImage: string; logoPosition: string; logoScale: number; logoOpacity: number;
    mediaSkipped?: boolean; savedAt: number;
  }
  const [restorePromptOpen, setRestorePromptOpen] = useState(false);
  const [savedDraft, setSavedDraft] = useState<SavedDraft | null>(null);

  const draftIsMeaningful = (d: SavedDraft) =>
    !!(d.prompt?.trim() || d.content?.trim() || d.mediaItems?.length || d.topicMediaItems?.length || d.generatedImage || d.generatedVideo);

  // Runs first on mount (declared before the autosaver below): offer restore.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as SavedDraft;
      if (d && draftIsMeaningful(d)) {
        setSavedDraft(d);
        setRestorePromptOpen(true);
      } else {
        localStorage.removeItem(DRAFT_KEY);
      }
    } catch { /* corrupt draft - start clean */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave everything that rebuilds the workspace (debounced). Skipped
  // while the restore popup is awaiting a choice, so we never clobber the
  // saved draft before the user picks Keep or Fresh.
  useEffect(() => {
    if (restorePromptOpen) return;
    const t = setTimeout(() => {
      const draft: SavedDraft = {
        prompt, tone, imageStyle, aspectRatio, content, platformContent,
        imagePrompt, activePreviewPlatform, selectedPlatforms,
        mediaItems, topicMediaItems, generatedImage, generatedVideo, mediaType,
        originals: originalMediaRef.current, burnedLogoIds,
        logoImage, logoPosition, logoScale, logoOpacity, savedAt: Date.now(),
      };
      const full = JSON.stringify(draft);
      // dataURL galleries can exceed the ~5MB localStorage quota - then keep
      // the text state and drop the heavy pixels rather than saving nothing.
      if (full.length > 4_000_000) {
        (draft as SavedDraft).mediaItems = [];
        (draft as SavedDraft).topicMediaItems = [];
        (draft as SavedDraft).generatedImage = '';
        (draft as SavedDraft).generatedVideo = '';
        (draft as SavedDraft).logoImage = '';
        (draft as SavedDraft).mediaSkipped = true;
      }
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch {
        try {
          localStorage.setItem(DRAFT_KEY, JSON.stringify({
            ...draft, mediaItems: [], topicMediaItems: [], generatedImage: '', generatedVideo: '', logoImage: '', mediaSkipped: true,
          }));
        } catch { /* storage unavailable - session simply won't restore */ }
      }
    }, 800);
    return () => clearTimeout(t);
  }, [restorePromptOpen, prompt, tone, imageStyle, aspectRatio, content, platformContent, imagePrompt, activePreviewPlatform, selectedPlatforms, mediaItems, topicMediaItems, generatedImage, generatedVideo, mediaType, burnedLogoIds, logoImage, logoPosition, logoScale, logoOpacity]);

  const keepRestoredDraft = () => {
    const d = savedDraft;
    if (d) {
      setPrompt(d.prompt || ''); setTone(d.tone || 'Professional');
      setImageStyle(d.imageStyle || 'Photographic'); setAspectRatio(d.aspectRatio || '');
      setContent(d.content || ''); setPlatformContent(d.platformContent || {});
      setImagePrompt(d.imagePrompt || ''); setActivePreviewPlatform(d.activePreviewPlatform || '');
      setSelectedPlatforms(Array.isArray(d.selectedPlatforms) ? d.selectedPlatforms : []);
      setMediaItems(Array.isArray(d.mediaItems) ? d.mediaItems : []);
      setTopicMediaItems(Array.isArray(d.topicMediaItems) ? d.topicMediaItems : []);
      setGeneratedImage(d.generatedImage || ''); setGeneratedVideo(d.generatedVideo || '');
      setMediaType(d.mediaType || null);
      originalMediaRef.current = d.originals || {};
      setBurnedLogoIds(d.burnedLogoIds || {});
      setLogoImage(d.mediaSkipped ? '' : (d.logoImage || ''));
      if (typeof d.logoScale === 'number') setLogoScale(d.logoScale);
      if (typeof d.logoOpacity === 'number') setLogoOpacity(d.logoOpacity);
      if (d.logoPosition) setLogoPosition(d.logoPosition as typeof logoPosition);
      if (d.mediaSkipped) {
        setPublishResult('Previous work restored (images were too large to keep and were skipped).');
        setPublishResultType('success'); setShowToast(true); setTimeout(() => setShowToast(false), 4000);
      }
    }
    setSavedDraft(null);
    setRestorePromptOpen(false);
  };

  const discardSavedDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    setSavedDraft(null);
    setRestorePromptOpen(false);
  };

  const contentMessages = [
    'Analyzing your image with AI vision...',
    'Understanding the visual context...',
    'Crafting platform-specific captions...',
    'Generating relevant hashtags...',
    'Polishing your content...',
    'Almost there, finalizing...',
  ];

  const imageMessages = [
    'Sending your prompt to the image generator...',
    'AI is painting your vision...',
    'Rendering pixels into art...',
    'Adding finishing touches...',
    'Almost ready...',
  ];

  useEffect(() => {
    if (!isGeneratingContent && !isGeneratingImage) {
      setStatusMessage('');
      return;
    }
    const messages = isGeneratingContent ? contentMessages : imageMessages;
    let idx = 0;
    setStatusMessage(messages[0]);
    const interval = setInterval(() => {
      idx = (idx + 1) % messages.length;
      setStatusMessage(messages[idx]);
    }, 4000);
    return () => clearInterval(interval);
  }, [isGeneratingContent, isGeneratingImage]);

  useEffect(() => {
    const saved = localStorage.getItem('socialAccounts');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as SocialAccount[];
        // Scrub any legacy tokens left in browser storage from older versions.
        const scrubbed = parsed.map(a => {
          const { accessToken: _dropped, ...rest } = a;
          void _dropped;
          return rest as SocialAccount;
        });
        setAccounts(scrubbed);
        localStorage.setItem('socialAccounts', JSON.stringify(scrubbed));
      } catch { /* ignore */ }
    }

    const params = new URLSearchParams(window.location.search);
    const platform = params.get('platform');
    const connected = params.get('connected');
    const name = params.get('name');
    const email = params.get('email');
    const userId = params.get('user_id');
    const error = params.get('error');

    if (error) {
      // CANVA_* errors are handled (with friendly messages) by the Canva
      // effect below - leave the URL untouched so it can read them. Touching
      // it here would wipe the query before that effect runs.
      if (!error.startsWith('CANVA_')) {
        const friendly = error === 'no_facebook_page'
          ? 'Facebook connected, but no Page was found. Create or get admin access to a Facebook Page, then connect again.'
          : `Connection failed: ${error}`;
        setPublishResult(friendly);
        setPublishResultType('error');
        setShowToast(true);
        window.history.replaceState({}, '', '/');
        setTimeout(() => setShowToast(false), 4000);
      }
    } else if (platform && connected === 'true' && userId) {      // Token stays server-side (vault written by the OAuth callback).
      // Only the user id + profile metadata are kept in the browser. For
      // Facebook the callback also passes the Page id/name list (no secrets)
      // so the account card can offer a Page picker.
      let pages: Array<{ id: string; name: string }> | undefined;
      try {
        const rawPages = params.get('pages');
        if (platform === 'facebook' && rawPages) {
          const parsed = JSON.parse(rawPages) as Array<{ id?: string; name?: string }>;
          if (Array.isArray(parsed)) {
            pages = parsed.filter(p => p.id).map(p => ({ id: p.id as string, name: p.name || 'Page' }));
            if (pages.length === 0) pages = undefined;
          }
        }
      } catch { /* malformed pages param - account still connects, first Page is used server-side */ }
      const newAccount: SocialAccount = {
        platform,
        connected: true,
        name: name || platform,
        email: email || '',
        userId: userId || '',
        ...(pages ? { pages, pageId: pages[0].id } : {}),
      };
      setAccounts(prev => {
        const filtered = prev.filter(a => a.platform !== platform);
        const updated = [...filtered, newAccount];
        localStorage.setItem('socialAccounts', JSON.stringify(updated));
        return updated;
      });
      setPublishResult(`${platform.charAt(0).toUpperCase() + platform.slice(1)} connected successfully!`);
      setPublishResultType('success');
      setShowToast(true);
      setJustConnectedPlatform(platform);
      window.history.replaceState({}, '', '/');
      setTimeout(() => setShowToast(false), 4000);
      setTimeout(() => setJustConnectedPlatform(null), 2600);
    }
  }, []);

  // Connection status always comes from the server (never faked/assumed from
  // a client-side flag) - the token itself only ever lives in httpOnly cookies.
  const refreshCanvaStatus = async () => {
    try {
      const res = await fetch('/api/canva/status');
      const data = await res.json();
      setCanvaConnected(!!data.connected);
      setCanvaName(data.displayName || '');
    } catch {
      setCanvaConnected(false);
    }
  };

  useEffect(() => {
    refreshCanvaStatus();

    const params = new URLSearchParams(window.location.search);
    const canvaConnectedParam = params.get('canva_connected');
    const canvaNameParam = params.get('canva_name');
    const canvaReadyParam = params.get('canva_ready');
    const error = params.get('error');

    if (canvaConnectedParam === 'true') {
      // Optimistic UI for the moment right after OAuth; refreshCanvaStatus()
      // above is still the source of truth for every subsequent page load.
      setCanvaConnected(true);
      setCanvaName(canvaNameParam || 'Canva');
      window.history.replaceState({}, '', '/');
    } else if (canvaReadyParam) {
      // Back from the Canva editor - the design is ready to import, but we
      // only export it once the user explicitly clicks "Import from Canva".
      setCanvaReadyId(canvaReadyParam);
      window.history.replaceState({}, '', '/');
    } else if (error?.startsWith('CANVA_')) {
      const messages: Record<string, string> = {
        CANVA_AUTH_FAILED: 'Canva authorization failed. Please try connecting again.',
        CANVA_STATE_MISMATCH: 'Canva connection could not be verified. Please try again.',
        CANVA_TOKEN_EXPIRED: 'Your Canva session expired. Please reconnect.',
        CANVA_IMPORT_FAILED: 'Could not prepare the Canva design for import. Please try again.',
      };
      setGenerationError(messages[error] || `Canva error: ${error}`);
      window.history.replaceState({}, '', '/');
    }
  }, []);

  // Return-tab handshake: /canva-return runs in the editor tab opened by
  // "Edit in Canva". It verifies server-side first, then postMessages the
  // ready id (or error code) here and closes itself. Same-origin only; the
  // existing ?canva_ready= / ?error= query handling above stays as the
  // fallback for same-tab returns.
  useEffect(() => {
    const onCanvaMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; readyId?: string; code?: string } | null;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'canva-ready' && d.readyId) {
        setCanvaReadyId(d.readyId);
        setPublishResult('Canva design is ready — click Import from Canva to bring it in.');
        setPublishResultType('success');
        setShowToast(true);
        setTimeout(() => setShowToast(false), 5000);
      } else if (d.type === 'canva-error' && d.code) {
        const messages: Record<string, string> = {
          CANVA_AUTH_FAILED: 'Canva authorization failed. Please try connecting again.',
          CANVA_STATE_MISMATCH: 'Canva connection could not be verified. Please try again.',
          CANVA_TOKEN_EXPIRED: 'Your Canva session expired. Please reconnect.',
          CANVA_IMPORT_FAILED: 'Could not prepare the Canva design for import. Please try again.',
        };
        setGenerationError(messages[d.code] || `Canva error: ${d.code}`);
      }
    };
    window.addEventListener('message', onCanvaMessage);
    return () => window.removeEventListener('message', onCanvaMessage);
  }, []);

  const loadScheduledPosts = async () => {
    try {
      const res = await fetch('/api/scheduler');
      const data = await res.json();
      setAllPosts(data.posts || []);
    } catch { /* ignore */ }
  };

  // No auto-polling: due scheduled posts publish only via explicit "Check now"
  // (manual trigger in Scheduler). See checkDuePosts below.
  useEffect(() => {
    loadScheduledPosts();
  }, []);

  const [isCheckingDue, setIsCheckingDue] = useState(false);
  const checkDuePosts = async () => {
    setIsCheckingDue(true);
    try {
      const res = await fetch('/api/scheduler/check', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      await loadScheduledPosts();
      const n = typeof data.publishedCount === 'number' ? data.publishedCount : 0;
      setPublishResult(n > 0 ? `Published ${n} due post${n === 1 ? '' : 's'}` : 'No due posts to publish');
      setPublishResultType('success');
    } catch {
      setPublishResult('Failed to check due posts');
      setPublishResultType('error');
    }
    setShowToast(true);
    setIsCheckingDue(false);
    setTimeout(() => setShowToast(false), 4000);
  };

  useEffect(() => {
    if (!timePickerOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (timePickerRef.current && !timePickerRef.current.contains(e.target as Node)) {
        setTimePickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [timePickerOpen]);

  useEffect(() => {
    if (!timePickerOpen || !timePickerRef.current) return;
    requestAnimationFrame(() => {
      timePickerRef.current?.querySelectorAll<HTMLElement>('[data-selected]').forEach(el => {
        el.scrollIntoView({ block: 'center' });
      });
    });
  }, [timePickerOpen]);

  useEffect(() => {
    if (!scheduleModalOpen) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setScheduleModalOpen(false); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [scheduleModalOpen]);

  const schedulePost = async () => {
    if (!content.trim() || !scheduleDate || !scheduleTime) return;

    const scheduledTime = new Date(`${scheduleDate}T${scheduleTime}`);
    const minTime = new Date(Date.now() + 5 * 60 * 1000);
    if (scheduledTime <= minTime) {
      setPublishResult('Schedule time must be at least 5 minutes from now');
      setPublishResultType('error');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 4000);
      return;
    }

    const connectedSelected = selectedPlatforms.filter(p =>
      accounts.some(a => a.platform === p && a.connected)
    );
    if (connectedSelected.length === 0) {
      setPublishResult('No connected platforms selected');
      setPublishResultType('error');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 4000);
      return;
    }

    setIsScheduling(true);
    try {
      const scheduledAt = scheduledTime.toISOString();
      // Server resolves the OAuth token from userId at publish time — no tokens stored here.
      const accountsData = connectedSelected.map(p => {
        const acc = accounts.find(a => a.platform === p && a.connected)!;
        return { platform: p, userId: acc.userId, pageId: acc.pageId || undefined };
      });

      const currentMediaUrl = publishMediaList[0]?.url || generatedVideo || generatedImage;
      const currentMediaType = publishMediaList[0]?.type || (generatedVideo ? 'video' : generatedImage ? 'image' : null);
      const allMediaUrls = publishMediaList.length ? publishMediaList.map(m => m.url) : (currentMediaUrl ? [currentMediaUrl] : []);
      const res = await fetch('/api/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          imageUrl: generatedImage,
          videoUrl: generatedVideo,
          mediaUrl: currentMediaUrl,
          mediaType: currentMediaType,
          mediaUrls: allMediaUrls,
          mediaList: publishMediaList,
          platforms: connectedSelected,
          accounts: accountsData,
          scheduledAt,
        }),
      });

      if (res.ok) {
        setPublishResult(`Post scheduled for ${new Date(scheduledAt).toLocaleString()}`);
        setPublishResultType('success');
        setScheduleDate('');
        setScheduleTime('');
        loadScheduledPosts();
        // Show a brief success state inside the modal before it closes,
        // so the confirmation is felt, not just implied by the toast.
        setScheduleSuccessFlash(true);
        setTimeout(() => {
          setScheduleSuccessFlash(false);
          setScheduleModalOpen(false);
        }, 1100);
      } else {
        setPublishResult('Failed to schedule post');
        setPublishResultType('error');
      }
    } catch {
      setPublishResult('Failed to schedule post');
      setPublishResultType('error');
    }
    setShowToast(true);
    setIsScheduling(false);
    setTimeout(() => setShowToast(false), 4000);
  };

  const cancelScheduled = async (id: string) => {
    try {
      await fetch('/api/scheduler', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      loadScheduledPosts();
    } catch { /* ignore */ }
  };

  const connectPlatform = (platform: string) => {
    window.location.href = `/api/${platform}/auth`;
  };

  const disconnectPlatform = async (platform: string) => {
    const doomed = accounts.find(a => a.platform === platform);
    // Remove server-held credentials first so the account can never publish again.
    try {
      await fetch(`/api/${platform}/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, userId: doomed?.userId }),
      });
    } catch { /* local state is still cleared below */ }
    setAccounts(prev => {
      const updated = prev.filter(a => a.platform !== platform);
      localStorage.setItem('socialAccounts', JSON.stringify(updated));
      return updated;
    });
    setSelectedPlatforms(prev => prev.filter(p => p !== platform));
  };

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(platform) ? prev.filter(p => p !== platform) : [...prev, platform]
    );
  };

  // Facebook Page picker: switches the publishing target within the
  // connected account. Tokens stay server-side; only the Page id travels.
  const setAccountPageId = (platform: string, pageId: string) => {
    setAccounts(prev => {
      const updated = prev.map(a => (a.platform === platform ? { ...a, pageId } : a));
      localStorage.setItem('socialAccounts', JSON.stringify(updated));
      return updated;
    });
  };

  const generateContent = async () => {
    if (!prompt.trim() && topicMediaItems.length===0 && mediaItems.length===0 && !generatedImage && !generatedVideo) {
      setGenerationError('Please enter a topic or attach an image/video before generating.');
      return;
    }
    const genPlatforms = [...selectedPlatforms];
    if (genPlatforms.length === 0) {
      setGenerationError('Please select a platform (LinkedIn) before generating.');
      return;
    }
    setGenerationError('');
    setIsGeneratingContent(true);
    setPlatformContent({});
    setContent('');
    const refImages = [...topicMediaItems.filter(m=>m.type==='image'), ...mediaItems.filter(m=>m.type==='image')].slice(0, 4);
    const originalImage = refImages[0]?.url || generatedImage;
    setImagePrompt('');
    try {
      const imageDataListForAPI = refImages.length
        ? await Promise.all(refImages.map(m => getCompressedForAPI(m.url)))
        : originalImage ? [await getCompressedForAPI(originalImage)] : [];
      const imageDataForAPI = imageDataListForAPI[0];
      const res = await fetch('/api/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, tone, platforms: genPlatforms, hasImage: imageDataListForAPI.length > 0, imageData: imageDataForAPI, imageDataList: imageDataListForAPI }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate content');
      }
      if (!data.platforms || typeof data.platforms !== 'object') {
        throw new Error('Invalid response from AI. Please try again.');
      }
      setPlatformContent(data.platforms);
      setImagePrompt(data.image_prompt || '');
      const firstPlatform = genPlatforms[0];
      if (data.platforms[firstPlatform]) {
        setContent(data.platforms[firstPlatform].caption + '\n\n' + formatHashtags(data.platforms[firstPlatform].hashtags || []));
        setActivePreviewPlatform(firstPlatform);
      }
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : 'Failed to generate content');
    }
    setIsGeneratingContent(false);
  };

  const generateImageFromPrompt = async (promptText: string) => {
    if (!aspectRatio) { setGenerationError('Please choose an aspect ratio first.'); return; }
    setIsGeneratingImage(true);
    setGenerationError('');
    try {
      const size = aspectRatioMap[aspectRatio] || aspectRatioMap['1:1'];
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText, style: imageStyle, size: { width: size.width, height: size.height }, aspectRatio }),
      });
      const data = await res.json();
      if (!res.ok && data?.error?.code === 'IMAGE_SAFETY_BLOCKED') {
        // Not an outage - the filter refused these exact words. Retrying them
        // is pointless, so explain that in a popup instead of a raw error.
        setSafetyBlockedOpen(true);
        setIsGeneratingImage(false);
        return;
      }
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Image generation failed — gpt-image-2 hold, try again');
      }
      if (data.image) {
        const item: MediaItem = { id: Date.now().toString(36)+Math.random().toString(36).slice(2,4), url: data.image, type: 'image', name: 'generated' };
        setMediaItems(prev => [...prev, item]);
        setGeneratedImage(data.image);
        setGeneratedVideo('');
        setMediaType('image');
      } else {
        throw new Error(data.message || data.error || 'Image generation failed');
      }
    } catch (err) {
      console.error('Image generation failed', err);
      setGenerationError(err instanceof Error ? err.message : 'Image generation failed — gpt-image-2 hold, try again');
    }
    setIsGeneratingImage(false);
  };

  const generateImage = async () => {
    const promptText = imagePrompt || content.trim().split('\n')[0].substring(0, 200) || prompt.trim();
    if (!promptText) return;
    await generateImageFromPrompt(promptText);
  };

  // AI variation of an uploaded/reference image: vision describes it, the
  // description becomes the prompt for a fresh text-to-image generation.
  // The variation lands as a NEW media item (nothing is overwritten).
  const [varyingImageUrl, setVaryingImageUrl] = useState<string | null>(null);
  const varyImageFromUrl = async (url: string) => {
    if (!url || varyingImageUrl || isGeneratingImage) return;
    if (!aspectRatio) { setGenerationError('Please choose an aspect ratio first.'); return; }
    setVaryingImageUrl(url);
    setGenerationError('');
    try {
      const compressed = await getCompressedForAPI(url);
      const vres = await fetch('/api/vary-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData: compressed, style: imageStyle }),
      });
      const vdata = await vres.json();
      if (!vres.ok || !vdata.prompt) throw new Error(vdata.error || 'Could not describe image for variation');
      setImagePrompt(vdata.prompt);
      await generateImageFromPrompt(vdata.prompt);
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : 'Variation failed');
    }
    setVaryingImageUrl(null);
  };

  // Reference (topic) images ride along to preview + publish + schedule,
  // deduped by URL. Skipped when the post already carries video (LinkedIn
  // takes 1 video OR up to 9 images, never mixed).
  const topicImagesForPost = topicMediaItems.filter(m => m.type === 'image' && !mediaItems.some(x => x.url === m.url));
  const postHasVideo = mediaItems.some(m => m.type === 'video') || !!generatedVideo;
  const publishMediaList = (postHasVideo ? mediaItems : [...mediaItems, ...topicImagesForPost]).slice(0, 9);

  // The image "Edit in Canva" acts on: whatever's currently generated, else
  // the first image already in the media list.
  const canvaSourceImage = generatedImage || mediaItems.find(m => m.type === 'image')?.url || '';

  // "Edit in Canva": upload the current image as a Canva asset, create a  // design pre-loaded with it (sized to SocialPulse's own aspect ratio
  // setting), then open the editor in a NEW TAB - this tab stays put. When
  // the user clicks the editor's Return button, /content-studio ->
  // /api/canva/return verifies the JWT and lands the new tab on
  // /canva-return, which postMessages the ready id back here and closes
  // itself. Import stays an explicit button press (never automatic).
  // Handle to the Canva editor tab opened by "Edit in Canva" (reused while open).
  const canvaTabRef = useRef<Window | null>(null);

  // Shared new-tab opener for Canva editor URLs (never navigates this tab
  // away): opens synchronously in the click handler so popup blockers allow
  // it, then points it at the editor. No `noopener` - the return page uses
  // window.opener.postMessage to hand the ready design back, then closes.
  const openCanvaEditUrl = (editUrl: string) => {
    if (!canvaTabRef.current || canvaTabRef.current.closed) {
      canvaTabRef.current = window.open('about:blank', '_blank');
    }
    if (canvaTabRef.current && !canvaTabRef.current.closed) {
      canvaTabRef.current.location.href = editUrl;
      canvaTabRef.current.focus?.();
      return true;
    }
    // Popup blocked - fall back to same-tab navigation (/canva-return still
    // picks the design up via its query-param fallback path).
    canvaTabRef.current = null;
    window.location.href = editUrl;
    return false;
  };

  const openInCanva = async (sourceUrl?: string) => {
    if (!canvaConnected) {
      window.location.href = '/api/canva/auth';
      return;
    }
    // Explicit per-image target when given (thumbnail Edit buttons);
    // otherwise the working default: generated image, else first gallery image.
    // Guard: a bare onClick passes its MouseEvent - only a dataURL counts.
    const src = (typeof sourceUrl === 'string' && sourceUrl.startsWith('data:') ? sourceUrl : '') || canvaSourceImage;
    if (!src) return;

    setIsSendingToCanva(true);
    setGenerationError('');
    try {
      const size = aspectRatioMap[aspectRatio] || aspectRatioMap['1:1'];
      const res = await fetch('/api/canva/create-design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageData: src,
          width: size.width,
          height: size.height,
          title: prompt.trim() || 'SocialPulse design',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.editUrl) {
        if (data.error?.code === 'CANVA_NOT_CONNECTED') setCanvaConnected(false);
        throw new Error(data.error?.message || 'Failed to open design in Canva');
      }
      openCanvaEditUrl(data.editUrl);
      setIsSendingToCanva(false);
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : 'Failed to open design in Canva');
      setIsSendingToCanva(false);
    }
  };

  // "Create in Canva": blank design (no source image) for building with
  // Canva's own tools. Same new tab + same return/import chain as Edit.
  const [isCreatingInCanva, setIsCreatingInCanva] = useState(false);
  const createInCanva = async () => {
    if (!canvaConnected) {
      window.location.href = '/api/canva/auth';
      return;
    }
    setIsCreatingInCanva(true);
    setGenerationError('');
    try {
      const size = aspectRatioMap[aspectRatio] || aspectRatioMap['1:1'];
      const res = await fetch('/api/canva/create-blank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          width: size.width,
          height: size.height,
          title: prompt.trim() || 'SocialPulse design',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.editUrl) {
        if (data.error?.code === 'CANVA_NOT_CONNECTED') setCanvaConnected(false);
        throw new Error(data.error?.message || 'Failed to create design in Canva');
      }
      openCanvaEditUrl(data.editUrl);
      setIsCreatingInCanva(false);
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : 'Failed to create design in Canva');
      setIsCreatingInCanva(false);
    }
  };

  // "Import from Canva": exports the design the user just edited and adds it
  // as a new media item - it never overwrites generatedImage/mediaItems
  // automatically, matching how uploads and AI-generated images both land as
  // additions rather than silent replacements.
  const importFromCanva = async () => {
    if (!canvaReadyId) return;
    setIsImportingFromCanva(true);
    setGenerationError('');
    try {
      const res = await fetch('/api/canva/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readyId: canvaReadyId }),
      });
      const data = await res.json();
      if (!res.ok || !data.image) {
        if (data.error?.code === 'CANVA_NOT_CONNECTED') setCanvaConnected(false);
        throw new Error(data.error?.message || 'Failed to import design from Canva');
      }
      const item: MediaItem = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 4), url: data.image, type: 'image', name: 'canva-edit' };
      setMediaItems(prev => [...prev, item]);
      setCanvaReadyId('');
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : 'Failed to import design from Canva');
    }
    setIsImportingFromCanva(false);
  };

  const disconnectCanva = async () => {
    try {
      await fetch('/api/canva/disconnect', { method: 'POST' });
    } catch { /* cookies may already be gone server-side; UI still resets below */ }
    setCanvaConnected(false);
    setCanvaName('');
    setCanvaReadyId('');
  };

  // Publish gallery handler (Media Preview) — up to 9, mixed
  const handleUploadImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (mediaItems.length + files.length > 9) {
      setGenerationError('You can attach up to 9 media files per post.');
      e.target.value = '';
      return;
    }
    const validFiles: File[] = [];
    for (const file of files) {
      const isVideo = file.type.startsWith('video/');
      const isImage = file.type.startsWith('image/');
      if (!isVideo && !isImage) continue;
      const maxSize = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
      if (file.size > maxSize) {
        setGenerationError(`${file.name}: ${isVideo ? 'Video' : 'Image'} too large. Max ${isVideo ? '50MB' : '10MB'}.`);
        continue;
      }
      validFiles.push(file);
    }
    if (validFiles.length === 0) { e.target.value = ''; return; }
    const hasVideo = validFiles.some(f => f.type.startsWith('video/')) || mediaItems.some(m => m.type === 'video');
    const hasImage = validFiles.some(f => f.type.startsWith('image/')) || mediaItems.some(m => m.type === 'image');
    if (hasVideo && hasImage && validFiles.some(f => f.type.startsWith('video/')) && mediaItems.some(m => m.type === 'image')) {
      setGenerationError('Note: mixing image + video — LinkedIn will publish as single video (images ignored).');
    }
    let pending = validFiles.length;
    validFiles.forEach(file => {
      const isVideo = file.type.startsWith('video/');
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const item: MediaItem = { id: Date.now().toString(36) + Math.random().toString(36).slice(2,6), url: dataUrl, type: isVideo ? 'video' : 'image', name: file.name };
        setMediaItems(prev => {
          const next = [...prev, item];
          const first = next[0];
          if (first) {
            if (first.type === 'video') { setGeneratedVideo(first.url); setGeneratedImage(''); setMediaType('video'); }
            else { setGeneratedImage(first.url); setGeneratedVideo(''); setMediaType('image'); }
          }
          return next;
        });
        pending--;
        if (pending === 0) setGenerationError('');
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  // Topic reference handler — image only (Generate Content vision)
  const handleTopicUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (topicMediaItems.length + files.length > 4) {
      setGenerationError('Topic reference: max 4 images.');
      e.target.value = '';
      return;
    }
    const validFiles: File[] = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 10 * 1024 * 1024) {
        setGenerationError(`${file.name}: image too large. Max 10MB.`);
        continue;
      }
      validFiles.push(file);
    }
    if (validFiles.length === 0) { e.target.value = ''; return; }
    validFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const item: MediaItem = { id: Date.now().toString(36)+Math.random().toString(36).slice(2,6), url: dataUrl, type: 'image', name: file.name };
        setTopicMediaItems(prev => [...prev, item]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
    setGenerationError('');
  };

  const handleUploadVideo = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleUploadImage(e);
  };

  const removeMediaItem = (id: string) => {
    delete originalMediaRef.current[id];
    if (logoTargetId === id) setLogoTargetId(null);
    setBurnedLogoIds(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setMediaItems(prev => {
      const next = prev.filter(m => m.id !== id);
      if (next.length === 0) { setGeneratedImage(''); setGeneratedVideo(''); setMediaType(null); }
      else {
        const first = next[0];
        if (first.type === 'video') { setGeneratedVideo(first.url); setGeneratedImage(''); setMediaType('video'); }
        else { setGeneratedImage(first.url); setGeneratedVideo(''); setMediaType('image'); }
      }
      return next;
    });
  };

  const removeTopicMedia = (id: string) => {
    setTopicMediaItems(prev => prev.filter(m => m.id !== id));
  };

  const clearTopicMedia = () => setTopicMediaItems([]);
  const clearAllMedia = () => {
    originalMediaRef.current = {};
    setLogoTargetId(null);
    setBurnedLogoIds({});
    setMediaItems([]); setGeneratedImage(''); setGeneratedVideo(''); setMediaType(null);
  };

  // Burns reflect a fixed position/size/opacity — any change invalidates them,
  // so the preview overlay takes over again instead of showing a doubled logo.
  useEffect(() => {
    setBurnedLogoIds({});
  }, [logoPosition, logoScale, logoOpacity]);

  const getCompressedForAPI = (dataUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX = 1024;
        let w = img.width;
        let h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = dataUrl;
    });
  };

  const [dragOverTopic, setDragOverTopic] = useState(false);
  const [dragOverPreview, setDragOverPreview] = useState(false);
  const [logoDragOver, setLogoDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (files.length > 0) {
      // For preview drop we handle mediaItems; topic drop is handled separately via handleTopicDrop
      if (mediaItems.length + files.length > 9) {
        setGenerationError('You can attach up to 9 media files per post.');
      } else {
        files.forEach(file => {
          const isVideo = file.type.startsWith('video/');
          const maxSize = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
          if (file.size > maxSize) {
            setGenerationError(`${file.name}: ${isVideo ? 'Video' : 'Image'} too large.`);
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const item: MediaItem = { id: Date.now().toString(36)+Math.random().toString(36).slice(2,6), url: dataUrl, type: isVideo ? 'video' : 'image', name: file.name };
            setMediaItems(prev => {
              const next = [...prev, item];
              const first = next[0];
              if (first.type === 'video') { setGeneratedVideo(first.url); setGeneratedImage(''); setMediaType('video'); }
              else { setGeneratedImage(first.url); setGeneratedVideo(''); setMediaType('image'); }
              return next;
            });
          };
          reader.readAsDataURL(file);
        });
      }
    }
    setDragOverTopic(false);
    setDragOverPreview(false);
  };

  const handleTopicDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) { setTopicDragOver(false); return; }
    if (topicMediaItems.length + files.length > 4) {
      setGenerationError('Topic reference: max 4 images.');
      setTopicDragOver(false);
      return;
    }
    files.forEach(file => {
      if (file.size > 10*1024*1024) { setGenerationError(`${file.name}: too large`); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const item: MediaItem = { id: Date.now().toString(36)+Math.random().toString(36).slice(2,6), url: dataUrl, type: 'image', name: file.name };
        setTopicMediaItems(prev=>[...prev,item]);
      };
      reader.readAsDataURL(file);
    });
    setTopicDragOver(false);
    setDragOverTopic(false);
  };

  const handleMediaDragStart = (id: string) => setDraggedMediaId(id);
  const handleMediaDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (draggedMediaId && draggedMediaId !== id) setDragOverMediaId(id);
  };
  const handleMediaDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedMediaId || draggedMediaId === targetId) { setDraggedMediaId(null); setDragOverMediaId(null); return; }
    setMediaItems(prev => {
      const fromIdx = prev.findIndex(m => m.id === draggedMediaId);
      const toIdx = prev.findIndex(m => m.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      const first = next[0];
      if (first) {
        if (first.type === 'video') { setGeneratedVideo(first.url); setGeneratedImage(''); setMediaType('video'); }
        else { setGeneratedImage(first.url); setGeneratedVideo(''); setMediaType('image'); }
      }
      return next;
    });
    setDraggedMediaId(null);
    setDragOverMediaId(null);
  };
  const handleMediaDragEnd = () => { setDraggedMediaId(null); setDragOverMediaId(null); };
  const moveMedia = (id: string, dir: -1 | 1) => {
    setMediaItems(prev => {
      const idx = prev.findIndex(m => m.id === id);
      const nIdx = idx + dir;
      if (idx === -1 || nIdx < 0 || nIdx >= prev.length) return prev;
      const next = [...prev];
      const [m] = next.splice(idx, 1);
      next.splice(nIdx, 0, m);
      return next;
    });
  };

  // Logo handling — ffmpeg-style, respects selected aspectRatio
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!aspectRatio) { setGenerationError('Choose an aspect ratio first — logo will be sized for ' + (aspectRatio || 'selected ratio')); e.target.value=''; return; }
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) { setGenerationError('Logo must be an image (PNG with transparency recommended)'); return; }
    if (file.size > 5 * 1024 * 1024) { setGenerationError('Logo too large — max 5MB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setLogoImage(dataUrl);
      setGenerationError('');
      setLogoModalOpen(true);
      // Selecting a logo immediately applies it with the current defaults so
      // the upload visibly does something. Re-applying never stacks (burns
      // always start from the pre-logo original), and Adjust + Apply re-burns.
      if (mediaItems.length > 0 || generatedImage || generatedVideo) {
        setTimeout(() => applyLogoToAllMedia(dataUrl, { keepOpen: true }), 50);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleLogoDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLogoDragOver(false);
    const file = Array.from(e.dataTransfer.files || []).find(f => f.type.startsWith('image/'));
    if (!file) { setGenerationError('Logo must be an image (PNG with transparency recommended)'); return; }
    if (!aspectRatio) { setGenerationError('Choose an aspect ratio first — logo will be sized for selected ratio'); return; }
    if (file.size > 5 * 1024 * 1024) { setGenerationError('Logo too large — max 5MB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setLogoImage(dataUrl);
      setGenerationError('');
      if (mediaItems.length > 0 || generatedImage || generatedVideo) {
        setTimeout(() => applyLogoToAllMedia(dataUrl, { keepOpen: true }), 50);
      }
    };
    reader.readAsDataURL(file);
  };

  const getLogoPosition = (baseW: number, baseH: number, logoW: number, logoH: number, pos: string, pad = 12) => {
    switch (pos) {
      case 'top-left': return { x: pad, y: pad };
      case 'top-right': return { x: baseW - logoW - pad, y: pad };
      case 'bottom-left': return { x: pad, y: baseH - logoH - pad };
      case 'bottom-right': return { x: baseW - logoW - pad, y: baseH - logoH - pad };
      case 'center': return { x: (baseW - logoW) / 2, y: (baseH - logoH) / 2 };
      default: return { x: baseW - logoW - pad, y: baseH - logoH - pad };
    }
  };

  // Image loads with a timeout: a file that never finishes decoding (broken
  // bytes, exotic format) must reject instead of hanging the Apply button
  // in its loading state forever.
  const loadImageEl = (src: string, label: string, timeoutMs = 20000): Promise<HTMLImageElement> => {
    return new Promise((res, rej) => {
      const im = new Image();
      const timer = setTimeout(() => rej(new Error(`Timed out loading ${label} — try a PNG or JPG under 5MB`)), timeoutMs);
      im.onload = () => { clearTimeout(timer); res(im); };
      im.onerror = () => { clearTimeout(timer); rej(new Error(`Could not load ${label} — try a PNG or JPG under 5MB`)); };
      im.src = src;
    });
  };

  const applyLogoToAllMedia = async (logoOverride?: string, opts?: { keepOpen?: boolean }) => {
    // Guard: onClick passes its MouseEvent as the first arg when wired
    // directly - only a real dataURL string counts as an override.
    const logoSrc = typeof logoOverride === 'string' && logoOverride.startsWith('data:') ? logoOverride : logoImage;
    if (!aspectRatio) { setGenerationError('Choose an aspect ratio first — logo will be sized for that ratio'); return; }
    if (!logoSrc) { setGenerationError('Upload a logo first'); return; }
    if (mediaItems.length === 0 && !generatedImage && !generatedVideo) { setGenerationError('No image/video to apply logo to'); return; }
    setIsApplyingLogo(true);
    try {
      // For each mediaItem (or single generated), burn logo via canvas for images
      const logoImg = await loadImageEl(logoSrc, 'logo');
      const processOne = async (item: MediaItem): Promise<MediaItem> => {
        if (item.type === 'video') {
          // Video: burn via server ffmpeg (/api/ffmpeg/logo) — respects aspectRatio
          try {
            // Convert dataURL -> Blob for FormData to avoid JSON 4MB limit
            const toBlob = async (dataUrl: string) => {
              const res = await fetch(dataUrl);
              return await res.blob();
            };
            const videoBlob = await toBlob(item.url);
            const logoBlob = await toBlob(logoSrc);
            const form = new FormData();
            form.append('video', videoBlob, `video.${item.url.includes('video/webm') ? 'webm' : 'mp4'}`);
            form.append('logo', logoBlob, 'logo.png');
            form.append('position', logoPosition);
            form.append('scale', String(logoScale));
            form.append('opacity', String(logoOpacity));
            console.log(`[Logo] Burning video via /api/ffmpeg/logo ${logoPosition} scale ${logoScale} aspect ${aspectRatio}`);
            const res = await fetch('/api/ffmpeg/logo', { method: 'POST', body: form });
            const data = await res.json();
            if (res.ok && data.videoUrl) {
              console.log(`[Logo] Video burned ${Math.round((data.size||0)/1024)}KB`);
              return { ...item, url: data.videoUrl as string };
            } else {
              console.error('[Logo] ffmpeg video burn failed', data.error);
              setGenerationError(data.error || 'Video logo burn failed — showing preview overlay only (ffmpeg hold). Try smaller video.');
              return item;
            }
          } catch (e) {
            console.error('[Logo] video ffmpeg error', e);
            setGenerationError(e instanceof Error ? e.message : 'Video ffmpeg failed — preview only');
            return item;
          }
        }
        // Image: canvas composite
        const baseImg = await loadImageEl(item.url, 'image');
        const canvas = document.createElement('canvas');
        canvas.width = baseImg.naturalWidth || baseImg.width;
        canvas.height = baseImg.naturalHeight || baseImg.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);
        // Respect selected aspectRatio: scale relative to shorter side so logo looks consistent on 1:1 vs 16:9 vs 9:16
        const scaleBase = Math.min(canvas.width, canvas.height);
        const targetW = Math.round(scaleBase * logoScale * 1.45);
        // SVG logos often report 0 natural size (no intrinsic dimensions) -
        // without this guard targetH becomes NaN and drawImage silently draws
        // nothing while everything still reports success.
        const logoAspect = logoImg.naturalWidth > 0 && logoImg.naturalHeight > 0
          ? logoImg.naturalHeight / logoImg.naturalWidth
          : 1;
        const targetH = Math.round(targetW * logoAspect);
        const pad = Math.round(Math.min(canvas.width, canvas.height) * 0.025);
        const pos = getLogoPosition(canvas.width, canvas.height, targetW, targetH, logoPosition, pad);
        ctx.globalAlpha = logoOpacity;
        ctx.drawImage(logoImg, pos.x, pos.y, targetW, targetH);
        ctx.globalAlpha = 1;
        const newUrl = canvas.toDataURL('image/png');
        return { ...item, url: newUrl };
      };

      // Targets: single selected image when logoTargetId is set, otherwise all media.
      // Always burn from the ORIGINAL (pre-logo) bytes so re-applying never stacks logos.
      const fresh = (item: MediaItem): MediaItem => {
        const orig = originalMediaRef.current[item.id];
        return orig && orig !== item.url ? { ...item, url: orig } : item;
      };
      if (mediaItems.length) {
        const targets = logoTargetId ? mediaItems.filter(m => m.id === logoTargetId) : mediaItems;
        if (logoTargetId && targets.length === 0) {
          setGenerationError('Selected image no longer exists — pick it again.');
          setLogoTargetId(null);
          setIsApplyingLogo(false);
          return;
        }
        const burned = new Map<string, MediaItem>();
        for (const it of targets) {
          const out = await processOne(fresh(it));
          // Remember the pre-logo original on first burn
          if (!originalMediaRef.current[it.id]) originalMediaRef.current[it.id] = it.url;
          burned.set(it.id, out);
        }
        const newItems = mediaItems.map(m => burned.get(m.id) || m);
        setMediaItems(newItems);
        // Mark burned targets so preview overlay hides for them (no double logo)
        setBurnedLogoIds(prev => {
          const next = { ...prev };
          for (const id of burned.keys()) next[id] = true;
          return next;
        });
        const first = newItems[0];
        if (first?.type === 'video') { setGeneratedVideo(first.url); setGeneratedImage(''); setMediaType('video'); }
        else if (first) { setGeneratedImage(first.url); setGeneratedVideo(''); setMediaType('image'); }
        const done = targets.length;
        // Name the actual target(s) so "success" can't be mistaken for "all images".
        let scopeNote = '';
        if (logoTargetId) {
          const idx = mediaItems.findIndex(m => m.id === logoTargetId);
          scopeNote = idx >= 0 ? ` — ${idx === 0 ? '★ Cover' : `Image #${idx + 1}`} only` : '';
        } else if (done > 1) {
          scopeNote = ' — all images';
        }
        setPublishResult(`Logo applied to ${done} image${done === 1 ? '' : 's'}${scopeNote} at ${logoPosition} (${Math.round(logoScale * 100)}%)`);
      } else if (generatedImage) {
        const base: MediaItem = { id: 'gen', url: originalMediaRef.current['gen'] || generatedImage, type: 'image' };
        const out = await processOne(base);
        if (!originalMediaRef.current['gen']) originalMediaRef.current['gen'] = generatedImage;
        setGeneratedImage(out.url);
        const newId = Date.now().toString(36);
        setMediaItems([{ id: newId, url: out.url, type: 'image', name: 'with-logo' }]);
        setBurnedLogoIds(prev => ({ ...prev, [newId]: true }));
        setMediaType('image');
        setPublishResult(`Logo applied at ${logoPosition} (${Math.round(logoScale * 100)}%)`);
      } else if (generatedVideo) {
        // video preview overlay will be shown, no burn
        setGenerationError('Video logo overlay will appear in LinkedIn preview (burn via ffmpeg on publish).');
      }
      setPublishResultType('success'); setShowToast(true); setTimeout(()=>setShowToast(false), 4000);
      // Auto-apply (right after logo upload) keeps the dialog open on the
      // fresh result; a manual Apply press closes it as before.
      if (!opts?.keepOpen) setLogoModalOpen(false);
      setLogoTargetId(null);
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : 'Failed to apply logo');
    }
    setIsApplyingLogo(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const switchPreviewPlatform = (platform: string) => {
    setActivePreviewPlatform(platform);
    if (platformContent[platform]) {
      setContent(platformContent[platform].caption + '\n\n' + formatHashtags(platformContent[platform].hashtags || []));
    }
  };

  // Single-flight guard (ref, not state — blocks double-clicks before re-render).
  const publishingRef = useRef(false);
  // Post-publish cooldown in seconds. Publishing is blocked while > 0.
  const [publishCooldown, setPublishCooldown] = useState(0);
  useEffect(() => {
    if (publishCooldown <= 0) return;
    const timer = setTimeout(() => setPublishCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [publishCooldown]);

  const publishErrorText = (code?: string, fallback?: string) => {
    switch (code) {
      case 'LINKEDIN_NOT_CONNECTED':
        return 'LinkedIn is not connected. Reconnect through OAuth before publishing.';
      case 'LINKEDIN_AUTH_EXPIRED':
        return 'LinkedIn session expired (401). Please reconnect LinkedIn and try again.';
      case 'LINKEDIN_PERMISSION_DENIED':
        return 'LinkedIn denied permission (403). Check app scopes and try again.';
      case 'LINKEDIN_RATE_LIMIT':
        return 'LinkedIn rate limit (429). Please wait and try again manually — no automatic retry.';
      case 'LINKEDIN_MEDIA_UPLOAD_FAILED':
        return 'LinkedIn media upload failed. The post was NOT published (no text-only fallback).';
      case 'FACEBOOK_NOT_CONNECTED':
        return 'Facebook Page is not connected. Reconnect through OAuth before publishing.';
      case 'FACEBOOK_AUTH_EXPIRED':
        return 'Facebook Page session expired. Please reconnect Facebook and try again.';
      case 'FACEBOOK_PERMISSION_DENIED':
        return 'Facebook denied permission (403). Check the Page grant and app scopes, then try again.';
      case 'FACEBOOK_RATE_LIMIT':
        return 'Facebook rate limit (429). Please wait and try again manually — no automatic retry.';
      case 'FACEBOOK_MEDIA_UPLOAD_FAILED':
        return 'Facebook media upload failed. The post was NOT published (no text-only fallback).';
      case 'DUPLICATE_PUBLISH_REQUEST':
        return 'Duplicate ignored — this publish is already in flight.';
      case 'LINKEDIN_PUBLISH_FAILED':
      default:
        return fallback || 'Failed to publish to LinkedIn.';
    }
  };

  const publishToAll = async () => {
    // ONE USER ACTION = ONE PUBLISH REQUEST. Ref guard stops rapid
    // repeated clicks even before React re-renders the disabled button.
    if (publishingRef.current || isPublishing || publishCooldown > 0) return;
    const connectedSelected = selectedPlatforms.filter(p =>
      accounts.some(a => a.platform === p && a.connected)
    );
    if (connectedSelected.length === 0) {
      setPublishResult('No connected platforms selected');
      setPublishResultType('error');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 4000);
      return;
    }

    publishingRef.current = true;
    setIsPublishing(true);
    const results: string[] = [];
    let hasError = false;

    for (const platform of connectedSelected) {
      const account = accounts.find(a => a.platform === platform && a.connected);
      if (!account?.userId) {
        results.push(`${platform}: Not connected — reconnect through OAuth`);
        hasError = true;
        continue;
      }
      // platformContent captions are synced with Step-3 edits (see wizard),
      // so this is always the current edited caption — never a stale value.
      const platformData = platformContent[platform];
      const publishContent = platformData
        ? platformData.caption + '\n\n' + formatHashtags(platformData.hashtags || [])
        : content;
      // Unique id per user action + platform. Logged server-side, never a secret.
      const attemptId = `ui_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}_${platform}`;
      console.log(`[publish] attempt ${attemptId} → ${platform}`);
      try {
        const allUrls = publishMediaList.length ? publishMediaList.map(m => m.url) : (generatedVideo || generatedImage ? [generatedVideo || generatedImage] : []);
        const firstType = publishMediaList[0]?.type || (generatedVideo ? 'video' : generatedImage ? 'image' : undefined);
        // No access token leaves the browser — the server vault resolves it from userId.
        const res = await fetch(`/api/${platform}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: publishContent,
            imageUrl: generatedImage || undefined,
            videoUrl: generatedVideo || undefined,
            mediaUrl: generatedVideo || generatedImage || undefined,
            mediaType: firstType,
            mediaUrls: allUrls,
            mediaList: publishMediaList,
            userId: account.userId,
            pageId: account.pageId || undefined,
            attemptId,
          }),
        });
        // No automatic retry on any failure — the user decides.
        if (res.ok) {
          results.push(`${platform}: Success`);
        } else {
          const err = await res.json().catch(() => ({}));
          results.push(`${platform}: ${publishErrorText(err.code, err.message)}`);
          hasError = true;
        }
      } catch {
        results.push(`${platform}: Network error — no retry was attempted`);
        hasError = true;
      }
    }

    setPublishResult(results.join(' | '));
    setPublishResultType(hasError ? 'error' : 'success');
    setShowToast(true);
    publishingRef.current = false;
    setIsPublishing(false);
    if (!hasError) {
      setPublishSuccessFlash(true);
      // 10-second post-publish cooldown: no second request can be sent.
      setPublishResult('Post published successfully. You can publish again in 10 seconds.');
      setPublishCooldown(10);
      setTimeout(() => setPublishSuccessFlash(false), 2200);
    }
    setTimeout(() => setShowToast(false), 5000);
  };

  // Earliest moment a post may be scheduled for: now + 5 minutes.
  const minSchedulable = new Date(Date.now() + 5 * 60 * 1000);
  const minSchedulableDateStr = minSchedulable.toLocaleDateString('en-CA');
  const minSchedulableHour = minSchedulable.getHours();
  const minSchedulableMinute = minSchedulable.getMinutes();
  const isTimeRestrictedToday = scheduleDate === minSchedulableDateStr;
  const [selectedHour, selectedMinute] = scheduleTime
    ? scheduleTime.split(':').map(Number)
    : [minSchedulableHour, minSchedulableMinute];
  const commitTime = (hour: number, minute: number) => {
    setScheduleTime(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  };

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;

  const pendingPosts = allPosts.filter(p => p.status === 'pending').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const publishedPosts = allPosts.filter(p => p.status === 'published');
  const failedPosts = allPosts.filter(p => p.status === 'failed');
  const cancelledPosts = allPosts.filter(p => p.status === 'cancelled');
  const attemptedCount = publishedPosts.length + failedPosts.length;
  const successRate = attemptedCount > 0 ? Math.round((publishedPosts.length / attemptedCount) * 100) : null;
  const platformCounts: Record<string, number> = {};
  allPosts.forEach(p => p.platforms.forEach(pl => { platformCounts[pl] = (platformCounts[pl] || 0) + 1; }));
  const maxPlatformCount = Math.max(1, ...Object.values(platformCounts));

  const statusMeta: Record<string, { bg: string; color: string; label: string }> = {
    pending: { bg: '#fffbeb', color: '#b45309', label: 'Pending' },
    published: { bg: '#ecfdf5', color: '#059669', label: 'Published' },
    failed: { bg: '#fef2f2', color: '#dc2626', label: 'Failed' },
    cancelled: { bg: '#f1f5f9', color: '#64748b', label: 'Cancelled' },
  };

  const topBarInfo: Record<string, { title: string; subtitle: string }> = {
    dashboard: { title: 'Dashboard', subtitle: 'Your content overview at a glance' },
    studio: { title: 'Content Studio', subtitle: 'Turn your ideas into impactful social media content with AI' },
    scheduler: { title: 'Scheduler', subtitle: 'Manage upcoming and past scheduled posts' },
    analytics: { title: 'Analytics', subtitle: 'Track your publishing performance' },
    media: { title: 'Media Library', subtitle: 'All uploaded and generated media in one place' },
    drafts: { title: 'Drafts', subtitle: 'Continue where you left off' },
  };

  const filteredSchedulerPosts = (schedulerFilter === 'all' ? allPosts : allPosts.filter(p => p.status === schedulerFilter))
    .slice()
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));

  // Week-calendar data for Scheduler > Pending
  const calendarDays = Array.from({ length: 7 }, (_, i) => addDaysLocal(calendarWeekStart, i));
  const todayKey = localDateKey(new Date());
  const postsByDay: Record<string, typeof pendingPosts> = {};
  pendingPosts.forEach(p => {
    const key = localDateKey(new Date(p.scheduledAt));
    if (!postsByDay[key]) postsByDay[key] = [];
    postsByDay[key].push(p);
  });
  const weekStartLabel = calendarDays[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const weekEndSameMonth = calendarDays[0].getMonth() === calendarDays[6].getMonth();
  const weekEndLabel = calendarDays[6].toLocaleDateString('en-US', weekEndSameMonth ? { day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  const weekRangeLabel = `${weekStartLabel} - ${weekEndLabel}`;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif', backgroundColor: '#F7F8FC' }}>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideInRight { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes overlayIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes modalPopIn { from { opacity: 0; transform: translateY(12px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes connectPulseRing { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,0.55); } 70% { box-shadow: 0 0 0 14px rgba(16,185,129,0); } 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); } }
        @keyframes connectRowFlash { 0% { background-color: rgba(16,185,129,0.14); } 100% { background-color: transparent; } }
        @keyframes connectCheckPop { 0% { transform: scale(0) rotate(-20deg); opacity: 0; } 55% { transform: scale(1.3) rotate(6deg); opacity: 1; } 100% { transform: scale(1) rotate(0deg); opacity: 1; } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        textarea:focus, select:focus, input:focus { border-color: #6366f1 !important; box-shadow: 0 0 0 3px rgba(99,102,241,0.12) !important; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #f1f5f9; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      `}</style>

      {/* Sidebar - collapsible slidebar */}
      <aside style={{ width: sidebarCollapsed ? '72px' : '248px', backgroundColor: '#0f172a', color: '#fff', display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'fixed', height: '100vh', zIndex: 10, boxShadow: '4px 0 24px rgba(0,0,0,0.15)', transition: 'width 0.3s cubic-bezier(0.4,0,0.2,1)', overflow: 'hidden', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#334155 transparent' }}>
        <div style={{ padding: sidebarCollapsed ? '20px 12px' : '24px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: '12px', justifyContent: sidebarCollapsed ? 'center' : 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #6366f1, #a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 700, flexShrink: 0 }}>SP</div>
            {!sidebarCollapsed && (
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>SocialPulse</div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px', whiteSpace: 'nowrap' }}>Content Manager</div>
              </div>
            )}
          </div>
          <button
            onClick={() => setSidebarCollapsed(v => !v)}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{ width: '28px', height: '28px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.06)', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', flexShrink: 0, transition: 'all 0.2s' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#94a3b8'; }}
          >
            {sidebarCollapsed ? '›' : '‹'}
          </button>
        </div>

        <nav style={{ flex: 1, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: '2px', overflowY: 'auto' }}>
          {!sidebarCollapsed && <div style={{ padding: '0 16px', marginBottom: '10px', fontSize: '10px', fontWeight: 600, color: '#475569', textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>Main</div>}
          {[
            { icon: '📊', label: 'Dashboard', tab: 'dashboard' as const },
            { icon: '✏️', label: 'Content Studio', tab: 'studio' as const },
            { icon: '📅', label: 'Scheduler', tab: 'scheduler' as const },
            { icon: '📈', label: 'Analytics', tab: 'analytics' as const },
            { icon: '🖼️', label: 'Media Library', tab: 'media' as const },
            { icon: '📝', label: 'Drafts', tab: 'drafts' as const },
          ].map(item => {
            const active = activeTab === item.tab;
            const isStudio = item.tab === 'studio';
            return (
              <button
                key={item.label}
                onClick={() => setActiveTab(item.tab)}
                title={sidebarCollapsed ? item.label : undefined}
                style={{
                  padding: sidebarCollapsed ? '12px' : '10px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: active ? 700 : 500,
                  color: active ? '#fff' : '#94a3b8',
                  cursor: 'pointer', border: 'none',
                  background: active && isStudio ? 'linear-gradient(135deg, #7C3AED, #8B5CF6)' : active ? 'rgba(124,58,237,0.18)' : 'transparent',
                  boxShadow: active && isStudio ? '0 3px 12px rgba(124,58,237,0.35)' : 'none',
                  display: 'flex', alignItems: 'center', gap: sidebarCollapsed ? '0' : '12px', width: '100%', textAlign: 'left', justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                  fontFamily: 'inherit', transition: 'all 0.2s',
                }}
                onMouseEnter={e => { if (!active) { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#e2e8f0'; } }}
                onMouseLeave={e => { if (!active) { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#94a3b8'; } }}
              >
                <span style={{ fontSize: '16px' }}>{item.icon}</span> {!sidebarCollapsed && item.label}
              </button>
            );
          })}
        </nav>

        <div style={{ padding: sidebarCollapsed ? '12px 8px' : '16px 20px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: sidebarCollapsed ? 'center' : 'flex-start' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 600, flexShrink: 0 }}>A</div>
            {!sidebarCollapsed && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 500, whiteSpace: 'nowrap' }}>Admin</div>
                <div style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap' }}>Free Plan</div>
              </div>
            )}
          </div>
          {!sidebarCollapsed && <div style={{ marginTop: '12px', padding: '14px 12px', borderRadius: '12px', background: 'linear-gradient(135deg, #7C3AED, #8B5CF6)', display: 'flex', flexDirection: 'column', gap: '4px', boxShadow: '0 4px 14px rgba(124,58,237,0.3)' }}>
            <span style={{ fontSize: '10px', fontWeight: 800, color: 'rgba(255,255,255,0.75)', letterSpacing: '0.08em' }}>AI-POWERED</span>
            <span style={{ fontSize: '13px', fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>Social Media<br />Made Simple</span>
            <button onClick={() => setActiveTab('studio')} style={{ marginTop: '8px', padding: '8px 10px', borderRadius: '8px', border: 'none', backgroundColor: 'rgba(255,255,255,0.18)', color: '#fff', fontSize: '11px', fontWeight: 700, cursor: 'pointer', borderWidth: 0 }}>Try Studio →</button>
          </div>}
        </div>
      </aside>

      {/* Mobile overlay when sidebar expanded on small screens */}
      {!sidebarCollapsed && (
        <div onClick={() => setSidebarCollapsed(true)} style={{ display: 'none' }} className="sidebar-overlay" />
      )}

      {/* Main Content */}
      <div style={{ flex: 1, marginLeft: sidebarCollapsed ? '72px' : '248px', display: 'flex', flexDirection: 'column', minHeight: '100vh', transition: 'margin-left 0.3s cubic-bezier(0.4,0,0.2,1)', backgroundColor: '#f8fafc' }}>
        {/* Top Bar — professional white header */}
        <header style={{
          height: '64px', backgroundColor: '#ffffff',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px 0 28px',
          borderBottom: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(15,23,42,0.06)', position: 'sticky', top: 0, zIndex: 5,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button onClick={() => setSidebarCollapsed(v => !v)} style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', transition: 'all 0.2s' }} title="Toggle sidebar">
              ☰
            </button>
            <div style={{ width: '1px', height: '24px', backgroundColor: '#e2e8f0' }} />
            <div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.015em', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981', display: 'inline-block', boxShadow: '0 0 0 3px rgba(16,185,129,0.15)' }} />
                {topBarInfo[activeTab].title}
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '1px', fontWeight: 400 }}>{topBarInfo[activeTab].subtitle}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {activeTab === 'studio' && (
              <span style={{ fontSize: 11, fontWeight: 700, color: '#6D28D9', backgroundColor: '#F1EBFF', border: '1px solid #C4B5FD', padding: '6px 12px', borderRadius: 999, whiteSpace: 'nowrap' }}>Create. Brand. Schedule. Grow.</span>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '999px', padding: '6px 14px' }}>
              <span style={{ fontSize: '12px', color: '#64748b' }}>●</span>
              <span style={{ fontSize: '12px', color: '#334155', fontWeight: 500 }}>{accounts.length ? `${accounts.length} platform${accounts.length!==1?'s':''} connected` : 'No platform connected'}</span>
            </div>
            <div style={{ width: '1px', height: '24px', backgroundColor: '#e2e8f0' }} />
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap' }}>{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
            <div style={{ position: 'relative' }}>
              <button style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: '#fff', border: '1px solid #e2e8f0', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>🔔</button>
              {pendingPosts.length > 0 && <span style={{ position: 'absolute', top: '-4px', right: '-4px', width: '16px', height: '16px', borderRadius: '50%', backgroundColor: '#ef4444', color: '#fff', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff' }}>{pendingPosts.length}</span>}
            </div>
            <div style={{
              width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: '1px solid #e2e8f0',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px',
              fontWeight: 700, color: '#fff', cursor: 'pointer', boxShadow: '0 1px 3px rgba(99,102,241,0.2)',
            }}>A</div>
          </div>
        </header>

        {/* Content Studio — SaaS redesign (UI-only, logic preserved) */}
        {activeTab === 'studio' && (
          <StudioWorkspace
            prompt={prompt} setPrompt={setPrompt}
            topicMediaItems={topicMediaItems} removeTopicMedia={removeTopicMedia} clearTopicMedia={clearTopicMedia}
            topicFileInputRef={topicFileInputRef} handleTopicUpload={handleTopicUpload} handleTopicDrop={handleTopicDrop}
            topicDragOver={topicDragOver} setTopicDragOver={setTopicDragOver}
            dragOverTopic={dragOverTopic} setDragOverTopic={setDragOverTopic} handleDragOver={handleDragOver}
            tone={tone} setTone={setTone}
            imageStyle={imageStyle} setImageStyle={setImageStyle}
            aspectRatio={aspectRatio} setAspectRatio={setAspectRatio} aspectRatioMap={aspectRatioMap}
            generateContent={generateContent} isGeneratingContent={isGeneratingContent}
            generateImage={generateImage} isGeneratingImage={isGeneratingImage}
            varyImageFromUrl={varyImageFromUrl} varyingImageUrl={varyingImageUrl}
            selectedPlatforms={selectedPlatforms}
            content={content} setContent={setContent}
            statusMessage={statusMessage}
            generationError={generationError} setGenerationError={setGenerationError}
            platformContent={platformContent} setPlatformContent={setPlatformContent} activePreviewPlatform={activePreviewPlatform} switchPreviewPlatform={switchPreviewPlatform}
            editorTab={editorTab} setEditorTab={setEditorTab}
            imagePrompt={imagePrompt}
            charCount={charCount} wordCount={wordCount}
            mediaItems={mediaItems}
            removeMediaItem={removeMediaItem} clearAllMedia={clearAllMedia} moveMedia={moveMedia}
            handleUploadImage={handleUploadImage} handleDrop={handleDrop}
            handleMediaDragStart={handleMediaDragStart} handleMediaDragOver={handleMediaDragOver} handleMediaDrop={handleMediaDrop} handleMediaDragEnd={handleMediaDragEnd}
            draggedMediaId={draggedMediaId} dragOverMediaId={dragOverMediaId}
            dragOverPreview={dragOverPreview} setDragOverPreview={setDragOverPreview}
            fileInputRef={fileInputRef}
            generatedImage={generatedImage} generatedVideo={generatedVideo}
            logoImage={logoImage} logoPosition={logoPosition} logoScale={logoScale} logoOpacity={logoOpacity}
            setLogoModalOpen={setLogoModalOpen} logoInputRef={logoInputRef}
            logoTargetId={logoTargetId} setLogoTargetId={setLogoTargetId}
            burnedLogoIds={burnedLogoIds}
            applyLogoToAllMedia={applyLogoToAllMedia} isApplyingLogo={isApplyingLogo}
            accounts={accounts} togglePlatform={togglePlatform} connectPlatform={connectPlatform} disconnectPlatform={disconnectPlatform}
            setAccountPageId={setAccountPageId}
            justConnectedPlatform={justConnectedPlatform}
            canvaConnected={canvaConnected} canvaName={canvaName} canvaSourceImage={canvaSourceImage}
            openInCanva={openInCanva} isSendingToCanva={isSendingToCanva}
            createInCanva={createInCanva} isCreatingInCanva={isCreatingInCanva}
            canvaReadyId={canvaReadyId} importFromCanva={importFromCanva} isImportingFromCanva={isImportingFromCanva}
            disconnectCanva={disconnectCanva}
            publishToAll={publishToAll} isPublishing={isPublishing} publishSuccessFlash={publishSuccessFlash}
            publishCooldown={publishCooldown}
            hoveredBtn={hoveredBtn} setHoveredBtn={setHoveredBtn}
            setScheduleModalOpen={setScheduleModalOpen}
            pendingPosts={pendingPosts}
            publishResult={publishResult} setPublishResult={setPublishResult}
            setPublishResultType={setPublishResultType} setShowToast={setShowToast}
            platformColors={platformColors} PlatformIcon={PlatformIcon}
          />
        )}

        {/* Media Library (UI-only view over existing mediaItems + post media) */}
        {activeTab === 'media' && (
          <div style={{ padding: 24, flex: 1, display: 'flex', flexDirection: 'column', gap: 16, backgroundColor: '#F7F8FC' }}>
            <div style={{ backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E8EAF1', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: 9, background: 'linear-gradient(135deg,#7C3AED,#8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🖼️</div>
              <div><div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>Media Library</div><div style={{ fontSize: 11, color: '#64748B' }}>{mediaItems.length} session files • {allPosts.filter(p => getPostMedia(p as never).count! > 0).length} posts with media</div></div>
              <button onClick={() => { setActiveTab('studio'); }} style={{ marginLeft: 'auto', padding: '9px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, border: 'none', background: 'linear-gradient(135deg,#7C3AED,#8B5CF6)', color: '#fff', cursor: 'pointer' }}>Open Studio →</button>
            </div>
            <div style={{ backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E8EAF1', padding: 18 }}>
              {mediaItems.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#94A3B8', fontSize: 12, padding: 32 }}>No session media yet — upload in Content Studio.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
                  {mediaItems.map(m => (
                    <div key={m.id} style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid #E8EAF1', aspectRatio: '1', backgroundColor: '#000' }}>
                      {m.type === 'video' ? <video src={m.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted /> : <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Drafts (UI-only, localStorage, no backend change) */}
        {activeTab === 'drafts' && (
          <div style={{ padding: 24, flex: 1, display: 'flex', flexDirection: 'column', gap: 16, backgroundColor: '#F7F8FC' }}>
            <div style={{ backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E8EAF1', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: 9, background: 'linear-gradient(135deg,#0F172A,#334155)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#fff' }}>📝</div>
              <div><div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>Drafts</div><div style={{ fontSize: 11, color: '#64748B' }}>Saved locally via Save Draft in Studio</div></div>
              <button onClick={() => setActiveTab('studio')} style={{ marginLeft: 'auto', padding: '9px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, border: '1px solid #E8EAF1', background: '#fff', color: '#0F172A', cursor: 'pointer' }}>Back to Studio</button>
            </div>
            <div style={{ backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E8EAF1', padding: 18 }}>
              {(() => {
                let drafts: Array<{ content: string; prompt: string; savedAt: string }> = [];
                try { drafts = JSON.parse(localStorage.getItem('socialDrafts') || '[]'); } catch { drafts = []; }
                if (!drafts.length) return <div style={{ textAlign: 'center', color: '#94A3B8', fontSize: 12, padding: 32 }}>No drafts yet — use Save Draft in the Studio action bar.</div>;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {drafts.slice().reverse().map((d, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid #F1F3F9', borderRadius: 10, backgroundColor: '#FCFCFE' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(d.content || d.prompt || 'Untitled draft').slice(0, 90)}</div>
                          <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>{new Date(d.savedAt).toLocaleString()}</div>
                        </div>
                        <button onClick={() => { setContent(d.content || ''); setPrompt(d.prompt || ''); setActiveTab('studio'); }} style={{ padding: '7px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, border: 'none', background: 'linear-gradient(135deg,#7C3AED,#8B5CF6)', color: '#fff', cursor: 'pointer' }}>Restore</button>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* Dashboard — PROFESSIONAL */}
        {activeTab === 'dashboard' && (
          <div style={{ padding: '24px 32px', flex: 1, display: 'flex', flexDirection: 'column', gap: '24px', backgroundColor: '#f8fafc' }}>
            {/* Welcome banner */}
            <div style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #334155 100%)', borderRadius: '16px', padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff', position: 'relative', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 4px 24px rgba(15,23,42,0.15)' }}>
              <div style={{ position: 'absolute', right: '-20px', top: '-30px', width: '220px', height: '220px', background: 'radial-gradient(circle at center, rgba(99,102,241,0.25), transparent 70%)', pointerEvents: 'none' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', position: 'relative' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', boxShadow: '0 4px 12px rgba(99,102,241,0.3)', flexShrink: 0 }}>👋</div>
                <div>
                  <div style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '-0.015em' }}>Welcome back, Admin</div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>Here’s what’s happening with your content today • {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', position: 'relative' }}>
                <button onClick={() => setActiveTab('studio')} style={{ padding: '10px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, border: 'none', backgroundColor: '#fff', color: '#0f172a', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: '8px' }}>✏️ Create Post</button>
                <button onClick={() => setActiveTab('scheduler')} style={{ padding: '10px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, border: '1px solid rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.08)', color: '#fff', cursor: 'pointer', backdropFilter: 'blur(6px)' }}>View Schedule →</button>
              </div>
            </div>

            {/* KPI cards — professional */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
              {[
                { label: 'Connected Accounts', value: accounts.length, sub: `${accounts.length ? 'Active' : 'No connections'}`, icon: '👥', grad: 'linear-gradient(135deg, #6366f1, #818cf8)', bg: '#eef2ff', color: '#4338ca', trend: accounts.length ? '+ linked' : '—' },
                { label: 'Pending Queue', value: pendingPosts.length, sub: pendingPosts.length ? 'Awaiting publish' : 'Queue empty', icon: '⏳', grad: 'linear-gradient(135deg, #f59e0b, #fbbf24)', bg: '#fffbeb', color: '#92400e', trend: pendingPosts.length ? '• due soon' : '—' },
                { label: 'Published', value: publishedPosts.length, sub: successRate !== null ? `${successRate}% success rate` : 'No attempts yet', icon: '✓', grad: 'linear-gradient(135deg, #10b981, #34d399)', bg: '#ecfdf5', color: '#065f46', trend: publishedPosts.length ? '↗ live' : '—' },
                { label: 'Failed / Cancelled', value: failedPosts.length + cancelledPosts.length, sub: failedPosts.length ? 'Needs attention' : 'All clear', icon: '⚡', grad: failedPosts.length ? 'linear-gradient(135deg, #ef4444, #f87171)' : 'linear-gradient(135deg, #64748b, #94a3b8)', bg: failedPosts.length ? '#fef2f2' : '#f1f5f9', color: failedPosts.length ? '#991b1b' : '#475569', trend: failedPosts.length ? '• review' : '—' },
              ].map(tile => (
                <div key={tile.label} style={{ backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '18px 20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 0, right: 0, width: '80px', height: '80px', background: `radial-gradient(circle at 30% 30%, ${tile.color}0D, transparent 70%)`, pointerEvents: 'none' }} />
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '14px' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: tile.grad, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '16px', fontWeight: 700, boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>{tile.icon}</div>
                    <span style={{ fontSize: '11px', fontWeight: 600, padding: '4px 8px', borderRadius: '999px', backgroundColor: tile.bg, color: tile.color, border: `1px solid ${tile.color}18` }}>{tile.trend}</span>
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', letterSpacing: '0.04em', textTransform: 'uppercase' as const }}>{tile.label}</div>
                  <div style={{ fontSize: '30px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.03em', lineHeight: 1, marginTop: '6px' }}>{tile.value}</div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '6px', fontWeight: 500 }}>{tile.sub}</div>
                </div>
              ))}
            </div>

            {/* Middle: chart + side stack */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.9fr 360px', gap: '24px', alignItems: 'start' }}>
              {/* Performance chart */}
              <div style={{ backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(15,23,42,0.06)', overflow: 'hidden' }}>
                <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '8px', backgroundColor: '#eef2ff', color: '#4338ca', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>📊</div>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>Publishing Activity</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>Last 7 days • {allPosts.length} total posts</div>
                    </div>
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: 600, padding: '6px 10px', borderRadius: '999px', backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0' }}>{successRate !== null ? `${successRate}% delivered` : 'No data'}</span>
                </div>
                <div style={{ padding: '22px 22px 18px' }}>
                  {(() => {
                    const days = Array.from({ length: 7 }, (_, i) => {
                      const d = addDaysLocal(new Date(), -6 + i);
                      const key = localDateKey(d);
                      const count = allPosts.filter(p => localDateKey(new Date(p.createdAt || p.scheduledAt)) === key).length;
                      return { label: d.toLocaleDateString('en-US', { weekday: 'short' }), key, count, isToday: key === todayKey };
                    });
                    const max = Math.max(1, ...days.map(d => d.count));
                    return (
                      <div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '10px', alignItems: 'end', height: '110px' }}>
                          {days.map(d => (
                            <div key={d.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                                {d.count > 0 && <span style={{ fontSize: '10px', fontWeight: 700, color: '#4338ca' }}>{d.count}</span>}
                                <div style={{ width: '100%', height: `${12 + (d.count / max) * 72}px`, borderRadius: '8px', background: d.isToday ? 'linear-gradient(180deg, #6366f1, #818cf8)' : d.count ? 'linear-gradient(180deg, #e0e7ff, #c7d2fe)' : '#f1f5f9', border: d.isToday ? '1px solid #6366f1' : d.count ? '1px solid #c7d2fe' : '1px solid #e2e8f0', boxShadow: d.isToday ? '0 2px 8px rgba(99,102,241,0.25)' : 'none', transition: 'height 0.3s' }} />
                              </div>
                              <span style={{ fontSize: '11px', fontWeight: d.isToday ? 700 : 500, color: d.isToday ? '#4338ca' : '#64748b' }}>{d.label}</span>
                            </div>
                          ))}
                        </div>
                        <div style={{ marginTop: '16px', padding: '12px', borderRadius: '10px', backgroundColor: '#f8fafc', border: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>Today • {days[6].count} posts • {pendingPosts.length} in queue</span>
                          <span style={{ fontSize: '11px', color: '#4338ca', fontWeight: 600, cursor: 'pointer' }} onClick={() => setActiveTab('scheduler')}>Open scheduler →</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Side: quick actions + platforms */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(15,23,42,0.06)', overflow: 'hidden' }}>
                  <div style={{ padding: '16px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '28px', height: '28px', borderRadius: '8px', backgroundColor: '#fffbeb', color: '#92400e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', border: '1px solid #fde68a' }}>⚡</div>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>Quick Actions</span>
                    </div>
                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px', backgroundColor: '#f1f5f9', color: '#64748b' }}>{accounts.length ? 'Ready' : 'Setup'}</span>
                  </div>
                  <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <button onClick={() => setActiveTab('studio')} style={{ padding: '12px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: 700, border: 'none', background: 'linear-gradient(135deg, #0f172a, #1e293b)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 2px 10px rgba(15,23,42,0.15)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><span style={{ width: '28px', height: '28px', borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✏️</span> New Post</span>
                      <span>→</span>
                    </button>
                    <button onClick={() => setActiveTab('scheduler')} style={{ padding: '11px 14px', borderRadius: '10px', fontSize: '12px', fontWeight: 600, border: '1px solid #e2e8f0', backgroundColor: '#fff', color: '#334155', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left' as const }}>
                      <span style={{ width: '28px', height: '28px', borderRadius: '8px', backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📅</span> View Scheduler <span style={{ marginLeft: 'auto', fontSize: '10px', backgroundColor: '#eef2ff', color: '#4338ca', padding: '2px 7px', borderRadius: '999px', fontWeight: 700 }}>{pendingPosts.length} pending</span>
                    </button>
                    <button onClick={() => setActiveTab('analytics')} style={{ padding: '11px 14px', borderRadius: '10px', fontSize: '12px', fontWeight: 600, border: '1px solid #e2e8f0', backgroundColor: '#fff', color: '#334155', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left' as const }}>
                      <span style={{ width: '28px', height: '28px', borderRadius: '8px', backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📈</span> View Analytics
                    </button>
                  </div>
                </div>

                <div style={{ backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(15,23,42,0.06)', overflow: 'hidden' }}>
                  <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ width: '28px', height: '28px', borderRadius: '8px', backgroundColor: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}>🌐</span> Platform Health</span>
                    <span style={{ fontSize: '11px', color: accounts.length ? '#10b981' : '#94a3b8', fontWeight: 700 }}>{accounts.length}/4 connected</span>
                  </div>
                  <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {['linkedin', 'instagram', 'facebook', 'twitter'].map(platform => {
                      const isConnected = accounts.some(a => a.platform === platform && a.connected);
                      const justConnected = justConnectedPlatform === platform;
                      return (
                        <div key={platform} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 10px', borderRadius: '10px', backgroundColor: isConnected ? '#f8fafc' : 'transparent', border: `1px solid ${isConnected ? '#e2e8f0' : 'transparent'}`, animation: justConnected ? 'connectRowFlash 1.8s ease-out' : 'none' }}>
                          <div style={{ width: '32px', height: '32px', borderRadius: '10px', backgroundColor: platformColors[platform], color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, boxShadow: isConnected ? '0 2px 8px rgba(0,0,0,0.12)' : 'none', opacity: isConnected ? 1 : 0.45 }}>
                            <PlatformIcon platform={platform} size={14} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a', textTransform: 'capitalize' as const }}>{platform}</div>
                            <div style={{ fontSize: '11px', color: isConnected ? '#059669' : '#94a3b8', fontWeight: 500 }}>{isConnected ? 'Connected • ready to publish' : 'Not connected'}</div>
                          </div>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: isConnected ? '#10b981' : '#cbd5e1', boxShadow: isConnected ? '0 0 0 3px rgba(16,185,129,0.15)' : 'none', flexShrink: 0 }} />
                        </div>
                      );
                    })}
                    <div style={{ marginTop: '6px', padding: '10px 12px', borderRadius: '10px', backgroundColor: '#f8fafc', border: '1px dashed #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>{accounts.length ? 'All set for publishing' : 'Connect LinkedIn to start'}</span>
                      {!accounts.length && <button onClick={() => setActiveTab('studio')} style={{ fontSize: '11px', fontWeight: 700, color: '#4338ca', background: 'none', border: 'none', cursor: 'pointer' }}>Connect →</button>}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent activity — table style */}
            <div style={{ backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(15,23,42,0.06)', overflow: 'hidden' }}>
              <div style={{ padding: '16px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '8px', backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', border: '1px solid #e2e8f0' }}>🕓</div>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>Recent Activity</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>{allPosts.length} total • {publishedPosts.length} delivered</div>
                  </div>
                </div>
                <button onClick={() => setActiveTab('scheduler')} style={{ fontSize: '12px', fontWeight: 600, color: '#4338ca', backgroundColor: '#eef2ff', border: '1px solid #c7d2fe', padding: '7px 12px', borderRadius: '8px', cursor: 'pointer' }}>View all →</button>
              </div>
              <div style={{ overflowX: 'auto' as const }}>
                {allPosts.length === 0 ? (
                  <div style={{ padding: '48px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '56px', height: '56px', borderRadius: '16px', backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>📄</div>
                    <div style={{ textAlign: 'center' as const }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>No posts yet</div>
                      <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>Create your first AI-powered post in Studio</div>
                    </div>
                    <button onClick={() => setActiveTab('studio')} style={{ marginTop: '4px', padding: '10px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 700, border: 'none', background: 'linear-gradient(135deg, #0f172a, #1e293b)', color: '#fff', cursor: 'pointer', boxShadow: '0 2px 10px rgba(15,23,42,0.15)' }}>Create your first post →</button>
                  </div>
                ) : (
                  <div style={{ minWidth: '640px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 110px', gap: '12px', padding: '10px 22px', backgroundColor: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>Post</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>Schedule</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', letterSpacing: '0.05em', textTransform: 'uppercase' as const, textAlign: 'right' as const }}>Status</span>
                    </div>
                    {allPosts.slice().sort((a, b) => (b.createdAt || b.scheduledAt).localeCompare(a.createdAt || a.scheduledAt)).slice(0, 5).map(post => {
                      const meta = statusMeta[post.status] || statusMeta.pending;
                      const m = getPostMedia(post as unknown as never);
                      return (
                        <div key={post.id} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 110px', gap: '12px', padding: '14px 22px', borderBottom: '1px solid #f8fafc', alignItems: 'center' }}>
                          <div style={{ display: 'flex', gap: '12px', minWidth: 0, alignItems: 'center' }}>
                            <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {m.url ? (m.isVideo ? <video src={m.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted /> : <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />) : <span style={{ fontSize: '14px' }}>📄</span>}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{post.content.split('\n')[0].substring(0, 72)}</div>
                              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                                <span>{post.platforms.map(p => p).join(', ')}</span>
                                <span style={{ width: '3px', height: '3px', borderRadius: '50%', backgroundColor: '#cbd5e1' }} />
                                <span>{new Date(post.scheduledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                {m.count! >1 && <span style={{ fontSize: '10px', backgroundColor: '#f1f5f9', padding: '1px 6px', borderRadius: '999px', fontWeight: 600 }}>{m.count} media</span>}
                              </div>
                            </div>
                          </div>
                          <div style={{ fontSize: '12px', color: '#334155', fontWeight: 500 }}>{new Date(post.scheduledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                          <div style={{ textAlign: 'right' as const }}>
                            <span style={{ fontSize: '10px', fontWeight: 700, padding: '5px 10px', borderRadius: '999px', backgroundColor: meta.bg, color: meta.color, border: `1px solid ${meta.color}18`, letterSpacing: '0.03em', textTransform: 'uppercase' as const }}>{meta.label}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Scheduler */}
        {activeTab === 'scheduler' && (
          <div style={{ padding: '24px 32px', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' as const, alignItems: 'center' }}>
              {([
                { key: 'all', label: 'All', count: allPosts.length },
                { key: 'pending', label: 'Pending', count: pendingPosts.length },
                { key: 'published', label: 'Published', count: publishedPosts.length },
                { key: 'failed', label: 'Failed', count: failedPosts.length },
                { key: 'cancelled', label: 'Cancelled', count: cancelledPosts.length },
              ] as const).map(f => {
                const active = schedulerFilter === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => setSchedulerFilter(f.key)}
                    style={{
                      padding: '8px 16px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
                      border: active ? '2px solid #6366f1' : '2px solid #e2e8f0',
                      backgroundColor: active ? '#eef2ff' : '#fff', color: active ? '#6366f1' : '#64748b',
                      cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s',
                    }}
                  >
                    {f.label} <span style={{ opacity: 0.7 }}>({f.count})</span>
                  </button>
                );
              })}
              <button
                onClick={checkDuePosts}
                disabled={isCheckingDue}
                title="Publish all due scheduled posts now"
                style={{
                  marginLeft: 'auto', padding: '8px 16px', borderRadius: '999px', fontSize: '12px', fontWeight: 700,
                  border: 'none', background: 'linear-gradient(135deg, #7C3AED, #8B5CF6)', color: '#fff',
                  cursor: isCheckingDue ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                  boxShadow: '0 2px 8px rgba(124,58,237,0.3)', opacity: isCheckingDue ? 0.7 : 1,
                }}
              >
                {isCheckingDue ? 'Checking…' : '▶ Check now — publish due'}
              </button>
            </div>

            {schedulerFilter === 'pending' ? (
              <div style={{ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                {/* Calendar header */}
                <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      onClick={() => setCalendarWeekStart(w => addDaysLocal(w, -7))}
                      style={{ width: '28px', height: '28px', borderRadius: '50%', border: 'none', backgroundColor: '#f1f5f9', color: '#475569', cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit' }}
                    >‹</button>
                    <button
                      onClick={() => setCalendarWeekStart(startOfWeekLocal(new Date()))}
                      style={{ padding: '6px 14px', borderRadius: '999px', border: 'none', backgroundColor: '#f1f5f9', color: '#334155', cursor: 'pointer', fontSize: '12px', fontWeight: 600, fontFamily: 'inherit' }}
                    >Today</button>
                    <button
                      onClick={() => setCalendarWeekStart(w => addDaysLocal(w, 7))}
                      style={{ width: '28px', height: '28px', borderRadius: '50%', border: 'none', backgroundColor: '#f1f5f9', color: '#475569', cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit' }}
                    >›</button>
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{weekRangeLabel}</span>
                </div>

                {/* Day headers */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #f1f5f9' }}>
                  {calendarDays.map((day, idx) => {
                    const key = localDateKey(day);
                    const isToday = key === todayKey;
                    const count = (postsByDay[key] || []).length;
                    return (
                      <div key={key} style={{ padding: '12px 6px', textAlign: 'center' as const, borderRight: idx < 6 ? '1px solid #f8fafc' : 'none' }}>
                        <div style={{ fontSize: '10px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                          {day.toLocaleDateString('en-US', { weekday: 'short' })}
                        </div>
                        <div style={{
                          margin: '4px auto 0', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: '26px', height: '26px', borderRadius: '50%', fontSize: '13px', fontWeight: 700,
                          backgroundColor: isToday ? '#0f172a' : 'transparent', color: isToday ? '#fff' : '#334155',
                        }}>
                          {day.getDate()}
                        </div>
                        {count > 0 && (
                          <div style={{ marginTop: '4px', fontSize: '10px', fontWeight: 700, color: '#6366f1' }}>
                            {count} post{count !== 1 ? 's' : ''}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Day columns with post previews */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', minHeight: '180px' }}>
                  {calendarDays.map((day, idx) => {
                    const key = localDateKey(day);
                    const dayPosts = postsByDay[key] || [];
                    return (
                      <div key={key} style={{ padding: '10px 6px', borderRight: idx < 6 ? '1px solid #f8fafc' : 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {dayPosts.map(post => {
                          const m = getPostMedia(post as unknown as { imageUrl?: string; videoUrl?: string; mediaUrl?: string; mediaType?: string; mediaUrls?: string[]; mediaList?: MediaItem[] });
                          return (
                          <div key={post.id} style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#fafbfc' }}>
                            {m.list && m.list.length > 1 ? (
                              <div style={{ display: 'grid', gridTemplateColumns: m.count! > 2 ? '1fr 1fr' : '1fr 1fr', gap: '2px', height: '54px' }}>
                                {m.list.slice(0,4).map((mm, idx) => (
                                  <div key={idx} style={{ position: 'relative', backgroundColor: '#000', overflow: 'hidden' }}>
                                    {mm.type==='video' ? <video src={mm.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted /> : <img src={mm.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                                    {m.count! >4 && idx===3 && <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+{m.count!-3}</div>}
                                  </div>
                                ))}
                              </div>
                            ) : m.url ? (m.isVideo ? (
                              <video src={m.url} style={{ width: '100%', height: '54px', objectFit: 'cover', display: 'block', backgroundColor: '#000' }} muted />
                            ) : (
                              <img src={m.url} alt="" style={{ width: '100%', height: '54px', objectFit: 'cover', display: 'block' }} />
                            )) : null}
                            {m.type && <div style={{ fontSize: '8px', fontWeight: 700, textAlign: 'center' as const, padding: '2px', backgroundColor: m.isVideo ? '#fef3c7' : '#e0f2fe', color: m.isVideo ? '#92400e' : '#0369a1' }}>{m.count! >1 ? `${m.count} FILES · ${m.videoCount}V ${m.imageCount}I` : m.type.toUpperCase()}</div>}
                            <div style={{ padding: '8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '5px' }}>
                                {post.platforms.map(pl => (
                                  <span key={pl} style={{ width: '15px', height: '15px', borderRadius: '50%', backgroundColor: platformColors[pl] || '#94a3b8', color: '#fff', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    <PlatformIcon platform={pl} size={8} />
                                  </span>
                                ))}
                                <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                                  {new Date(post.scheduledAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                </span>
                              </div>
                              <div style={{
                                fontSize: '11px', color: '#334155', lineHeight: 1.4, overflow: 'hidden',
                                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const,
                              }}>
                                {post.content.split('\n')[0]}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' }}>
                                <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 6px', borderRadius: '999px', backgroundColor: statusMeta.pending.bg, color: statusMeta.pending.color, textTransform: 'uppercase' as const, letterSpacing: '0.03em' }}>
                                  Pending
                                </span>
                                <button
                                  onClick={() => cancelScheduled(post.id)}
                                  style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: '10px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
                                >Cancel</button>
                              </div>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={{ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '14px' }}>📅</span>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>{filteredSchedulerPosts.length} Post{filteredSchedulerPosts.length !== 1 ? 's' : ''}</span>
                </div>
                <div style={{ padding: filteredSchedulerPosts.length ? '8px 20px' : '0' }}>
                  {filteredSchedulerPosts.length === 0 ? (
                    <div style={{ padding: '48px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '32px', opacity: 0.3 }}>📭</span>
                      <span style={{ fontSize: '13px', color: '#94a3b8' }}>No {schedulerFilter === 'all' ? '' : schedulerFilter} posts</span>
                    </div>
                  ) : (
                    filteredSchedulerPosts.map(post => {
                      const meta = statusMeta[post.status] || statusMeta.pending;
                      const m = getPostMedia(post as unknown as { imageUrl?: string; videoUrl?: string; mediaUrl?: string; mediaType?: string; mediaUrls?: string[]; mediaList?: MediaItem[] });
                      return (
                        <div key={post.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 0', borderBottom: '1px solid #f1f5f9' }}>
                          {m.count! > 1 ? (
                            <div style={{ width: '48px', height: '48px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #e2e8f0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', flexShrink: 0 }}>
                              {m.list!.slice(0,4).map((mm,i)=>(
                                <div key={i} style={{ backgroundColor: '#000', overflow: 'hidden', position: 'relative' }}>
                                  {mm.type==='video' ? <video src={mm.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted /> : <img src={mm.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                                  {m.count! >4 && i===3 && <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '9px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+{m.count!-3}</div>}
                                </div>
                              ))}
                            </div>
                          ) : m.url ? (
                            m.isVideo ? (
                              <video src={m.url} style={{ width: '48px', height: '48px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0, border: '1px solid #e2e8f0', backgroundColor: '#000' }} muted />
                            ) : (
                              <img src={m.url} alt="" style={{ width: '48px', height: '48px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0, border: '1px solid #e2e8f0' }} />
                            )
                          ) : (
                            <div style={{ width: '48px', height: '48px', borderRadius: '8px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0, opacity: 0.5 }}>📄</div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '13px', color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                              {post.content.split('\n')[0].substring(0, 70)}
                            </div>
                            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span>{new Date(post.scheduledAt).toLocaleString()}</span>
                              {m.count! >0 && <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 5px', borderRadius: '4px', backgroundColor: m.videoCount! >0 && m.imageCount! >0 ? '#f3e8ff' : m.isVideo ? '#fef3c7' : '#e0f2fe', color: m.videoCount! >0 && m.imageCount! >0 ? '#7c3aed' : m.isVideo ? '#92400e' : '#0369a1' }}>{m.count! >1 ? `${m.count} files (${m.imageCount}I ${m.videoCount}V)` : m.isVideo ? 'VIDEO' : 'IMAGE'}</span>}
                              <span style={{ display: 'flex', gap: '4px' }}>
                                {post.platforms.map(pl => (
                                  <span key={pl} style={{ width: '16px', height: '16px', borderRadius: '50%', backgroundColor: platformColors[pl] || '#94a3b8', color: '#fff', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <PlatformIcon platform={pl} size={9} />
                                  </span>
                                ))}
                              </span>
                            </div>
                          </div>
                          <span style={{ fontSize: '10px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px', backgroundColor: meta.bg, color: meta.color, flexShrink: 0, textTransform: 'uppercase' as const, letterSpacing: '0.03em' }}>
                            {meta.label}
                          </span>
                          {post.status === 'pending' && (
                            <button
                              onClick={() => cancelScheduled(post.id)}
                              style={{ padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, border: 'none', backgroundColor: '#fef2f2', color: '#dc2626', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
                            >Cancel</button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Analytics */}
        {activeTab === 'analytics' && (
          <div style={{ padding: '24px 32px', flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {allPosts.length === 0 ? (
              <div style={{ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', padding: '56px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '36px', opacity: 0.3 }}>📈</span>
                <span style={{ fontSize: '14px', color: '#64748b', fontWeight: 500 }}>No analytics yet</span>
                <span style={{ fontSize: '12px', color: '#94a3b8', maxWidth: '320px', textAlign: 'center' as const }}>Schedule and publish posts to see performance data here.</span>
                <button
                  onClick={() => setActiveTab('studio')}
                  style={{ marginTop: '6px', padding: '10px 18px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, border: 'none', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}
                >Create your first post</button>
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px' }}>
                  {[
                    { label: 'Total Posts', value: String(allPosts.length), color: '#6366f1' },
                    { label: 'Published', value: String(publishedPosts.length), color: '#10b981' },
                    { label: 'Pending', value: String(pendingPosts.length), color: '#f59e0b' },
                    { label: 'Failed', value: String(failedPosts.length), color: '#ef4444' },
                    { label: 'Success Rate', value: successRate === null ? '—' : `${successRate}%`, color: '#8b5cf6' },
                  ].map(tile => (
                    <div key={tile.label} style={{ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', padding: '18px 20px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '10px' }}>{tile.label}</div>
                      <div style={{ fontSize: '26px', fontWeight: 700, color: tile.color, letterSpacing: '-0.02em' }}>{tile.value}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                  {/* By status */}
                  <div style={{ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>By Status</div>
                    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      {(['published', 'pending', 'failed', 'cancelled'] as const).map(status => {
                        const count = allPosts.filter(p => p.status === status).length;
                        const pct = allPosts.length ? Math.round((count / allPosts.length) * 100) : 0;
                        const meta = statusMeta[status];
                        return (
                          <div key={status}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                              <span style={{ fontSize: '12px', color: '#334155', fontWeight: 500 }}>{meta.label}</span>
                              <span style={{ fontSize: '12px', color: '#94a3b8' }}>{count}</span>
                            </div>
                            <div style={{ height: '8px', borderRadius: '4px', backgroundColor: '#f1f5f9', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, borderRadius: '4px', backgroundColor: meta.color, transition: 'width 0.3s' }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* By platform */}
                  <div style={{ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>By Platform</div>
                    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      {Object.keys(platformCounts).length === 0 ? (
                        <span style={{ fontSize: '12px', color: '#94a3b8' }}>No platform data yet</span>
                      ) : (
                        Object.entries(platformCounts).map(([platform, count]) => {
                          const pct = Math.round((count / maxPlatformCount) * 100);
                          return (
                            <div key={platform}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                <span style={{ fontSize: '12px', color: '#334155', fontWeight: 500, textTransform: 'capitalize' as const }}>{platform}</span>
                                <span style={{ fontSize: '12px', color: '#94a3b8' }}>{count}</span>
                              </div>
                              <div style={{ height: '8px', borderRadius: '4px', backgroundColor: '#f1f5f9', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${pct}%`, borderRadius: '4px', backgroundColor: platformColors[platform] || '#6366f1', transition: 'width 0.3s' }} />
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Schedule Post Modal */}
      {restorePromptOpen && savedDraft && (
        <div
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(2px)',
            zIndex: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
            animation: 'overlayIn 0.15s ease-out',
          }}
        >
          <div
            style={{
              backgroundColor: '#fff', borderRadius: '18px', width: '100%', maxWidth: '460px',
              maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(15,23,42,0.3)',
              animation: 'modalPopIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div style={{ padding: '22px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{
                width: '42px', height: '42px', borderRadius: '12px', flexShrink: 0,
                background: 'linear-gradient(135deg, #7C3AED, #8B5CF6)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: '19px',
                boxShadow: '0 4px 12px rgba(124,58,237,0.35)',
              }}>↺</div>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.01em' }}>Restore previous work?</div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '1px' }}>You reloaded with unsaved progress</div>
              </div>
            </div>

            <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '12.5px', color: '#475569', backgroundColor: '#F8FAFC', border: '1px solid #e2e8f0', padding: '12px 14px', borderRadius: '10px', lineHeight: 1.7 }}>
                {[
                  savedDraft.prompt?.trim() ? `📝 Topic: “${savedDraft.prompt.trim().slice(0, 80)}${savedDraft.prompt.trim().length > 80 ? '…' : ''}”` : null,
                  savedDraft.content?.trim() ? '✨ Generated content' : null,
                  (savedDraft.mediaItems?.length || 0) + (savedDraft.topicMediaItems?.length || 0) > 0
                    ? `🖼️ ${(savedDraft.mediaItems?.length || 0) + (savedDraft.topicMediaItems?.length || 0)} image${(savedDraft.mediaItems?.length || 0) + (savedDraft.topicMediaItems?.length || 0) === 1 ? '' : 's'}` : null,
                  savedDraft.logoImage && !savedDraft.mediaSkipped ? '🏷️ Logo' : null,
                  savedDraft.mediaSkipped ? '⚠️ Images were too large to keep' : null,
                ].filter(Boolean).join('  •  ') || 'Previous session found'}
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={keepRestoredDraft}
                  style={{ flex: 1.4, padding: '12px 14px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg,#7C3AED,#8B5CF6)', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                >Keep my content →</button>
                <button
                  onClick={discardSavedDraft}
                  style={{ flex: 1, padding: '12px 14px', borderRadius: '10px', border: '1px solid #FECACA', background: '#fff', color: '#DC2626', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                >Start fresh</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {safetyBlockedOpen && (
        <div
          onClick={() => setSafetyBlockedOpen(false)}
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(2px)',
            zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
            animation: 'overlayIn 0.15s ease-out',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              backgroundColor: '#fff', borderRadius: '18px', width: '100%', maxWidth: '460px',
              maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(15,23,42,0.3)',
              animation: 'modalPopIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div style={{ padding: '22px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{
                  width: '42px', height: '42px', borderRadius: '12px', flexShrink: 0,
                  background: 'linear-gradient(135deg, #ef4444, #b91c1c)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: '19px',
                  boxShadow: '0 4px 12px rgba(239,68,68,0.35)',
                }}>🛡️</div>
                <div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.01em' }}>Image blocked by safety filter</div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '1px' }}>The image model refused this prompt</div>
                </div>
              </div>
              <button
                onClick={() => setSafetyBlockedOpen(false)}
                style={{
                  width: '32px', height: '32px', borderRadius: '50%', border: 'none', flexShrink: 0,
                  backgroundColor: '#f1f5f9', color: '#64748b', fontSize: '16px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >×</button>
            </div>

            <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '13px', color: '#334155', lineHeight: 1.6 }}>
                This is <b>not</b> an outage. Very short, random, or test-like words get read
                as adversarial by the filter and blocked — <b>retrying the same words will
                be blocked again</b>.
              </div>
              <div style={{ fontSize: '13px', color: '#334155', lineHeight: 1.6 }}>
                Use a clear, descriptive sentence instead — describe the scene you want:
              </div>
              <div style={{ fontSize: '12.5px', color: '#4338ca', backgroundColor: '#eef2ff', border: '1px solid #c7d2fe', padding: '12px 14px', borderRadius: '10px', lineHeight: 1.6, fontStyle: 'italic' }}>
                “{SAFETY_EXAMPLE_PROMPT}”
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                <button
                  onClick={() => { setImagePrompt(SAFETY_EXAMPLE_PROMPT); setSafetyBlockedOpen(false); }}
                  style={{ flex: 1, padding: '11px 14px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg,#7C3AED,#8B5CF6)', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                >Use this example →</button>
                <button
                  onClick={() => setSafetyBlockedOpen(false)}
                  style={{ padding: '11px 18px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#fff', color: '#334155', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                >Got it</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {scheduleModalOpen && (
        <div
          onClick={() => setScheduleModalOpen(false)}
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(2px)',
            zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
            animation: 'overlayIn 0.15s ease-out',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              backgroundColor: '#fff', borderRadius: '18px', width: '100%', maxWidth: '440px',
              maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(15,23,42,0.3)',
              animation: 'modalPopIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* Header */}
            <div style={{ padding: '22px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{
                  width: '42px', height: '42px', borderRadius: '12px', flexShrink: 0,
                  background: 'linear-gradient(135deg, #f59e0b, #d97706)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: '19px',
                  boxShadow: '0 4px 12px rgba(245,158,11,0.35)',
                }}>📅</div>
                <div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.01em' }}>Schedule Post</div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '1px' }}>Pick a date and time to publish</div>
                </div>
              </div>
              <button
                onClick={() => setScheduleModalOpen(false)}
                style={{
                  width: '32px', height: '32px', borderRadius: '50%', border: 'none', flexShrink: 0,
                  backgroundColor: '#f1f5f9', color: '#64748b', fontSize: '16px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background-color 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#e2e8f0'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#f1f5f9'; }}
              >×</button>
            </div>

            <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div style={{ fontSize: '12px', color: '#6366f1', backgroundColor: '#eef2ff', padding: '10px 12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>⏱️</span> Posts must be scheduled at least 5 minutes from now
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: '6px', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Date</label>
                  <input
                    type="date"
                    value={scheduleDate}
                    min={minSchedulableDateStr}
                    onChange={e => { setScheduleDate(e.target.value); setTimePickerOpen(false); }}
                    style={{
                      width: '100%', padding: '11px 12px', border: '2px solid #e2e8f0', borderRadius: '10px',
                      fontSize: '13px', color: '#0f172a', backgroundColor: '#fafbfc', outline: 'none',
                      fontFamily: 'inherit',
                    }}
                  />
                </div>
                <div ref={timePickerRef} style={{ position: 'relative' }}>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: '6px', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Time</label>
                  <button
                    type="button"
                    onClick={() => setTimePickerOpen(o => !o)}
                    disabled={!scheduleDate}
                    style={{
                      width: '100%', padding: '11px 12px', border: timePickerOpen ? '2px solid #6366f1' : '2px solid #e2e8f0',
                      borderRadius: '10px', fontSize: '13px', color: scheduleTime ? '#0f172a' : '#94a3b8',
                      backgroundColor: !scheduleDate ? '#f1f5f9' : '#fafbfc', outline: 'none', fontFamily: 'inherit',
                      cursor: !scheduleDate ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between', boxShadow: timePickerOpen ? '0 0 0 3px rgba(99,102,241,0.12)' : 'none',
                    }}
                  >
                    <span>{scheduleTime || 'Select'}</span>
                    <span style={{ fontSize: '12px', opacity: 0.6 }}>🕐</span>
                  </button>

                  {timePickerOpen && scheduleDate && (
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 210,
                      backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.14)', display: 'flex', overflow: 'hidden',
                    }}>
                      {/* Hour column */}
                      <div style={{ flex: 1, maxHeight: '190px', overflowY: 'auto', borderRight: '1px solid #f1f5f9' }}>
                        {Array.from({ length: 24 }, (_, h) => h).map(h => {
                          const disabled = isTimeRestrictedToday && h < minSchedulableHour;
                          const selected = selectedHour === h;
                          return (
                            <div
                              key={h}
                              onClick={() => {
                                if (disabled) return;
                                // Jumping onto the boundary hour can leave a previously-picked
                                // minute in the now-disabled range — clamp it forward.
                                const minuteFloor = isTimeRestrictedToday && h === minSchedulableHour ? minSchedulableMinute : 0;
                                commitTime(h, Math.max(selectedMinute, minuteFloor));
                              }}
                              data-selected={selected || undefined}
                              title={disabled ? 'Posts must be scheduled at least 5 minutes from now' : undefined}
                              style={{
                                padding: '8px 0', textAlign: 'center' as const, fontSize: '13px',
                                cursor: disabled ? 'not-allowed' : 'pointer',
                                color: disabled ? '#cbd5e1' : selected ? '#fff' : '#334155',
                                backgroundColor: selected && !disabled ? '#6366f1' : 'transparent',
                                fontWeight: selected ? 700 : 500, userSelect: 'none' as const, transition: 'background-color 0.15s',
                              }}
                              onMouseEnter={e => { if (!disabled && !selected) e.currentTarget.style.backgroundColor = '#f1f5f9'; }}
                              onMouseLeave={e => { if (!disabled && !selected) e.currentTarget.style.backgroundColor = 'transparent'; }}
                            >
                              {String(h).padStart(2, '0')}
                            </div>
                          );
                        })}
                      </div>
                      {/* Minute column */}
                      <div style={{ flex: 1, maxHeight: '190px', overflowY: 'auto' }}>
                        {Array.from({ length: 60 }, (_, m) => m).map(m => {
                          const disabled = isTimeRestrictedToday && selectedHour === minSchedulableHour && m < minSchedulableMinute;
                          const selected = selectedMinute === m;
                          return (
                            <div
                              key={m}
                              onClick={() => { if (!disabled) commitTime(selectedHour, m); }}
                              data-selected={selected || undefined}
                              title={disabled ? 'Posts must be scheduled at least 5 minutes from now' : undefined}
                              style={{
                                padding: '8px 0', textAlign: 'center' as const, fontSize: '13px',
                                cursor: disabled ? 'not-allowed' : 'pointer',
                                color: disabled ? '#cbd5e1' : selected ? '#fff' : '#334155',
                                backgroundColor: selected && !disabled ? '#6366f1' : 'transparent',
                                fontWeight: selected ? 700 : 500, userSelect: 'none' as const, transition: 'background-color 0.15s',
                              }}
                              onMouseEnter={e => { if (!disabled && !selected) e.currentTarget.style.backgroundColor = '#f1f5f9'; }}
                              onMouseLeave={e => { if (!disabled && !selected) e.currentTarget.style.backgroundColor = 'transparent'; }}
                            >
                              {String(m).padStart(2, '0')}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={schedulePost}
                disabled={scheduleSuccessFlash || isScheduling || !content.trim() || !scheduleDate || !scheduleTime || selectedPlatforms.length === 0}
                style={{
                  padding: '13px 20px', borderRadius: '10px', fontSize: '14px', fontWeight: 600, border: 'none',
                  background: scheduleSuccessFlash
                    ? 'linear-gradient(135deg, #10b981, #059669)'
                    : isScheduling || !content.trim() || !scheduleDate || !scheduleTime || selectedPlatforms.length === 0
                      ? '#e2e8f0'
                      : 'linear-gradient(135deg, #f59e0b, #d97706)',
                  color: !scheduleSuccessFlash && (isScheduling || !content.trim() || !scheduleDate || !scheduleTime || selectedPlatforms.length === 0)
                    ? '#94a3b8'
                    : '#fff',
                  cursor: scheduleSuccessFlash || isScheduling || !content.trim() || !scheduleDate || !scheduleTime || selectedPlatforms.length === 0
                    ? 'not-allowed'
                    : 'pointer',
                  boxShadow: scheduleSuccessFlash
                    ? '0 4px 16px rgba(16,185,129,0.4)'
                    : isScheduling || !content.trim() || !scheduleDate || !scheduleTime || selectedPlatforms.length === 0
                      ? 'none'
                      : '0 4px 14px rgba(217,119,6,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  fontFamily: 'inherit', transition: 'all 0.2s', width: '100%',
                  animation: scheduleSuccessFlash ? 'connectPulseRing 0.9s ease-out' : 'none',
                }}
              >
                {scheduleSuccessFlash ? (
                  <><span style={{ display: 'inline-block', animation: 'connectCheckPop 0.5s ease-out' }}>✅</span> Scheduled!</>
                ) : isScheduling ? (
                  <><span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> Scheduling...</>
                ) : (
                  <><span>🚀</span> Confirm Schedule</>
                )}
              </button>

              {!content.trim() && (
                <div style={{ fontSize: '11px', color: '#94a3b8', textAlign: 'center' as const, marginTop: '-8px' }}>Add content in the editor before scheduling.</div>
              )}
              {content.trim() && selectedPlatforms.length === 0 && (
                <div style={{ fontSize: '11px', color: '#94a3b8', textAlign: 'center' as const, marginTop: '-8px' }}>Select at least one platform before scheduling.</div>
              )}

              {pendingPosts.length > 0 && (
                <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Upcoming ({pendingPosts.length})</span>
                    <button
                      onClick={() => { setScheduleModalOpen(false); setActiveTab('scheduler'); setSchedulerFilter('pending'); }}
                      style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                    >View calendar →</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                    {pendingPosts.slice(0, 4).map(post => (
                      <div key={post.id} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 10px', backgroundColor: '#fffbeb', borderRadius: '8px',
                        border: '1px solid #fef3c7', gap: '8px',
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '11px', color: '#92400e', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                            {post.content.substring(0, 40)}...
                          </div>
                          <div style={{ fontSize: '10px', color: '#b45309', marginTop: '2px' }}>
                            {new Date(post.scheduledAt).toLocaleString()} · {post.platforms.join(', ')}
                          </div>
                        </div>
                        <button
                          onClick={() => cancelScheduled(post.id)}
                          style={{
                            padding: '3px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
                            border: 'none', backgroundColor: '#fef2f2', color: '#dc2626',
                            cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
                          }}
                        >Cancel</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Logo Modal — ffmpeg */}
      {logoModalOpen && (
        <div onClick={() => setLogoModalOpen(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', animation: 'overlayIn 0.15s ease-out' }}>
          <div onClick={e => e.stopPropagation()} style={{ backgroundColor: '#fff', borderRadius: '16px', width: '100%', maxWidth: '460px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(15,23,42,0.3)', animation: 'modalPopIn 0.2s cubic-bezier(0.16,1,0.3,1)' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #0f172a, #334155)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '16px' }}>🏷️</div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>Add Company Logo</div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>Apply Logo burns it onto the selected image{logoTargetId ? '' : 's'} • preview uses overlay</div>
                </div>
              </div>
              <button onClick={() => setLogoModalOpen(false)} style={{ width: '30px', height: '30px', borderRadius: '50%', border: 'none', backgroundColor: '#f1f5f9', color: '#64748b', cursor: 'pointer', fontSize: '14px' }}>×</button>
            </div>
            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {generationError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: '#B91C1C', backgroundColor: '#FEF2F2', border: '1px solid #FECACA', padding: '10px 12px', borderRadius: 10 }}>
                  <span style={{ flex: 1 }}>⚠️ {generationError}</span>
                  <button onClick={() => setGenerationError('')} style={{ border: 'none', background: 'none', color: '#B91C1C', fontSize: 14, fontWeight: 700, cursor: 'pointer', padding: '0 2px' }}>×</button>
                </div>
              )}
              {!logoImage ? (
                <div
                  onClick={() => logoInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); e.stopPropagation(); setLogoDragOver(true); }}
                  onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setLogoDragOver(true); }}
                  onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setLogoDragOver(false); }}
                  onDrop={handleLogoDrop}
                  style={{ padding: '20px', border: logoDragOver ? '2px dashed #7C3AED' : '2px dashed #c7d2fe', borderRadius: '12px', backgroundColor: logoDragOver ? '#F1EBFF' : '#eef2ff', textAlign: 'center' as const, cursor: 'pointer', transition: 'all 0.18s' }}
                >
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>{logoDragOver ? '📥' : '🖼️'}</div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#4338ca' }}>{logoDragOver ? 'Drop logo here' : 'No logo yet'}</div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>Drag & drop a PNG here, or click to browse • transparency recommended • max 5MB</div>
                  <button onClick={e => { e.stopPropagation(); logoInputRef.current?.click(); }} style={{ marginTop: '12px', padding: '8px 16px', borderRadius: '8px', border: 'none', backgroundColor: '#0f172a', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Upload Logo</button>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '10px', border: '1px solid #e2e8f0', borderRadius: '10px', backgroundColor: '#f8fafc' }}>
                    <img src={logoImage} alt="logo" style={{ width: '48px', height: '48px', objectFit: 'contain', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '4px' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>Logo loaded ✓ <span style={{ fontSize: '10px', fontWeight: 600, backgroundColor: aspectRatio ? '#eef2ff' : '#fffbeb', color: aspectRatio ? '#4338ca' : '#92400e', padding: '2px 6px', borderRadius: '999px', border: `1px solid ${aspectRatio ? '#c7d2fe' : '#fde68a'}` }}>{aspectRatio ? `${aspectRatio} • ${aspectRatioMap[aspectRatio]?.width}×${aspectRatioMap[aspectRatio]?.height}` : 'no ratio — choose above'}</span></div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>Respects selected ratio • Click preview to test</div>
                    </div>
                    <button onClick={() => logoInputRef.current?.click()} style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', backgroundColor: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Change</button>
                    <button onClick={() => setLogoImage('')} style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #fecaca', backgroundColor: '#fff', color: '#dc2626', fontSize: '11px', cursor: 'pointer' }}>Remove</button>
                  </div>
                  {/* Position grid */}
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#0f172a', marginBottom: '8px', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Position</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                      {(['top-left','top-right','center','bottom-left','bottom-right'] as const).map(pos => (
                        <button key={pos} onClick={() => setLogoPosition(pos)} style={{ padding: '10px 6px', borderRadius: '10px', border: logoPosition === pos ? '2px solid #0A66C2' : '1px solid #e2e8f0', backgroundColor: logoPosition === pos ? '#eef2ff' : '#fff', color: logoPosition === pos ? '#0A66C2' : '#475569', fontSize: '11px', fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' as const }}>
                          {pos.replace('-', ' ')} {logoPosition === pos && '✓'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: '#0f172a' }}>Size: {Math.round(logoScale*100)}%</label>
                      <input type="range" min={0.1} max={0.35} step={0.02} value={logoScale} onChange={e => setLogoScale(parseFloat(e.target.value))} style={{ width: '100%', marginTop: '6px' }} />
                      <div style={{ fontSize: '10px', color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}><span>Small</span><span>Large</span></div>
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: '#0f172a' }}>Opacity: {Math.round(logoOpacity*100)}%</label>
                      <input type="range" min={0.5} max={1} step={0.05} value={logoOpacity} onChange={e => setLogoOpacity(parseFloat(e.target.value))} style={{ width: '100%', marginTop: '6px' }} />
                    </div>
                  </div>
                  {/* Live preview — respects chosen aspectRatio */}
                  {(mediaItems[0] || generatedImage) && (
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', backgroundColor: '#000', position: 'relative', aspectRatio: aspectRatio ? aspectRatio.replace(':', ' / ') : '16 / 9' }}>
                      <img src={mediaItems[0]?.url || generatedImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      {!(mediaItems[0] ? burnedLogoIds[mediaItems[0].id] : burnedLogoIds['gen']) && <img src={logoImage} alt="logo" style={{
                        position: 'absolute',
                        width: `${Math.round(logoScale*100)}%`, maxWidth: '28%',
                        opacity: logoOpacity,
                        ...(logoPosition === 'top-left' ? { top: '8px', left: '8px' } : logoPosition === 'top-right' ? { top: '8px', right: '8px' } : logoPosition === 'bottom-left' ? { bottom: '8px', left: '8px' } : logoPosition === 'bottom-right' ? { bottom: '8px', right: '8px' } : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }),
                        backgroundColor: 'rgba(255,255,255,0.92)', padding: '4px', borderRadius: '6px', boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                      }} />}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => setLogoModalOpen(false)} style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0', backgroundColor: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                    {logoTargetId && mediaItems.some(m => m.id === logoTargetId) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: '8px', backgroundColor: '#eef2ff', border: '1px solid #c7d2fe', fontSize: '11px', color: '#4338ca', fontWeight: 600 }}>
                        <span style={{ flex: 1 }}>🎯 Target: {(() => { const i = mediaItems.findIndex(m => m.id === logoTargetId); return i === 0 ? '★ Cover image' : `Image #${i + 1}`; })()} only</span>
                        <button onClick={() => setLogoTargetId(null)} style={{ fontSize: '10px', fontWeight: 700, color: '#4338ca', background: '#fff', border: '1px solid #c7d2fe', borderRadius: '6px', padding: '3px 8px', cursor: 'pointer' }}>All {mediaItems.length} instead</button>
                      </div>
                    )}
                    <button onClick={() => applyLogoToAllMedia()} disabled={isApplyingLogo || !logoImage} style={{ flex: 1.6, padding: '10px', borderRadius: '8px', border: 'none', background: isApplyingLogo ? '#94a3b8' : 'linear-gradient(135deg, #0A66C2, #004182)', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: isApplyingLogo ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                      {isApplyingLogo ? <span style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> : <span>🏷️</span>} {isApplyingLogo ? 'Applying Logo...' : 'Apply Logo'}
                    </button>
                  </div>
                  <div style={{ fontSize: '10px', color: '#64748b', backgroundColor: '#f8fafc', padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                    <b>ffmpeg:</b> For images, logo is burned via canvas (client-side ffmpeg-style). For video, preview shows overlay; on publish we attempt <code>@ffmpeg/ffmpeg</code> wasm burn — if unavailable, video keeps preview overlay and LinkedIn will show it as image+overlay in preview.
                  </div>
                </>
              )}
            </div>
            {/* Hidden file picker for logo upload (ref must exist while modal is open) */}
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
              style={{ display: 'none' }}
            />
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {showToast && (
        <div style={{
          position: 'fixed', top: '24px', right: '24px', zIndex: 1000,
          padding: '14px 20px', borderRadius: '10px',
          backgroundColor: publishResultType === 'success' ? '#10b981' : '#ef4444',
          color: '#fff', fontSize: '13px', fontWeight: 500,
          boxShadow: publishResultType === 'success'
            ? '0 4px 16px rgba(16,185,129,0.4)'
            : '0 4px 16px rgba(239,68,68,0.4)',
          display: 'flex', alignItems: 'center', gap: '10px',
          animation: 'slideInRight 0.3s ease-out',
          maxWidth: '400px',
        }}>
          <span style={{ fontSize: '16px', display: 'inline-block', animation: publishResultType === 'success' ? 'connectCheckPop 0.4s ease-out' : 'none' }}>{publishResultType === 'success' ? '✓' : '✕'}</span>
          <span>{publishResult}</span>
          <button
            onClick={() => setShowToast(false)}
            style={{
              marginLeft: '8px', background: 'none', border: 'none', color: '#fff',
              cursor: 'pointer', fontSize: '16px', padding: '0', lineHeight: 1, opacity: 0.8,
            }}
          >×</button>
        </div>
      )}
    </div>
  );
}
