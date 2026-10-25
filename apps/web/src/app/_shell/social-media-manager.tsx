'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import StudioWorkspace from './studio-workspace';
import AIGenerationModal from './ai-generation-modal';
import SchedulerCalendar from './scheduler-calendar';
import ConnectPlatforms from './connect-platforms';
import AssetLibrary from './asset-library';
import { newestDrafts, postMedia, normalizeLegacyCollaborator, type PostRecord, type Collaborator } from '@/lib/posts';
import { carouselMediaIssue } from '@/lib/carousel-rules';
import {
  addCollaborator as addCollaboratorHelper,
  removeCollaborator as removeCollaboratorHelper,
  updateCollaboratorField as updateCollaboratorFieldHelper,
  markCollaboratorSent as markCollaboratorSentHelper,
  markCollaboratorPending as markCollaboratorPendingHelper,
  markCollaboratorResolved as markCollaboratorResolvedHelper,
  mergeCollaboratorResults,
  collaboratorsForPublish,
} from '@/lib/collaborators';
import { returnStore } from '@/lib/editor-return';
import { clearAllUserState, identityChanged, purgeForeignUserState, userScopedKey } from '@/lib/client-identity';
import { SP_LOGO, STUDIO_MARK } from './brand-assets';
import NotificationBell from '@/components/notifications/NotificationBell';
import { SpIcon } from './sp-icons';
import { DashboardHeroCoin } from './dashboard-hero-coin';

// One copy of Canva's error-code -> human sentence map, shared by both places a
// Canva failure can arrive (the ?error= query on a returned tab, and the
// postMessage handshake from the editor tab). They were duplicated inline and
// had already drifted; an unmapped code still falls back to the raw code so a
// new server-side code is never silently swallowed.
//
// CANVA_SESSION_EXPIRED is raised by /api/canva/return when the gateway
// session-gates Canva's return-navigation leg but the session died while the
// user was off in the Canva editor — without it that path showed raw JSON.
const CANVA_ERROR_MESSAGES: Record<string, string> = {
  CANVA_AUTH_FAILED: 'Canva authorization failed. Please try connecting again.',
  CANVA_STATE_MISMATCH: 'Canva connection could not be verified. Please try again.',
  CANVA_AUTH_EXPIRED: 'Connecting to Canva took too long. Please try again and finish the Canva sign-in without leaving it open.',
  CANVA_TOKEN_EXPIRED: 'Your Canva session expired. Please reconnect.',
  CANVA_IMPORT_FAILED: 'Could not prepare the Canva design for import. Please try again.',
  CANVA_SESSION_EXPIRED: 'Your SocialPulse session expired while you were in the Canva editor. Sign in again, then press “Edit in Canva” once more.',
};

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
  // Instagram only: the linked Business account's id (needed by
  // instagram/publish to resolve the right Page token server-side).
  igUserId?: string;
}

const platformColors: Record<string, string> = {
  linkedin: '#0A66C2',
  instagram: '#E1306C',
  facebook: '#1877F2',
  whatsapp: '#25D366',
};

const platformInitials: Record<string, string> = {
  linkedin: 'LI',
  instagram: 'IG',
  facebook: 'FB',
  whatsapp: 'WA',
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
    case 'instagram':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <rect x="3.5" y="3.5" width="17" height="17" rx="5.5" stroke="#fff" strokeWidth="1.8" />
          <circle cx="12" cy="12" r="4.3" stroke="#fff" strokeWidth="1.8" />
          <circle cx="17" cy="7" r="1.15" fill="#fff" />
        </svg>
      );
    case 'whatsapp':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M12.04 2C7.08 2 3.04 5.95 3.04 10.89c0 1.57.41 3.04 1.16 4.33L3 22l6.96-1.18c1.25.68 2.66 1.06 4.08 1.06 4.96 0 9-3.95 9-8.89S17 2 12.04 2z" fill="#fff" />
          <path d="M10.2 8.5c-.14 0-.32.05-.48.26-.16.21-.62.61-.62 1.49s.63 1.73.72 1.85c.09.12 1.24 1.89 3 2.65.73.32 1.3.51 1.74.65.73.23 1.39.2 1.91.12.58-.09.62-.53.69-1.04.06-.51.03-.95-.02-1.04-.05-.09-.18-.14-.38-.24-.19-.09-1.14-.56-1.32-.63-.18-.06-.31-.09-.44.09-.13.19-.5.63-.61.76-.11.13-.22.14-.41.05-.19-.09-.81-.3-1.54-.95-.57-.51-.95-1.14-1.06-1.33-.11-.19-.01-.29.08-.39.08-.08.19-.22.28-.33.09-.11.12-.19.18-.31.06-.12.03-.23-.01-.32-.05-.09-.44-1.07-.61-1.46-.16-.39-.32-.34-.44-.35h-.38z" fill="#25D366" />
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

// Strip a trailing hashtag block (e.g. "\n\n#tag1 #tag2") so we never
// publish hashtags twice when `content` already contains them.
function stripTrailingHashtags(s: string): string {
  return s.replace(/\n+\s*(#[A-Za-z0-9_]+\s*)+$/g, '').trimEnd();
}

// PERMANENT RULE: WhatsApp posts must NEVER contain hashtags. Trailing-only
// stripping is not enough (inline #tags survive edits) — every WhatsApp send
// path must use this full strip instead.
function stripAllHashtags(s: string): string {
  return s.replace(/#[A-Za-z0-9_]+/g, ' ').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
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

export interface MediaItem { id: string; url: string; type: 'image' | 'video'; name?: string; altText?: string; source?: string; canvaDesignId?: string; sourceMediaId?: string; importedAt?: number }
// Tracks one Canva editor outing: which design, which SocialPulse media item
// it came from (edit flow), how it was started, and when. Never holds tokens.
export interface CanvaSession { designId: string; sourceMediaId: string | null; mode: 'edit' | 'create'; openedAt: number; importedAt?: number }
export type AppTab = 'dashboard' | 'studio' | 'scheduler' | 'analytics' | 'media' | 'connect';

// Each tab has its own real, protected route (for direct links, refresh, and
// proxy.ts auth guarding). In-app tab switches use history.pushState (not
// next/navigation's router) so the URL updates without remounting this
// component - that would otherwise reset all in-progress Studio state.
// See node_modules/next/dist/docs/01-app/02-guides/single-page-applications.md
// ("Using the Native History API") for why this is the supported approach.
const TAB_PATH: Record<AppTab, string> = {
  dashboard: '/dashboard',
  studio: '/content-studio',
  scheduler: '/scheduler',
  analytics: '/analytics',
  media: '/asset-gallery',
  connect: '/connect-platforms',
};

export default function SocialMediaManager({ initialTab = 'dashboard' }: { initialTab?: AppTab }) {
  const [wizardState, setWizardState] = useState<Record<string, unknown>>({});
  const [draftId, setDraftId] = useState<string | undefined>();

  const [cancelTarget, setCancelTarget] = useState<{ id: string; redirectHome?: boolean } | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  // Pre-disconnect warning: "Instagram has 4 scheduled posts." Populated by
  // GET /api/scheduler/connectivity-warning before anything is revoked.
  // `unverified` means the count could not be fetched, so the dialog warns
  // that scheduled posts may be affected rather than claiming a number.
  const [disconnectTarget, setDisconnectTarget] = useState<{ platform: string; count: number; unverified?: boolean } | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [rescheduleTarget, setRescheduleTarget] = useState<PostRecord | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [legacyDrafts, setLegacyDrafts] = useState<PostRecord[]>([]);
  const [altBusy, setAltBusy] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [content, setContent] = useState('');
  const [generatedImage, setGeneratedImage] = useState('');
  const [generatedVideo, setGeneratedVideo] = useState('');
  const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]); // Publish gallery (Media Preview) — up to 9
  const [topicMediaItems, setTopicMediaItems] = useState<MediaItem[]>([]); // Reference media for AI vision (Topic & Idea) — up to 4
  // Carousel (multi-image swipeable post) — an explicit ordered subset of
  // mediaItems, image-only, 1–9 slides. LinkedIn (≤9 images) and Facebook
  // (multi-photo) already publish multi-image natively; Instagram takes the
  // CAROUSEL container path for 2+ slides (≤9, public URLs only) and the
  // regular single-media path when exactly 1 slide is selected.
  const [isCarousel, setIsCarousel] = useState(false);
  const [carouselSlideIds, setCarouselSlideIds] = useState<string[]>([]);
  // Instagram Trial Reel intent: only meaningful for Instagram + a single
  // video (which publishes as a Reel). Shown nowhere else; cleared the
  // moment the post stops being an Instagram Reel. Never silently posted as
  // a normal Reel — the publish route diverts trial posts to the trial seam.
  const [trialReel, setTrialReel] = useState(false);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [instagramPostUrl, setInstagramPostUrl] = useState<string>('');
  const addCollaboratorEntry = () => setCollaborators(cs => addCollaboratorHelper(cs));
  const removeCollaboratorEntry = (index: number) => setCollaborators(cs => removeCollaboratorHelper(cs, index));
  const updateCollaboratorEntry = (index: number, patch: Partial<Collaborator>) => setCollaborators(cs => updateCollaboratorFieldHelper(cs, index, patch));
  const markCollaboratorEntrySent = (index: number) => setCollaborators(cs => markCollaboratorSentHelper(cs, index));
  const markCollaboratorEntryPending = (index: number) => setCollaborators(cs => markCollaboratorPendingHelper(cs, index));
  const markCollaboratorEntryResolved = (index: number, outcome: 'Accepted' | 'Declined') => setCollaborators(cs => markCollaboratorResolvedHelper(cs, index, outcome));
  const [carouselSlideCount, setCarouselSlideCount] = useState(4); // Generate-N-slides helper size
  const [isGeneratingCarousel, setIsGeneratingCarousel] = useState(false);
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
  // Per-platform publish outcomes. A multi-platform publish can partially
  // fail, so a single global success/fail string would hide real failures.
  // 'pending' rows are re-used on retry so only failed targets are attempted.
  const [publishStatuses, setPublishStatuses] = useState<Record<string, { state: 'pending' | 'success' | 'failed'; message?: string }>>({});
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  // Per-account multi-select. A platform can have several connected accounts
  // (e.g. two LinkedIn logins); previously publish used
  // `accounts.find(...)` which silently picked only the FIRST match, so extra
  // accounts could never be targeted. Keys are `${platform}:${userId}:${pageId}`.
  const [selectedAccountKeys, setSelectedAccountKeys] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [canvaConnected, setCanvaConnected] = useState(false);
  const [canvaName, setCanvaName] = useState('');
  const [isSendingToCanva, setIsSendingToCanva] = useState(false);
  const [isImportingFromCanva, setIsImportingFromCanva] = useState(false);
  const [canvaReadyId, setCanvaReadyId] = useState('');
  const [canvaSession, setCanvaSession] = useState<CanvaSession | null>(null);
  const [canvaLastImportedReadyId, setCanvaLastImportedReadyId] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);
  const [justConnectedPlatform, setJustConnectedPlatform] = useState<string | null>(null);
  const [publishSuccessFlash, setPublishSuccessFlash] = useState(false);
  const [scheduleSuccessFlash, setScheduleSuccessFlash] = useState(false);
  const [editorTab, setEditorTab] = useState<'edit' | 'preview'>('preview');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [allPosts, setAllPosts] = useState<Array<PostRecord & { scheduledAt: string }>>([]);
  const [isScheduling, setIsScheduling] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>(initialTab);
  // Deliberate tab switches (nav clicks, quick links) go through here so the
  // address bar tracks the visible tab without a full route navigation.
  const goToTab = (tab: AppTab) => {
    setActiveTab(tab);
    if (typeof window !== 'undefined' && window.location.pathname !== TAB_PATH[tab]) {
      window.history.pushState(null, '', TAB_PATH[tab]);
    }
  };
  const [currentUser, setCurrentUser] = useState<{ name: string; email: string } | null>(null);
  // React #418 (hydration text mismatch) on /dashboard. Both values below were
  // computed during render from state the SERVER cannot have:
  //   currentUser — arrives from /api/auth/me in an effect, so the server always
  //     rendered the '?' / 'Loading…' fallback while the client already had the
  //     real name by first paint.
  //   new Date().getHours() — the container runs in a different timezone to the
  //     viewer's browser, so "Good morning" and "Good afternoon" can disagree.
  // Until mounted we render the same fallback the server produced, which makes
  // the first client render byte-identical to the SSR HTML. After mount the
  // real values replace them. This is a value-source fix, not a suppression.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    const saved = localStorage.getItem('sp-theme');
    if (saved === 'light' || saved === 'dark') setTheme(saved);
  }, []);
  const toggleTheme = () => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('sp-theme', next);
      return next;
    });
  };
  const [loggingOut, setLoggingOut] = useState(false);
  // The signed-in account id, resolved before ANY user-owned browser state is
  // read. Every localStorage key below is namespaced by it, so a key read can
  // never resolve to another account's data. `null` until /api/auth/me
  // resolves; draft loading waits for it rather than racing ahead unscoped.
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const id = d?.user?.id ?? null;
        // A previous account's client state is purged the moment we learn who
        // is actually signed in — including on a shared browser where the last
        // visitor was somebody else.
        if (id) identityChanged(id);
        else purgeForeignUserState(null);
        setUserId(id);
        if (d?.user) setCurrentUser(d.user);
      })
      .catch(() => { if (!cancelled) purgeForeignUserState(null); });
    return () => { cancelled = true; };
  }, []);
  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      // Wipe every user-owned browser store before leaving. Without this the
      // next person to sign in on this browser inherits the draft, the
      // connected-account list and the IndexedDB editor snapshots.
      await clearAllUserState();
      window.location.href = '/';
    }
  };
  const [schedulerFilter, setSchedulerFilter] = useState<'all' | 'pending' | 'published' | 'failed' | 'cancelled' | 'drafts'>('pending');
  const [calendarWeekStart, setCalendarWeekStart] = useState<Date>(() => startOfWeekLocal(new Date()));
  const [calView, setCalView] = useState<'week' | 'month' | 'list'>('month');
  const [calMonth, setCalMonth] = useState<Date>(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [previewPost, setPreviewPost] = useState<PostRecord | null>(null);
  // Auto-jump drafts calendar to week containing most recent draft if current week empty
  useEffect(() => {
    if (schedulerFilter !== 'drafts' && schedulerFilter !== 'all') return;
    const drafts = newestDrafts([...allPosts.filter(p => ['draft','cancelled'].includes(p.status)), ...legacyDrafts]);
    if (!drafts.length) return;
    const byDay: Record<string, typeof drafts> = {};
    drafts.forEach(post => {
      const raw = (post as any).previousScheduledAt || post.updatedAt || post.createdAt || '';
      const k = raw ? localDateKey(new Date(raw)) : '';
      if (!k) return;
      if (!byDay[k]) byDay[k] = [];
      byDay[k].push(post);
    });
    const hasInWeek = calendarDays.some(d => (byDay[localDateKey(d)] || []).length > 0);
    if (!hasInWeek) {
      const mostRecent = drafts[0];
      const raw = (mostRecent as any).previousScheduledAt || mostRecent.updatedAt || mostRecent.createdAt;
      if (raw) {
        const d = new Date(raw);
        setCalendarWeekStart(startOfWeekLocal(d));
        setCalMonth(new Date(d.getFullYear(), d.getMonth(), 1));
      }
    }
  }, [schedulerFilter, allPosts, legacyDrafts]);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const timePickerRef = useRef<HTMLDivElement>(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const topicFileInputRef = useRef<HTMLInputElement>(null);
  const [platformContent, setPlatformContent] = useState<Record<string, { caption: string; hashtags: string[] }>>({});
  const [imagePrompt, setImagePromptRaw] = useState('');
  const [activePreviewPlatform, setActivePreviewPlatform] = useState('linkedin');
  const [generationError, setGenerationError] = useState('');
  // Safety-filter popup: the image model refused the prompt (not an outage).
  const [safetyBlockedOpen, setSafetyBlockedOpen] = useState(false);
  // Server-side moderation outcome (CONTENT_SAFETY_BLOCKED). Distinct from the
  // provider-refusal dialog above: this one means OUR classifier declined the
  // request before generation, which also advances the account's warning
  // counter, so the copy has to say so.
  // Server-side moderation outcome. Carries the per-category revision copy
  // (title/guidance/example) when the backend sent it; legacy responses
  // without a category fall back to the generic message. The user's prompt
  // is never cleared — the dialog only closes so they can edit it.
  const [moderationWarning, setModerationWarning] = useState<{ message: string; violationCount: number; flagged: boolean; severity: string; title?: string; guidance?: string[]; exampleInstead?: string; exampleUse?: string; category?: string } | null>(null);

  const applySafetyBlock = (data: { error?: string; message?: string; title?: string; guidance?: string[]; example?: { instead?: string; use?: string }; category?: string; moderation?: { violationCount?: number; flagged?: boolean; severity?: string } }) => {
    setModerationWarning({
      title: data.title,
      message: data.message || data.error || 'This request cannot be processed.',
      guidance: Array.isArray(data.guidance) ? data.guidance : undefined,
      exampleInstead: data.example?.instead,
      exampleUse: data.example?.use,
      category: data.category,
      violationCount: data.moderation?.violationCount ?? 0,
      flagged: data.moderation?.flagged === true,
      severity: data.moderation?.severity || 'WARNING',
    });
  };
  const isSafetyBlockCode = (code: unknown) =>
    code === 'PROMPT_REQUIRES_REVISION' || code === 'PROMPT_BLOCKED' ||
    code === 'AI_MODERATION_BLOCKED' || code === 'CONTENT_SAFETY_BLOCKED';
  // Changing the visual prompt must always drop the previous refusal.
  //
  // The raw setter left generationError and any open denial dialog in place, so
  // after a blocked request the Step 4 panel kept rendering
  // "the image can't be generated" and the warning dialogs kept stacking up
  // even once the user had rewritten the prompt. The error text looked live
  // because nothing invalidated it, which reads as "I changed the prompt and it
  // is still failing" rather than "my previous attempt failed".
  //
  // generationError is shared with content generation, so this also clears an
  // unrelated stale content error that would otherwise be shown in the image
  // preview slot.
  const setImagePrompt = (v: string) => {
    setImagePromptRaw(v);
    setGenerationError('');
    setModerationWarning(null);
    setSafetyBlockedOpen(false);
  };
  const SAFETY_EXAMPLE_PROMPT = 'Modern office desk with a sleek tablet displaying a colorful analytics dashboard, warm morning light, photorealistic';
  const [statusMessage, setStatusMessage] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Off-canvas drawer state.
  //
  // The sidebar is position:fixed at 248px, so on a 390px phone it permanently
  // occupied 63% of the viewport and pushed the content column down to ~102px —
  // which is what left the last 22px of the page overflowing, and made mobile
  // unusable regardless of any width fix. Below 1024px it is now hidden off
  // canvas and opened deliberately by the hamburger.
  const [isNarrow, setIsNarrow] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Phone breakpoint: below 700px the sidebar becomes an off-canvas drawer.
  // Tablet (700–1023px) keeps a 72px icon rail (see railMode below) instead.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 699px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const sync = () => {
      setIsNarrow(mq.matches);
      // Leaving the mobile breakpoint must never strand an open drawer.
      if (!mq.matches) setMobileNavOpen(false);
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  // Scroll-lock the page behind an open drawer, and never leave it locked.
  useEffect(() => {
    if (!isNarrow) return;
    document.body.style.overflow = mobileNavOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileNavOpen, isNarrow]);
  // Any tab change is navigation: close the drawer behind it.
  useEffect(() => { setMobileNavOpen(false); }, [activeTab]);
  // Drawer overlay (phone, or tablet via hamburger) vs icon rail (tablet).
  // Desktop (>=1024px, !isNarrow) follows sidebarCollapsed exactly as before.
  const drawerOpen = isNarrow && mobileNavOpen;
  const railMode = !drawerOpen && (sidebarCollapsed || (isNarrow && !isMobile));
  const [draggedMediaId, setDraggedMediaId] = useState<string | null>(null);
  const [dragOverMediaId, setDragOverMediaId] = useState<string | null>(null);

  // WhatsApp publishing state. Naming kept stable to keep this patch scoped;
  // provider details are hidden behind /api/whatsapp routes.
  const [whapiConnected, setWhapiConnected] = useState(false);
  const [whapiChannelStatus, setWhapiChannelStatus] = useState('');
  const [whapiCanConnect, setWhapiCanConnect] = useState(false);
  const [whapiAccountName, setWhapiAccountName] = useState('');
  const [whapiPhoneMasked, setWhapiPhoneMasked] = useState('');
  const [whapiLoading, setWhapiLoading] = useState(false);
  const [whapiGroups, setWhapiGroups] = useState<Array<{ id: string; name: string; participantsCount: number; type: string; source?: 'community' | 'group' }>>([]);
  const [whapiSelectedGroupId, setWhapiSelectedGroupId] = useState('');
  // Multi-destination selection (communities + groups + chats). The picker
  // resolves each entry to a `sendId` at publish time — for a community that
  // is its announcement group, since Whapi rejects sends to a parent JID.
  const [whapiDestinations, setWhapiDestinations] = useState<Array<{ id: string; name: string; type: 'community' | 'group' | 'chat'; participantsCount: number; sendId: string }>>([]);
  const [whapiSelectedDestinations, setWhapiSelectedDestinations] = useState<Set<string>>(new Set());
  const [whapiGroupsLoading, setWhapiGroupsLoading] = useState(false);
  const [whapiGroupsError, setWhapiGroupsError] = useState('');
  const [whapiPublishing, setWhapiPublishing] = useState(false);
  const [whatsappConnectOpen, setWhatsappConnectOpen] = useState(false);
  const [whatsappQrImage, setWhatsappQrImage] = useState('');
  const [whatsappConnectMessage, setWhatsappConnectMessage] = useState('');
  const [whatsappConnecting, setWhatsappConnecting] = useState(false);
  // Server-authoritative QR lifecycle. The client must NOT derive "connected"
  // from anything except the server confirming THIS user's exact session:
  // generating a QR, holding a QR, or a stale provider-level AUTH flag are all
  // explicitly not connected.
  const [whatsappQrStatus, setWhatsappQrStatus] = useState<string>('');
  const [whatsappQrExpiresAt, setWhatsappQrExpiresAt] = useState<string | null>(null);
  const [whatsappQrSecondsLeft, setWhatsappQrSecondsLeft] = useState<number | null>(null);

  // ---- Reload persistence ----
  // Browsers forbid custom popups *during* a reload (beforeunload only gets
  // the native leave/stay dialog), so the two-choice popup lives right AFTER
  // the reload instead: work is autosaved continuously, and on load we ask
  // whether to keep it or start clean. Both buttons fully work - Keep
  // restores everything, Fresh wipes the saved draft and stays empty.
  // Namespaced by the signed-in user id. Previously a single global key, so a
  // second user on the same browser was offered the first user's draft to
  // restore. `null` while the id is still resolving.
  const DRAFT_KEY = useMemo(() => (userId ? userScopedKey(userId, 'draft') : null), [userId]);
  // Connected-account display cache. Namespaced for the same reason as the
  // draft: it holds account names, emails and Page ids, and was previously a
  // single global key that survived logout.
  const ACCOUNTS_KEY = useMemo(() => (userId ? userScopedKey(userId, 'accounts') : null), [userId]);
  // Pre-namespacing orphan store, kept readable for anyone who has not been
  // purged yet but now scoped so it cannot cross accounts.
  const LEGACY_DRAFTS_KEY = useMemo(() => (userId ? userScopedKey(userId, 'legacy-drafts') : null), [userId]);
  interface SavedDraft {
    prompt: string; tone: string; imageStyle: string; aspectRatio: string;
    content: string; platformContent: Record<string, { caption: string; hashtags: string[] }>;
    imagePrompt: string; activePreviewPlatform: string; selectedPlatforms: string[];
    mediaItems: MediaItem[]; topicMediaItems: MediaItem[];
    generatedImage: string; generatedVideo: string; mediaType: 'image' | 'video' | null;
    originals: Record<string, string>; burnedLogoIds: Record<string, boolean>;
    logoImage: string; logoPosition: string; logoScale: number; logoOpacity: number;
    mediaSkipped?: boolean; savedAt: number;
    wizardState?: Record<string, unknown>; activeTab?: typeof activeTab; draftId?: string;
    isCarousel?: boolean; carouselSlideIds?: string[]; carouselSlideCount?: number;
    trialReel?: boolean; collaborators?: Collaborator[]; collaborator?: string; instagramPostUrl?: string;
    scheduleDate?: string; scheduleTime?: string; editorTab?: 'edit' | 'preview';
    canvaReadyId?: string; canvaSession?: CanvaSession | null; canvaLastImportedReadyId?: string; path?: string;
  }
  const captureEditor = (): SavedDraft => ({
    prompt, tone, imageStyle, aspectRatio, content, platformContent, imagePrompt,
    activePreviewPlatform, selectedPlatforms, mediaItems, topicMediaItems,
    generatedImage, generatedVideo, mediaType, originals: originalMediaRef.current,
    burnedLogoIds, logoImage, logoPosition, logoScale, logoOpacity, savedAt: Date.now(),
wizardState, activeTab, draftId, isCarousel, carouselSlideIds, carouselSlideCount, trialReel, collaborators, instagramPostUrl,
    scheduleDate, scheduleTime, editorTab, canvaReadyId, canvaSession, canvaLastImportedReadyId,
    path: window.location.pathname + window.location.search + window.location.hash,
  });
  const notify = (message: string, error = false) => {
    setPublishResult(message); setPublishResultType(error ? 'error' : 'success'); setShowToast(true);
    setTimeout(() => setShowToast(false), 6000);
  };
  const [oauthRestoring, setOauthRestoring] = useState(true);
  useEffect(() => { if (!new URLSearchParams(location.search).has('editor_return')) Promise.resolve().then(() => setOauthRestoring(false)); }, []);
  const [restorePromptOpen, setRestorePromptOpen] = useState(false);
  const [savedDraft, setSavedDraft] = useState<SavedDraft | null>(null);

  const draftIsMeaningful = (d: SavedDraft) =>
    !!(d.prompt?.trim() || d.content?.trim() || d.mediaItems?.length || d.topicMediaItems?.length || d.generatedImage || d.generatedVideo);

  // Runs first on mount (declared before the autosaver below): offer restore.
  // Skipped for Canva return-navigation landings (?correlation_jwt=): that
  // tab is about to relay to /api/canva/return, never a workspace.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('editor_return')) return;
    if (new URLSearchParams(window.location.search).has('correlation_jwt')) return;
    // Wait for the signed-in id: reading an unscoped key here is exactly the
    // cross-user leak this guards against.
    if (!DRAFT_KEY) return;
    let local: SavedDraft | null = null;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as SavedDraft;
        if (d && draftIsMeaningful(d)) local = d;
        else localStorage.removeItem(DRAFT_KEY);
      }
    } catch { /* corrupt draft - start clean */ }
    // Server copy keeps full images (localStorage strips them past ~4MB):
    // offer whichever draft is newer.
    let cancelled = false;
    fetch('/api/editor-draft').then(r => r.json()).then((data: { draft?: SavedDraft }) => {
      if (cancelled) return;
      const s = data?.draft;
      const server = s && draftIsMeaningful(s) ? s : null;
      const pick = server && (!local || (server.savedAt || 0) >= (local.savedAt || 0)) ? server : local;
      if (pick) {
        setSavedDraft(pick);
        setRestorePromptOpen(true);
      }
    }).catch(() => {
      if (!cancelled && local) {
        setSavedDraft(local);
        setRestorePromptOpen(true);
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [DRAFT_KEY]);

  // Autosave everything that rebuilds the workspace (debounced). Skipped
  // while the restore popup is awaiting a choice, so we never clobber the
  // saved draft before the user picks Keep or Fresh.
  useEffect(() => {
    if (restorePromptOpen || oauthRestoring) return;
    // Never write user state before we know whose it is.
    if (!DRAFT_KEY) return;
    const t = setTimeout(() => {
      const draft: SavedDraft = captureEditor();
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
        localStorage.setItem(DRAFT_KEY!, JSON.stringify(draft));
      } catch {
        try {
          localStorage.setItem(DRAFT_KEY!, JSON.stringify({
            ...draft, mediaItems: [], topicMediaItems: [], generatedImage: '', generatedVideo: '', logoImage: '', mediaSkipped: true,
          }));
        } catch { /* storage unavailable - session simply won't restore */ }
      }
      // Mirror the FULL draft (images included — `full` was captured before
      // stripping) to the server, so a later "Keep my content" restores the
      // previous image instead of dropping it. Fire-and-forget: the local
      // copy still applies if the server is unreachable.
      if (draftIsMeaningful(draft) && full.length <= 25_000_000) {
        fetch('/api/editor-draft', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          // `full` is already valid JSON of the pre-strip draft — wrap it
          // without a wasteful re-parse/restringify round-trip.
          body: `{"draft":${full}}`,
        }).catch(() => { /* offline/server down - local copy still applies */ });
      }
    }, 800);
    return () => clearTimeout(t);
  }, [oauthRestoring, wizardState, activeTab, draftId, isCarousel, carouselSlideIds, carouselSlideCount, trialReel, scheduleDate, scheduleTime, editorTab, canvaReadyId, canvaSession, canvaLastImportedReadyId, restorePromptOpen, prompt, tone, imageStyle, aspectRatio, content, platformContent, imagePrompt, activePreviewPlatform, selectedPlatforms, mediaItems, topicMediaItems, generatedImage, generatedVideo, mediaType, burnedLogoIds, logoImage, logoPosition, logoScale, logoOpacity]);

  const restoreEditor = (d: SavedDraft | null) => {
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
      setWizardState(d.wizardState || {}); setDraftId(d.draftId);
      setActiveTab(d.activeTab || 'studio'); setIsCarousel(!!d.isCarousel);
      setCarouselSlideIds(d.carouselSlideIds || []); setCarouselSlideCount(d.carouselSlideCount || 4);
      setTrialReel(!!d.trialReel); setCollaborators(normalizeLegacyCollaborator(d) || []); setInstagramPostUrl(d.instagramPostUrl || '');
      setScheduleDate(d.scheduleDate || ''); setScheduleTime(d.scheduleTime || '');
      setEditorTab(d.editorTab || 'preview'); setCanvaReadyId(d.canvaReadyId || '');
      setCanvaSession(d.canvaSession || null); setCanvaLastImportedReadyId(d.canvaLastImportedReadyId || '');
      if (d.mediaSkipped) {
        setPublishResult('Previous work restored (images were too large to keep and were skipped).');
        setPublishResultType('success'); setShowToast(true); setTimeout(() => setShowToast(false), 4000);
      }
    }
    setSavedDraft(null);
    setRestorePromptOpen(false);
  };

  const keepRestoredDraft = () => restoreEditor(savedDraft);

  const discardSavedDraft = () => {
    try { if (DRAFT_KEY) localStorage.removeItem(DRAFT_KEY); } catch {}
    fetch('/api/editor-draft', { method: 'DELETE' }).catch(() => {});
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
    // LinkedIn/Facebook/Instagram accounts pulled out of whatever was cached
    // (if anything) - used only to preserve display fields like name/pages
    // across a refresh while the real status checks below confirm them.
    let linkedinAccount: SocialAccount | undefined;
    let facebookAccount: SocialAccount | undefined;
    let instagramAccount: SocialAccount | undefined;

    if (!ACCOUNTS_KEY) return;
    const saved = localStorage.getItem(ACCOUNTS_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as SocialAccount[];
        // Scrub any legacy tokens left in browser storage from older versions.
        const scrubbed = parsed.map(a => {
          const { accessToken: _dropped, ...rest } = a;
          void _dropped;
          return rest as SocialAccount;
        });

        // LinkedIn's, Facebook's and Instagram's cached cards can go stale -
        // a post-OAuth redirect that broke before the page could update it,
        // a reload, a different tab, or a token since expired/revoked/
        // disconnected on the platform's side - so never display them on
        // trust alone. Hold all three back and only show them once the
        // server vault actually confirms the connection still works
        // (mirrors Canva's server-verified status check below).
        linkedinAccount = scrubbed.find(a => a.platform === 'linkedin');
        facebookAccount = scrubbed.find(a => a.platform === 'facebook');
        instagramAccount = scrubbed.find(a => a.platform === 'instagram');
        const rest = scrubbed.filter(a => a.platform !== 'linkedin' && a.platform !== 'facebook' && a.platform !== 'instagram');
        setAccounts(rest);
        localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(rest));
      } catch { /* ignore corrupt cache - status checks below still run unconditionally */ }
    }

    {
      // Always check, even with nothing cached in this tab (or no cache at
      // all - a fresh browser, a cleared/incognito session) - the server
        // falls back to whatever single account the vault holds, so this
        // self-heals a tab whose localStorage never saw the OAuth redirect
        // (same reasoning as the Facebook check below).
        // A cached userId can ALSO go stale the other way: disconnect /
        // reconnect cycles mint a new vault id while the browser still holds
        // the old one, and the scoped check then reports "disconnected" even
        // though the vault holds a live account - leaving Publish permanently
        // disabled with "Connect first". So a scoped miss retries once
        // without the id (server falls back to its held account).
        const fetchStatusWithFallback = <T,>(base: string, cachedUserId?: string): Promise<T> =>
          fetch(cachedUserId ? `${base}?userId=${encodeURIComponent(cachedUserId)}` : base)
            .then(res => res.json() as Promise<T>)
            .then(data => (((data as unknown as { connected?: boolean }).connected || !cachedUserId)
              ? data
              : fetch(base).then(r => r.json() as Promise<T>)));
        fetchStatusWithFallback<{ connected: boolean; userId?: string; name?: string; email?: string }>('/api/linkedin/status', linkedinAccount?.userId)
          .then((data: { connected: boolean; userId?: string; name?: string; email?: string }) => {
            if (!data.connected || !data.userId) return; // stale/expired/nothing stored - stays out of the list
            const base = linkedinAccount?.userId === data.userId ? linkedinAccount : undefined;
            setAccounts(prev => {
              const updated = [...prev.filter(a => a.platform !== 'linkedin'), { platform: 'linkedin', connected: true, userId: data.userId!, name: data.name || base?.name || 'LinkedIn', email: data.email || base?.email || '' }];
              localStorage.setItem(ACCOUNTS_KEY!, JSON.stringify(updated));
              return updated;
            });
          })
          .catch(() => { /* transient failure reaching our own status route - leave it disconnected for this load rather than trust the cache */ });

        // Always check, even with nothing cached: unlike LinkedIn, the vault
        // lookup here doesn't require a userId the browser already knows -
        // the server falls back to whatever single account it holds. That's
        // what lets this self-heal when the OAuth redirect landed on a
        // different tab/origin than the one currently open, instead of
        // requiring a matching cached entry to even attempt the check.
        fetchStatusWithFallback<{ connected: boolean; userId?: string; name?: string; pages?: Array<{ id: string; name: string }> }>('/api/facebook/status', facebookAccount?.userId)
          .then((data: { connected: boolean; userId?: string; name?: string; pages?: Array<{ id: string; name: string }> }) => {
            if (!data.connected || !data.userId) return; // stale/expired/nothing stored - stays out of the list
            const base = facebookAccount?.userId === data.userId ? facebookAccount : undefined;
            const pages = data.pages && data.pages.length ? data.pages : base?.pages;
            const pageId = pages?.some(p => p.id === base?.pageId) ? base?.pageId : pages?.[0]?.id;
            setAccounts(prev => {
              const updated = [...prev.filter(a => a.platform !== 'facebook'), { platform: 'facebook', connected: true, userId: data.userId!, name: data.name || base?.name || 'Facebook', email: base?.email || '', pages, pageId }];
              localStorage.setItem(ACCOUNTS_KEY!, JSON.stringify(updated));
              return updated;
            });
          })
          .catch(() => { /* transient failure reaching our own status route - leave it disconnected for this load rather than trust the cache */ });

        // Instagram has no login of its own - it's derived from whichever
        // Facebook Page has a linked Instagram Business account, so this
        // check needs no separate OAuth redirect to have landed; it just
        // needs Facebook to be connected with the right scopes. Same
        // fallback-to-any-account pattern as the Facebook check above.
        fetchStatusWithFallback<{ connected: boolean; userId?: string; username?: string; igUserId?: string; pageId?: string }>('/api/instagram/status', instagramAccount?.userId)
          .then((data: { connected: boolean; userId?: string; username?: string; igUserId?: string; pageId?: string }) => {
            if (!data.connected || !data.userId) return; // Facebook not connected, or no Page has Instagram linked
            setAccounts(prev => {
              const updated = [...prev.filter(a => a.platform !== 'instagram'), { platform: 'instagram', connected: true, userId: data.userId!, name: data.username ? `@${data.username}` : 'Instagram', email: '', igUserId: data.igUserId, pageId: data.pageId }];
              localStorage.setItem(ACCOUNTS_KEY!, JSON.stringify(updated));
              return updated;
            });
          })
          .catch(() => { /* transient failure reaching our own status route - leave it disconnected for this load rather than trust the cache */ });
    }

    const params = new URLSearchParams(window.location.search);
    if (params.has('editor_return')) return;
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
        window.history.replaceState({}, '', window.location.pathname);
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
        localStorage.setItem(ACCOUNTS_KEY!, JSON.stringify(updated));
        return updated;
      });
      setPublishResult(`${platform.charAt(0).toUpperCase() + platform.slice(1)} connected successfully!`);
      setPublishResultType('success');
      setShowToast(true);
      setJustConnectedPlatform(platform);
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(() => setShowToast(false), 4000);
      setTimeout(() => setJustConnectedPlatform(null), 2600);
    }
  }, []);

  // WhatsApp status comes through the SocialPulse backend; provider details
  // stay server-side and out of normal client UI.
  const refreshWhapiStatus = async () => {
    setWhapiLoading(true);
    try {
      const res = await fetch('/api/whatsapp/status');
      const data = await res.json();
      setWhapiConnected(!!data.connected);
      setWhapiChannelStatus(data.status || '');
      setWhapiAccountName(data.accountName || '');
      setWhapiPhoneMasked(data.phoneMasked || '');
      setWhapiCanConnect(!!data.canStartConnect);
      if (data.connected) setWhatsappConnectOpen(false);
      return !!data.connected;
    } catch {
      setWhapiConnected(false);
      setWhapiChannelStatus('ERROR');
      return false;
    } finally {
      setWhapiLoading(false);
    }
  };

  const startWhatsAppConnect = async () => {
    if (whatsappConnecting) return;
    setWhatsappConnectOpen(true);
    setWhatsappConnecting(true);
    setWhatsappQrImage('');
    setWhatsappConnectMessage('');
    setWhatsappQrExpiresAt(null);
    setWhatsappQrSecondsLeft(null);
    try {
      const res = await fetch('/api/whatsapp/connect', { method: 'POST' });
      const data = await res.json();
      setWhatsappQrStatus(data.status || '');
      // Already-connected short circuit: the server refuses to mint a new
      // session when a healthy connection exists (doing so would unlink the
      // paired device). Reflect that immediately instead of showing a QR the
      // user has no reason to scan.
      if (data.status === 'CONNECTED') {
        setWhatsappConnectOpen(false);
        setWhatsappQrImage('');
        void refreshWhapiStatus();
        return;
      }
      // Prefer the PROVIDER's real remaining lifetime (often only ~15-40s) over
      // our own 5-minute bookkeeping TTL. Counting down from 5 minutes told the
      // user they had ample time while the code on screen was already dead —
      // which is what made WhatsApp answer "couldn't link device".
      if (typeof data.qrExpiresInSeconds === 'number') {
        setWhatsappQrExpiresAt(new Date(Date.now() + data.qrExpiresInSeconds * 1000).toISOString());
        setWhatsappQrSecondsLeft(data.qrExpiresInSeconds);
      } else {
        setWhatsappQrExpiresAt(data.qrExpiresAt || null);
      }
      // A QR having been generated is NOT a connection. The only branch that
      // flips the UI to connected is the poll below confirming this exact
      // session, so this handler never does it.
      if (data.qrImage) {
        setWhatsappQrImage(data.qrImage);
        setWhatsappConnectMessage(data.message || 'Open WhatsApp on your phone, go to Linked Devices, and scan this QR code.');
      } else {
        setWhatsappConnectMessage(data.message || 'WhatsApp connection could not be completed. Please try again.');
      }
    } catch {
      setWhatsappConnectMessage('WhatsApp connection could not be completed. Please try again.');
    } finally {
      setWhatsappConnecting(false);
    }
  };

  // Abandons a pending QR. Server-side this moves the row to CANCELLED so a
  // late scan cannot connect an attempt the user walked away from.
  const cancelWhatsAppQr = async () => {
    try {
      await fetch('/api/whatsapp/cancel', { method: 'POST' });
    } catch { /* the row expires on its own either way */ }
    setWhatsappConnectOpen(false);
    setWhatsappQrImage('');
    setWhatsappQrExpiresAt(null);
    setWhatsappQrSecondsLeft(null);
    setWhatsappQrStatus('CANCELLED');
    setWhatsappConnectMessage('QR code cancelled.');
  };

  // Counts the QR down using the provider's own remaining lifetime.
  //
  // This is the difference between a QR the user can actually scan and one
  // that has already died: Whapi's pairing codes are valid for roughly 15-40
  // seconds, and WhatsApp answers "couldn't link device" for an expired code.
  // Hitting zero retires the image so the modal offers Generate New QR rather
  // than leaving an unscannable code on screen.
  useEffect(() => {
    if (!whatsappConnectOpen || whatsappQrStatus !== 'WAITING_FOR_SCAN') return;
    if (whatsappQrSecondsLeft === null) return;
    const id = setInterval(() => {
      setWhatsappQrSecondsLeft((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          setWhatsappQrStatus('EXPIRED');
          setWhatsappQrImage('');
          setWhatsappConnectMessage('This QR code expired. Generate a new one to continue.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [whatsappConnectOpen, whatsappQrStatus, whatsappQrSecondsLeft === null]);

  // Unified destination loader — communities + groups + chats in one list.
  // Replaces the older groups-only loader, which could not represent 1:1 chats
  // and force-disabled communities.
  const loadWhapiDestinations = async (force = false) => {
    if (whapiGroupsLoading) return [];
    setWhapiGroupsLoading(true);
    setWhapiGroupsError('');
    try {
      const res = await fetch(`/api/whapi/destinations${force ? '?refresh=1' : ''}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        const msg = typeof data.message === 'string' ? data.message : 'WhatsApp destinations could not be loaded.';
        setWhapiGroupsError(msg);
        return [];
      }
      const list: Array<{ id: string; name: string; type: 'community' | 'group' | 'chat'; participantsCount: number; sendId: string }> =
        Array.isArray(data.destinations) ? data.destinations : [];
      setWhapiDestinations(list);
      // Drop selections that no longer exist so publish can't target a stale id.
      setWhapiSelectedDestinations(prev => {
        const valid = new Set(list.map((d) => d.id));
        const next = new Set([...prev].filter((id) => valid.has(id)));
        return next.size === prev.size ? prev : next;
      });
      // Keep the legacy single-select in sync for the scheduler path.
      if (list.length && !whapiSelectedGroupId) {
        const first = list.find((d) => d.type !== 'community') || list[0];
        setWhapiSelectedGroupId(first.id);
      }
      return list;
    } catch (e) {
      setWhapiGroupsError(e instanceof Error ? e.message : 'Failed to load WhatsApp destinations');
      return [];
    } finally {
      setWhapiGroupsLoading(false);
    }
  };

  const loadWhapiGroups = async () => {
    if (whapiGroupsLoading) return;
    setWhapiGroupsLoading(true);
    setWhapiGroupsError('');
    try {
      // Fetch BOTH sources in parallel: community announcement pairs AND the
      // full group list, then reconcile by id (trust /groups typing when the
      // communities endpoint is in fallback echo mode).
      const [commRes, allRes] = await Promise.all([
        fetch('/api/whatsapp/communities'),
        fetch('/api/whapi/groups?count=500&offset=0'),
      ]);
      const commData = await commRes.json().catch(() => ({}));
      const allData = await allRes.json().catch(() => ({}));
      // Communities is slow (8-22s for 13 subgroups fetches) — don't let it block groups.
      // If it fails, show groups anyway and warn.
      let commOk = commRes.ok && !!commData.success;
      if (!commOk) {
        console.warn('[loadWhapiGroups] communities failed, showing groups only:', commData?.message || commRes.status);
      }
      const communityGroups: Array<{ id: string; name: string; participantsCount: number; type: string; source: 'community' | 'group' }> = (commOk && Array.isArray(commData.communities))
        ? commData.communities.map((c: { announcementGroupId: string; name: string; announcementGroupName?: string; participantsCount?: number }) => ({
          id: c.announcementGroupId,
          name: c.name || c.announcementGroupName || 'WhatsApp Community',
          participantsCount: c.participantsCount || 0,
          type: 'announcement_group',
          source: 'community' as const,
        }))
        : [];
      // Paginate the full groups list when total exceeds the first page.
      let allGroupsRaw: Array<{ id: string; name: string; participantsCount?: number; type?: string; isParent?: boolean; isCommunityAnnounce?: boolean }> =
        Array.isArray(allData.groups) ? allData.groups : [];
      const total = typeof allData.total === 'number' ? allData.total : allGroupsRaw.length;
      if (allRes.ok && allData.success !== false && total > allGroupsRaw.length) {
        for (let offset = allGroupsRaw.length; offset < Math.min(total, 2000); offset += 500) {
          try {
            const r = await fetch(`/api/whapi/groups?count=500&offset=${offset}`);
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !Array.isArray(d.groups) || d.groups.length === 0) break;
            allGroupsRaw = allGroupsRaw.concat(d.groups);
            if (d.groups.length < 500) break;
          } catch { break; }
        }
      }
      const regularById = new Map(allGroupsRaw
        .filter(g => g && typeof g.id === 'string')
        .map(g => {
          const t = String(g.type || 'group').toLowerCase();
          const type = (t === 'announcement' || t === 'announcement_group') ? 'announcement_group' : t === 'community' ? 'community' : 'group';
          return [String(g.id), {
            id: String(g.id),
            name: String(g.name || 'Unnamed Group'),
            participantsCount: typeof g.participantsCount === 'number' ? g.participantsCount : 0,
            type,
            source: 'group' as const,
          }] as const;
        }));
      // Reconcile: keep REAL communities (participantsCount > 0 from /communities)
      // as Community entries and dedupe them out of the regular list. Only collapse
      // the old fallback-echo case (count 0 + same name) back to a regular group.
      const mergedCommunities = communityGroups.map(c => {
        const r = regularById.get(c.id);
        if (!r) return c;
        regularById.delete(c.id);
        const cCount = c.participantsCount || 0;
        const rCount = r.participantsCount || 0;
        if (cCount > 0) return { ...c, participantsCount: Math.max(cCount, rCount) };
        if (r.type === 'group' && (cCount === 0 || c.name === r.name)) return r;
        return { ...c, participantsCount: Math.max(cCount, rCount) };
      });
      // Communities first (by name), then regular groups (by name).
      const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
      const groups = [
        ...mergedCommunities.sort(byName),
        ...[...regularById.values()].sort(byName),
      ];
      setWhapiGroups(groups);
      // Auto-select first sendable group if none selected (skip community parents only —
      // Whapi /groups list returns participants_count=0 for all groups, so count can't gate this)
      if (groups.length && !whapiSelectedGroupId) {
        const sendable = groups.find((g) => g.type !== 'community');
        setWhapiSelectedGroupId((sendable || groups[0]).id);
      }
      return groups;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to fetch groups';
      setWhapiGroupsError(msg);
      return [];
    } finally {
      setWhapiGroupsLoading(false);
    }
  };

  // Auto-resolve the QR prompt when the user scans — mirrors the phone-app
  // behaviour: while the connect modal is open and not yet connected, poll
  // the server status every 3s, then close the modal and reload the chat
  // list on success (fresh syncs change group metadata, so stale lists must
  // not stick). No manual "Check Status" tap needed. Skips hidden tabs and
  // concurrent ticks.
  useEffect(() => {
    if (!whatsappConnectOpen || whapiConnected || whatsappConnecting) return;
    let stopped = false;
    let inFlight = false;
    const poll = async () => {
      if (stopped || inFlight || document.hidden) return;
      inFlight = true;
      try {
        // poll=1 is REQUIRED while the QR modal is open. Without it the route
        // only reads state and never calls pollWhatsAppConnection, which is the
        // ONLY code path that can promote WAITING_FOR_SCAN to CONNECTED — so
        // the scan would be detected by nobody and the row would never bind.
        const url = whatsappConnectOpen ? '/api/whatsapp/status?poll=1' : '/api/whatsapp/status';
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        if (stopped) return;
        if (data) setWhapiCanConnect(!!data.canStartConnect);
        if (data && whatsappConnectOpen) {
          // Keep the modal's own status chip in step with the server so an
          // expiry is actually visible, and drop the stale image rather than
          // leaving an unscannable code on screen.
          setWhatsappQrStatus(data.status || '');
          // Terminal states own the copy, because the QR they refer to is gone.
          if (data.status === 'EXPIRED' || data.status === 'CANCELLED') {
            setWhatsappQrImage('');
            setWhatsappQrSecondsLeft(null);
            setWhatsappConnectMessage(
              data.status === 'CANCELLED'
                ? 'QR code cancelled.'
                : 'This QR code expired. Generate a new one to continue.',
            );
          }
          // Deliberately NOT copying the generic status copy here. The status
          // endpoint always carries a message ("Scan a QR code with WhatsApp to
          // connect your account"), and overwriting the modal with it every 3s
          // buried whatever Connect actually said — including a real refusal
          // such as "already connected to another account", which then rendered
          // as an empty modal with no QR and no explanation.
        }
        if (data && data.connected) {
          setWhapiConnected(true);
          setWhapiChannelStatus(data.status || '');
          setWhapiAccountName(data.accountName || '');
          setWhapiPhoneMasked(data.phoneMasked || '');
          setWhatsappConnectOpen(false);
          setWhatsappQrImage('');
          setWhatsappConnectMessage('WhatsApp connected.');
          setPublishResult('WhatsApp connected successfully!');
          setPublishResultType('success');
          setShowToast(true);
          setTimeout(() => setShowToast(false), 4000);
          // Group metadata changes across reconnects — reload so the picker
          // never shows a stale (e.g. all-disabled) list.
          void loadWhapiGroups();
        }
      } catch { /* transient failure — next tick retries */ }
      finally { inFlight = false; }
    };
    const id = setInterval(poll, 3000);
    return () => { stopped = true; clearInterval(id); };
  }, [whatsappConnectOpen, whapiConnected, whatsappConnecting]);

  // Publish responses occasionally arrive as a non-JSON body (proxy error page,
  // empty 502, truncated response). `res.json()` then throws and a bare
  // `.catch(() => ({}))` silently degrades the failure into a useless generic
  // string like "Failed to publish to WhatsApp group." — no code, no status, no
  // reason. Read the text first and keep whatever detail is really there,
  // falling back to the HTTP status so the cause is never fully lost.
  const readPublishResponse = async (res: Response): Promise<Record<string, unknown>> => {
    const raw = await res.text().catch(() => '');
    if (!raw) return { message: `Request failed (HTTP ${res.status}).` };
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { message: raw.slice(0, 200) };
    }
  };

  const publishReason = (data: Record<string, unknown>, res: Response, fallback: string): string => {
    const message = typeof data.message === 'string' ? data.message.trim() : '';
    if (message) return message;
    const code = typeof data.code === 'string' ? data.code : '';
    return code ? `${code} (HTTP ${res.status})` : `${fallback} (HTTP ${res.status})`;
  };

  const publishToWhapi = async () => {
    if (whapiPublishing || isPublishing || publishCooldown > 0) return;
    if (!whapiConnected) {
      setPublishResult('WhatsApp is not connected.');
      setPublishResultType('error'); setShowToast(true); setTimeout(() => setShowToast(false), 4000); return;
    }
    // Resolve the multi-selection into concrete send targets. Each destination
    // carries its own sendId — for a community that is the announcement group,
    // because Whapi refuses sends to a community parent JID.
    const targets = whapiDestinations
      .filter((d) => whapiSelectedDestinations.has(d.id))
      .map((d) => ({ id: d.id, name: d.name, sendId: d.sendId, type: d.type }));
    if (targets.length === 0) {
      setPublishResult('Select at least one chat, group or community.');
      setPublishResultType('error'); setShowToast(true); setTimeout(() => setShowToast(false), 4000); return;
    }
    if (!content.trim() && publishMediaList.length === 0 && !generatedImage && !generatedVideo) {
      setPublishResult('Add content or media before publishing to WhatsApp.');
      setPublishResultType('error'); setShowToast(true); setTimeout(() => setShowToast(false), 4000); return;
    }
    // One click = one request per destination, no hidden retries, reuse cooldown guard
    const publishingRefLocal = publishingRef;
    if (publishingRefLocal.current) return;
    publishingRefLocal.current = true;
    setWhapiPublishing(true);
    setIsPublishing(true);
    try {
      const attemptId = `whatsapp_${crypto.randomUUID()}`;
      const mediaForWhapi = publishMediaList.slice(0, 1);
      // If no explicit media but we have a generatedImage, include it
      const effectiveMedia = mediaForWhapi.length ? mediaForWhapi : (generatedImage ? [{ id: 'gen', url: generatedImage, type: 'image' as const }] : []);
      const rawText = content.trim() || platformContent[activePreviewPlatform]?.caption || '';
      const isWhapp = activePreviewPlatform === 'whatsapp';
      // WhatsApp: no hashtags ever — strip every #tag anywhere in the text.
      const text = isWhapp
        ? stripAllHashtags(rawText)
        : (() => { const baseText = stripTrailingHashtags(rawText); const tags = platformContent[activePreviewPlatform]?.hashtags || []; return baseText ? (tags.length ? `${baseText}\n\n${formatHashtags(tags)}` : baseText) : rawText; })();

      // Fan out sequentially: WhatsApp rate-limits, and a burst to N chats
      // invites throttling. Per-target failures are collected, not fatal —
      // one unsendable chat must not cancel the rest.
      const succeeded: string[] = [];
      const failed: Array<{ name: string; reason: string }> = [];

      for (const t of targets) {
        try {
          const res = await fetch('/api/whatsapp/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              groupId: t.sendId,
              text,
              mediaList: effectiveMedia,
              attemptId: `${attemptId}_${t.id}`,
            }),
          });
          const data = await readPublishResponse(res);
          if (res.ok && data.success) {
            succeeded.push(t.name);
          } else {
            failed.push({ name: t.name, reason: publishReason(data, res, 'Publish failed') });
          }
        } catch {
          failed.push({ name: t.name, reason: 'Network error.' });
        }
      }

      if (succeeded.length > 0) {
        setPublishSuccessFlash(true);
        setPublishCooldown(10);
        setTimeout(() => setPublishSuccessFlash(false), 2200);
      }

      if (failed.length === 0) {
        setPublishResult(
          `WhatsApp message sent to ${succeeded.length} destination${succeeded.length === 1 ? '' : 's'} ✓`,
        );
        setPublishResultType('success');
      } else if (succeeded.length === 0) {
        setPublishResult(`WhatsApp publish failed for all ${failed.length} destination${failed.length === 1 ? '' : 's'}: ${failed[0].reason}`);
        setPublishResultType('error');
      } else {
        // Partial success is still a success — say exactly what landed.
        const detail = failed.slice(0, 3).map((f) => `${f.name}: ${f.reason}`).join(' • ');
        const more = failed.length > 3 ? ` (+${failed.length - 3} more)` : '';
        setPublishResult(`Sent to ${succeeded.length}/${targets.length}. Failed — ${detail}${more}`);
        setPublishResultType('error');
      }
    } catch {
      setPublishResult('Network error sending to WhatsApp.');
      setPublishResultType('error');
    }
    setShowToast(true);
    publishingRefLocal.current = false;
    setWhapiPublishing(false);
    setIsPublishing(false);
    setTimeout(() => setShowToast(false), 5000);
  };

  // Connection status always comes from the server (never faked/assumed from
  // a client-side flag) - the token itself only ever lives in httpOnly cookies.
  const refreshCanvaStatus = async () => {
    try {
      const res = await fetch('/api/canva/status');
      const data = await res.json();
      setCanvaConnected(!!data.connected);
      setCanvaName(data.displayName || '');
      return !!data.connected;
    } catch {
      setCanvaConnected(false);
      return false;
    }
  };

  // Auto-load WhatsApp communities lazily when connected, but only once per session to avoid blocking page.
  useEffect(() => {
    if (whapiConnected && whapiDestinations.length === 0 && !whapiGroupsLoading && !whapiGroupsError) {
      void loadWhapiDestinations();
    }
  }, [whapiConnected]);

  useEffect(() => {
    refreshCanvaStatus();
    refreshWhapiStatus();

    const params = new URLSearchParams(window.location.search);
    if (params.has('editor_return')) return;
    // Canva's portal Return URL points at the bare domain, so the editor's
    // return navigation lands HERE (not /content-studio) with
    // ?correlation_jwt=... Relay it to /api/canva/return, which verifies the
    // JWT, marks the design ready, and lands this tab on /canva-return - the
    // original SocialPulse tab (the opener) receives the ready id via
    // postMessage and never moves. Without this relay the JWT is ignored and
    // the tab sits on a fresh Step 1 with a restore prompt.
    const correlationJwt = params.get('correlation_jwt');
    if (correlationJwt) {
      window.location.replace(`/api/canva/return?correlation_jwt=${encodeURIComponent(correlationJwt)}`);
      return;
    }
    const canvaConnectedParam = params.get('canva_connected');
    const canvaNameParam = params.get('canva_name');
    const canvaReadyParam = params.get('canva_ready');
    const error = params.get('error');

    if (canvaConnectedParam === 'true') {
      // Optimistic UI for the moment right after OAuth; refreshCanvaStatus()
      // above is still the source of truth for every subsequent page load.
      setCanvaConnected(true);
      setCanvaName(canvaNameParam || 'Canva');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (canvaReadyParam) {
      // Back from the Canva editor - the design is ready to import, but we
      // only export it once the user explicitly clicks "Import from Canva".
      setCanvaReadyId(canvaReadyParam);
      window.history.replaceState({}, '', window.location.pathname);
    } else if (error?.startsWith('CANVA_')) {
      setGenerationError(CANVA_ERROR_MESSAGES[error] || `Canva error: ${error}`);
      window.history.replaceState({}, '', window.location.pathname);
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
        setGenerationError(CANVA_ERROR_MESSAGES[d.code] || `Canva error: ${d.code}`);
      }
    };
    window.addEventListener('message', onCanvaMessage);
    return () => window.removeEventListener('message', onCanvaMessage);
  }, []);

  const loadScheduledPosts = async () => {
    try {
      const res = await fetch('/api/scheduler');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Cannot load posts');
      setAllPosts((data.posts || []).map((p: PostRecord) => ({ ...p, scheduledAt: p.scheduledAt || '' })));
    } catch { /* ignore */ }
  };

  useEffect(() => {
    loadScheduledPosts();
  }, []);

  const [isCheckingDue, setIsCheckingDue] = useState(false);
  const checkDuePosts = async (silent = false) => {
    if (!silent) setIsCheckingDue(true);
    try {
      const res = await fetch('/api/scheduler/check', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      await loadScheduledPosts();
      if (!silent) {
        const n = typeof data.publishedCount === 'number' ? data.publishedCount : 0;
        setPublishResult(n > 0 ? `Published ${n} due post${n === 1 ? '' : 's'}` : 'No due posts to publish');
        setPublishResultType('success');
      }
    } catch {
      if (!silent) {
        setPublishResult('Failed to check due posts');
        setPublishResultType('error');
      }
    }
    if (!silent) {
      setShowToast(true);
      setTimeout(() => setShowToast(false), 4000);
    }
    if (!silent) setIsCheckingDue(false);
  };

  // Due-post execution is deliberately NOT driven from the browser. It is
  // owned exclusively by scheduler-service's own 15s worker, which claims due
  // rows atomically (FOR UPDATE SKIP LOCKED). The 60s + visibilitychange poll
  // that used to live here called POST /api/scheduler/check, which the gateway
  // gates to SUPERADMIN — so for every regular user it was a guaranteed 403
  // every minute that could never publish anything, while leaving a
  // client-controlled dispatch path into the executor. Removed on purpose; the
  // SUPERADMIN-only "Check now" button still calls checkDuePosts(), because an
  // explicit operator action is legitimate.

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

  const schedulingRef = useRef(false);
  const draftSavingRef = useRef(false);
  const schedulePost = async () => {
    if (schedulingRef.current) return;
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
      p === 'whatsapp' ? whapiConnected : accounts.some(a => a.platform === p && a.connected)
    );
    if (connectedSelected.length === 0) {
      setPublishResult('No connected platforms selected');
      setPublishResultType('error');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 4000);
      return;
    }
    if (connectedSelected.includes('whatsapp') && !whapiSelectedGroupId) {
      setPublishResult('Select a WhatsApp chat before scheduling.');
      setPublishResultType('error');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 4000);
      return;
    }
    if (isCarousel && !carouselValidation.valid) {
      setPublishResult(`Carousel not ready: ${carouselValidation.reason}`);
      setPublishResultType('error');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 4000);
      return;
    }

    schedulingRef.current = true;
    setIsScheduling(true);
    try {
      const scheduledAt = scheduledTime.toISOString();
      // Server resolves the OAuth token from userId at publish time — no tokens
      // stored here. Emit ONE entry per selected connected account so a
      // platform with several linked logins schedules to all of them, not just
      // the first one `accounts.find()` happened to return.
      const accountsData = connectedSelected.flatMap(p => {
        if (p === 'whatsapp') return [{ platform: p, userId: 'socialpulse-whatsapp', pageId: whapiSelectedGroupId || undefined }];
        const all = accounts.filter(a => a.platform === p && a.connected);
        const chosen = all.filter(a => {
          const key = accountKey(a);
          return selectedAccountKeys.length === 0 || selectedAccountKeys.includes(key);
        });
        const targets = chosen.length > 0 ? chosen : all;
        return targets.map(acc => ({ platform: p, userId: acc.userId, pageId: acc.pageId || undefined }));
      });

      const currentMediaUrl = publishMediaList[0]?.url || generatedVideo || generatedImage;
      const currentMediaType = publishMediaList[0]?.type || (generatedVideo ? 'video' : generatedImage ? 'image' : null);
      const allMediaUrls = publishMediaList.length ? publishMediaList.map(m => m.url) : (currentMediaUrl ? [currentMediaUrl] : []);
      const res = await fetch('/api/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: draftId, editorState: captureEditor(), platformContent,
          content,
          imageUrl: generatedImage,
          videoUrl: generatedVideo,
          mediaUrl: currentMediaUrl,
          mediaType: currentMediaType,
          mediaUrls: allMediaUrls,
          mediaList: publishMediaList,
          isCarousel: isCarousel && carouselValidation.valid ? true : undefined,
          trialReel: trialReel && instagramReelReady ? true : undefined,
          collaborators: collaborators.length ? collaborators : undefined,
          instagramPostUrl: instagramPostUrl || undefined,
          platforms: connectedSelected,
          accounts: accountsData,
          scheduledAt,
        }),
      });

      if (res.ok) {
        setDraftId(undefined);
        setPublishResult(`Schedule saved for ${new Date(scheduledAt).toLocaleString()}`);
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
    schedulingRef.current = false;
    setIsScheduling(false);
    setTimeout(() => setShowToast(false), 4000);
  };

  // Opens the styled confirmation modal; the actual DELETE only fires from
  // confirmCancelScheduled once the user confirms "Cancel Post".
  const cancelScheduled = (id: string, opts?: { redirectHome?: boolean }) => {
    const post = allPosts.find(p => p.id === id);
    if (post?.status === 'publishing') { notify('This post is already being published and can no longer be cancelled.', true); return; }
    setCancelTarget({ id, redirectHome: !!opts?.redirectHome });
  };

  const confirmCancelScheduled = async () => {
    if (!cancelTarget || isCancelling) return;
    const { id, redirectHome } = cancelTarget;
    setIsCancelling(true);
    try {
      const res = await fetch('/api/scheduler', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      await loadScheduledPosts();
      notify('Post cancelled and moved to Drafts.');
      if (redirectHome) goToTab('studio');
    } catch (e) { notify(e instanceof Error ? e.message : 'Cancellation failed', true); }
    setIsCancelling(false);
    setCancelTarget(null);
  };

  const openReschedule = (post: PostRecord) => {
    if (post.status === 'publishing') { notify('This post is already being published and can no longer be cancelled.', true); return; }
    setRescheduleTarget(post);
    setRescheduleDate(post.scheduledAt ? localDateKey(new Date(post.scheduledAt)) : '');
    setRescheduleTime(post.scheduledAt ? new Date(post.scheduledAt).toTimeString().slice(0, 5) : '');
  };

  // Rescheduling PATCHes scheduledAt on the SAME post id/job — never creates
  // a duplicate. The Scheduler/Calendar pick this up on the next loadScheduledPosts.
  const confirmReschedule = async () => {
    if (!rescheduleTarget || !rescheduleDate || !rescheduleTime || isRescheduling) return;
    const newTime = new Date(`${rescheduleDate}T${rescheduleTime}`);
    const minTime = new Date(Date.now() + 5 * 60 * 1000);
    if (newTime <= minTime) { notify('Schedule time must be at least 5 minutes from now', true); return; }
    setIsRescheduling(true);
    try {
      const res = await fetch('/api/scheduler', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: rescheduleTarget.id, scheduledAt: newTime.toISOString() }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      await loadScheduledPosts();
      notify(`Post rescheduled to ${newTime.toLocaleString()}`);
      setRescheduleTarget(null);
    } catch (e) { notify(e instanceof Error ? e.message : 'Reschedule failed', true); }
    setIsRescheduling(false);
  };

  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const saveFullDraft = async () => {
    if (draftSavingRef.current) { notify('Save already in progress — please wait a moment.'); return false; }
    const cancelling = allPosts.some(post => post.id === draftId && ['pending', 'scheduled'].includes(post.status));
    if (cancelling && !window.confirm('Cancel this scheduled post?')) { notify('Draft save cancelled — nothing was changed.'); return false; }
    draftSavingRef.current = true;
    setIsSavingDraft(true);
    try {
      const res = await fetch('/api/scheduler', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        id: draftId, status: 'draft', content, platforms: selectedPlatforms,
        imageUrl: generatedImage, videoUrl: generatedVideo, mediaList: publishMediaList,
        mediaUrls: publishMediaList.map(m => m.url), isCarousel, platformContent,
        trialReel: trialReel && instagramReelReady ? true : undefined,
        collaborators: collaborators.length ? collaborators : undefined,
        instagramPostUrl: instagramPostUrl || undefined,
        source: mediaItems.some(m => m.name === 'generated') ? 'AI Generated' : 'Manual Draft',
        editorState: captureEditor(),
      }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      setDraftId(data.post.id); await loadScheduledPosts(); notify(cancelling ? 'Post cancelled and moved to Drafts.' : 'Draft saved.');
      return true;
    } catch (e) { notify(e instanceof Error ? e.message : 'Draft could not be saved', true); return false; }
    finally { draftSavingRef.current = false; setIsSavingDraft(false); }
  };

  const cancelPreview = async () => {
    const saved = await saveFullDraft();
    if (saved) { goToTab('scheduler'); setSchedulerFilter('drafts'); }
    return saved;
  };

  const editPost = (post: PostRecord, schedule = false) => {
    const media = postMedia(post);
    restoreEditor({ ...(post.editorState || {}), content: post.content || '', platformContent: post.platformContent || {},
      selectedPlatforms: post.platforms, mediaItems: (post.editorState?.mediaItems as MediaItem[]) || media,
      generatedImage: post.imageUrl || '', generatedVideo: post.videoUrl || '',
      isCarousel: !!post.isCarousel, carouselSlideIds: (post.editorState?.carouselSlideIds as string[]) || media.map(m => m.id),
      trialReel: (post as PostRecord).trialReel === true,
      collaborators: normalizeLegacyCollaborator({
        collaborators: (post as PostRecord).collaborators || (post.editorState?.collaborators as Collaborator[] | undefined),
        collaborator: (post as PostRecord).collaborator || (post.editorState?.collaborator as string | undefined),
      }) || [],
      instagramPostUrl: (post as PostRecord).instagramPostUrl || (post.editorState?.instagramPostUrl as string | undefined) || '',
      draftId: post.id.startsWith('legacy:') ? undefined : post.id,
            activeTab: 'studio', wizardState: { ...((post.editorState?.wizardState as Record<string, unknown>) || {}), currentStep: schedule ? 8 : 3 },
      scheduleDate: post.scheduledAt ? localDateKey(new Date(post.scheduledAt)) : '',
      scheduleTime: post.scheduledAt ? new Date(post.scheduledAt).toTimeString().slice(0, 5) : '',
    } as unknown as SavedDraft);
    if (schedule) setScheduleModalOpen(true);
  };

  const deleteDraft = async (post: PostRecord) => {
    if (!window.confirm('Delete this draft permanently?')) return;
    try {
      if (post.id.startsWith('legacy:')) {
        if (!LEGACY_DRAFTS_KEY) throw new Error('Not signed in');
        const list = JSON.parse(localStorage.getItem(LEGACY_DRAFTS_KEY) || '[]');
        list.splice(Number(post.id.split(':')[1]), 1);
        localStorage.setItem(LEGACY_DRAFTS_KEY, JSON.stringify(list)); loadLegacyDrafts();
      } else {
        const res = await fetch('/api/scheduler', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: post.id, action: 'delete-draft' }) });
        if (!res.ok) throw new Error('Draft deletion failed'); await loadScheduledPosts();
      }
      notify('Draft deleted.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Draft deletion failed', true); }
  };

  const duplicatePost = async (post: PostRecord) => {
    try {
      const res = await fetch('/api/scheduler', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        status: 'draft', content: post.content, platforms: post.platforms,
        imageUrl: post.imageUrl, videoUrl: post.videoUrl, mediaList: post.mediaList, mediaUrls: post.mediaUrls,
        isCarousel: post.isCarousel, platformContent: post.platformContent, source: 'Duplicated',
      }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      await loadScheduledPosts(); notify('Duplicated to Drafts.');
    } catch (e) { notify(e instanceof Error ? e.message : 'Duplication failed', true); }
  };

  const loadLegacyDrafts = () => {
    if (!LEGACY_DRAFTS_KEY) return;
    try {
      const list = JSON.parse(localStorage.getItem(LEGACY_DRAFTS_KEY) || '[]');
      if (!Array.isArray(list)) throw new Error('Invalid legacy drafts');
      setLegacyDrafts(list.map((d, i) => ({ ...d, id: 'legacy:' + i, content: d.content || d.prompt || '', imageUrl: d.imageUrl || '',
        platforms: d.platforms || d.selectedPlatforms || [], accounts: [], status: 'draft', scheduledAt: null,
        editorState: d, createdAt: d.createdAt || d.savedAt || '', updatedAt: d.updatedAt || d.savedAt || '', source: 'Manual Draft' })));
    } catch { notify('Old draft storage could not be read. It has been left unchanged.', true); }
  };
  useEffect(() => { loadLegacyDrafts(); }, [LEGACY_DRAFTS_KEY]);

  const updateAltText = (id: string, altText: string) => {
    setMediaItems(items => items.map(m => m.id === id ? { ...m, altText } : m));
    setTopicMediaItems(items => items.map(m => m.id === id ? { ...m, altText } : m));
  };
  const generateAltText = async (items: MediaItem[]) => {
    if (altBusy) return; setAltBusy(true);
    try {
      for (const item of items) {
        const res = await fetch('/api/media/alt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: item.url }) });
        const data = await res.json(); if (!res.ok) throw new Error(data.error || 'ALT generation failed');
        // Only apply to the image that was actually described; preserve user edits made while awaiting vision.
        const apply = (list: MediaItem[]) => list.map(m => m.id === item.id && m.url === item.url && m.altText === item.altText ? { ...m, altText: data.altText } : m);
        setMediaItems(apply); setTopicMediaItems(apply);
      }
      notify('ALT text generated. Review the descriptions before publishing.');
    } catch (e) { notify(e instanceof Error ? e.message : 'ALT generation failed', true); }
    finally { setAltBusy(false); }
  };

  const oauthPending = useRef<{ id: string; popup: Window | null } | null>(null);
  const refreshConnections = async () => {
    const statuses = await Promise.all(['linkedin', 'facebook', 'instagram'].map(async platform => {
      const res = await fetch('/api/' + platform + '/status'); if (!res.ok) throw new Error('Connection status unavailable');
      const data = await res.json();
      setAccounts(prev => {
        const existing = prev.find(a => a.platform === platform);
        const updated = prev.filter(a => a.platform !== platform);
        if (data.connected && data.userId) updated.push({
          platform, connected: true, userId: data.userId,
          name: data.username ? '@' + data.username : data.name || existing?.name || platform,
          email: data.email || existing?.email || '', pages: data.pages || existing?.pages,
          pageId: data.pageId || (data.pages?.some((p: {id: string}) => p.id === existing?.pageId) ? existing?.pageId : data.pages?.[0]?.id),
          igUserId: data.igUserId,
        });
        localStorage.setItem(ACCOUNTS_KEY!, JSON.stringify(updated)); return updated;
      });
      return [platform, !!data.connected] as const;
    }));
    return Object.fromEntries([...statuses, ['canva', await refreshCanvaStatus()]]);
  };
  const connectPlatform = async (platform: string) => {
    if (oauthPending.current && !oauthPending.current.popup?.closed) {
      oauthPending.current.popup?.focus(); notify('Finish or close the current connection window first.'); return;
    }
    const id = crypto.randomUUID();
    const url = '/api/connect/' + encodeURIComponent(platform) + '?return_id=' + id;

    // Snapshot the editor, but a storage failure must never BLOCK the
    // connection. The previous single try/catch wrapped three unrelated steps —
    // the IndexedDB write, popup navigation and the same-tab fallback — so a
    // blocked popup or a navigation error was reported as "Could not save your
    // editor state", which named the wrong cause entirely, and any of them
    // aborted the OAuth the user had just asked for.
    try {
      await returnStore('put', id, captureEditor());
    } catch (err) {
      console.error('[connect] editor snapshot failed:', err);
      notify('We could not snapshot your editor, so returning here may not restore it. Continuing with the connection.', true);
    }

    const popup = window.open('about:blank', 'socialpulse-connect', 'popup,width=640,height=780');
    if (!popup) {
      // Blocked by the browser. Say so plainly and fall back to this tab,
      // rather than leaving the user with nothing that happened.
      notify('Your browser blocked the sign-in popup — continuing in this tab.', true);
      window.location.assign(url);
      return;
    }
    oauthPending.current = { id, popup };
    try {
      popup.location.href = url;
    } catch (err) {
      console.error('[connect] popup navigation failed:', err);
      oauthPending.current = null;
      popup.close();
      notify('Could not open the sign-in window — continuing in this tab.', true);
      window.location.assign(url);
    }
  };
  useEffect(() => {
    const onReturn = async (event: MessageEvent) => {
      const pending = oauthPending.current;
      if (event.origin !== location.origin || !pending || event.source !== pending.popup || event.data?.type !== 'socialpulse-oauth-return' || event.data.id !== pending.id) return;
      const { error, provider } = event.data;
      pending.popup?.postMessage({ type: 'socialpulse-oauth-ack', id: pending.id }, location.origin);
      oauthPending.current = null;
      // OAuth error codes arrive as snake_case from the callback. Map the one
      // users can act on to a sentence; everything else falls back to the raw
      // code so an unknown failure is never silently swallowed.
      const friendlyError = error === 'account_already_connected'
        ? 'this account is already connected to a different SocialPulse user — ask them to disconnect it first, then try again'
        : error;
      try { const statuses = await refreshConnections(); const failed = error || !statuses[provider]; notify(failed ? 'Platform connection failed: ' + (friendlyError || 'connection could not be verified') : provider + ' connected. OAuth returned successfully. Your editor is unchanged.', !!failed); }
      catch { notify('OAuth returned, but connection status could not be verified. Your work is preserved.', true); }
      await returnStore('delete', pending.id).catch(() => {});
    };
    window.addEventListener('message', onReturn);
    const timer = setInterval(() => {
      if (oauthPending.current?.popup?.closed) {
        oauthPending.current = null; notify('Connection window closed before completion. Your editor is unchanged.', true);
      }
    }, 1000);
    return () => { window.removeEventListener('message', onReturn); clearInterval(timer); };
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('editor_return'); if (!id) return;
    let active = true;
    returnStore('get', id).then(value => {
      if (!active) return;
      const snapshot = value as SavedDraft | undefined;
      if (!snapshot) { notify('Saved editor state is unavailable in this browser. Your saved drafts have not been changed.', true); return; }
      restoreEditor(snapshot); setOauthRestoring(false);
      const path = snapshot.path?.startsWith('/') && !snapshot.path.startsWith('//') ? snapshot.path : '/dashboard';
      window.history.replaceState({}, '', path);
      if (params.get('canva_ready')) setCanvaReadyId(params.get('canva_ready')!);
      notify(params.get('error') ? 'Platform connection failed: ' + params.get('error') : 'OAuth returned successfully. Editor restored.', !!params.get('error'));
      returnStore('delete', id).catch(() => {});
    }).catch(() => notify('Could not restore editor state. Stored data has not been deleted.', true));
    return () => { active = false; };
  }, []);

  const disconnectPlatform = async (platform: string) => {
    // Check FIRST whether this platform still has future scheduled posts. The
    // count comes from the server (authoritative, user-scoped) — never from a
    // client-side guess.
    //
    // FAIL CLOSED: if the check cannot complete we must NOT silently
    // disconnect. Proceeding blind could strand real scheduled posts with no
    // warning at all, which is the exact outcome this prompt exists to
    // prevent. The user can still disconnect from the confirmation dialog.
    let count: number | null = null;
    try {
      const warn = await fetch(`/api/scheduler/connectivity-warning?platform=${encodeURIComponent(platform)}`);
      if (warn.ok) {
        const data = await warn.json();
        if (typeof data.count === 'number') count = data.count;
      }
    } catch { count = null; }

    if (count === null) {
      setDisconnectTarget({ platform, count: 0, unverified: true });
      return;
    }
    if (count > 0) {
      setDisconnectTarget({ platform, count });
      return;
    }
    await performDisconnect(platform);
  };

  const performDisconnect = async (platform: string) => {
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
      localStorage.setItem(ACCOUNTS_KEY!, JSON.stringify(updated));
      return updated;
    });
    setSelectedPlatforms(prev => prev.filter(p => p !== platform));
    // Refresh so the Scheduler immediately shows CONNECTION_REQUIRED on the
    // affected rows instead of waiting for the next manual reload.
    loadScheduledPosts();
  };

  const confirmDisconnectPlatform = async () => {
    if (!disconnectTarget || isDisconnecting) return;
    setIsDisconnecting(true);
    try {
      await performDisconnect(disconnectTarget.platform);
      const label = labelForPlatform(disconnectTarget.platform);
      notify(disconnectTarget.unverified
        ? `${label} disconnected. Any scheduled posts for it will wait for reconnection.`
        : disconnectTarget.count > 0
          ? `${label} disconnected. ${disconnectTarget.count} scheduled post${disconnectTarget.count === 1 ? '' : 's'} will wait for reconnection.`
          : `${label} disconnected.`, false);
    } finally {
      setDisconnectTarget(null);
      setIsDisconnecting(false);
    }
  };

  const labelForPlatform = (p: string) => p === 'linkedin' ? 'LinkedIn' : p === 'whatsapp' ? 'WhatsApp' : p === 'facebook' ? 'Facebook' : p === 'instagram' ? 'Instagram' : p;

  // "Retry failed" — server re-runs ONLY the platforms that did not publish.
  // PUBLISHED rows are excluded server-side, so LinkedIn/Facebook/WhatsApp
  // that already succeeded are never republished.
  const retryFailedPost = async (post: PostRecord) => {
    try {
      const res = await fetch('/api/scheduler/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: post.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify(data.error || 'There is no failed platform to retry.', true);
        return;
      }
      const retried: string[] = Array.isArray(data.retried) ? data.retried : [];
      notify(data.summary?.headline
        ? `Retried ${retried.map(labelForPlatform).join(', ')}. ${data.summary.headline}`
        : 'Retry finished.', false);
      await loadScheduledPosts();
    } catch {
      notify('Retry failed. Please try again.', true);
    }
  };

  // "Reconnect <platform>". Instagram has a direct opt-out to clear (no OAuth
  // of its own); everything else goes through the normal connection flow.
  const reconnectPlatform = async (platform: string) => {
    if (platform === 'instagram') {
      try {
        const res = await fetch('/api/instagram/reconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform: 'instagram' }),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          notify(data.rowsReleased
            ? `Instagram reconnected. ${data.rowsReleased} scheduled post${data.rowsReleased === 1 ? '' : 's'} ready to retry.`
            : 'Instagram reconnected.', false);
          await loadScheduledPosts();
          return;
        }
        // 409 = no Facebook connection underneath to re-enable against.
        if (res.status === 409) {
          notify('Connect Facebook with a linked Instagram account first.', true);
          connectPlatform('facebook');
          return;
        }
      } catch { /* fall through to the normal flow */ }
    }
    connectPlatform(platform);
  };

  // Stable identity for one connected account. Facebook accounts can publish
  // to a specific Page, so the page id is part of the key.
  const accountKey = (a: { platform: string; userId: string; pageId?: string }) =>
    `${a.platform}:${a.userId}:${a.pageId || ''}`;

  const toggleAccount = (key: string) => {
    setSelectedAccountKeys(prev =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const selectAllAccountsFor = (platform: string) => {
    const keys = accounts.filter((a) => a.platform === platform && a.connected).map(accountKey);
    setSelectedAccountKeys(prev => [...new Set([...prev, ...keys])]);
  };

  const clearAccountsFor = (platform: string) => {
    setSelectedAccountKeys(prev => prev.filter((k) => !k.startsWith(`${platform}:`)));
  };

  const togglePlatform = (platform: string) => {
    const next = selectedPlatforms.includes(platform)
      ? selectedPlatforms.filter(p => p !== platform)
      : [...selectedPlatforms, platform];
    setSelectedPlatforms(next);
    // Turning a platform on selects all of its connected accounts; turning it
    // off drops them, so a deselected platform can never keep a target.
    if (next.includes(platform)) selectAllAccountsFor(platform);
    else clearAccountsFor(platform);
    // Keep the active preview platform inside the selection so Preview,
    // caption editor and publish never show an unselected platform.
    // LinkedIn is the default preview whenever it is selected.
    setActivePreviewPlatform(cur => (next.includes(cur) ? cur : (next.includes('linkedin') ? 'linkedin' : (next[0] || ''))));
  };

  // Facebook Page picker: switches the publishing target within the
  // connected account. Tokens stay server-side; only the Page id travels.
  const setAccountPageId = (platform: string, pageId: string) => {
    setAccounts(prev => {
      const updated = prev.map(a => (a.platform === platform ? { ...a, pageId } : a));
      localStorage.setItem(ACCOUNTS_KEY!, JSON.stringify(updated));
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
      setGenerationError('Please select a platform before generating.');
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
        if (isSafetyBlockCode(data.code)) { applySafetyBlock(data); setIsGeneratingContent(false); return; }
        throw new Error(data.error || 'Failed to generate content');
      }
      if (!data.platforms || typeof data.platforms !== 'object') {
        throw new Error('Invalid response from AI. Please try again.');
      }
      setPlatformContent(data.platforms);
      setImagePrompt(data.image_prompt || '');
      // LinkedIn is the default preview whenever it was selected.
      const firstPlatform = genPlatforms.includes('linkedin') ? 'linkedin' : genPlatforms[0];
      if (data.platforms[firstPlatform]) {
        setContent(data.platforms[firstPlatform].caption + '\n\n' + formatHashtags(data.platforms[firstPlatform].hashtags || []));
        setActivePreviewPlatform(firstPlatform);
      }
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : 'Failed to generate content');
    }
    setIsGeneratingContent(false);
  };

  // Regenerate ONE platform only and merge it into the existing map — other
  // platforms' captions/hashtags are never touched.
  const regeneratePlatform = async (platform: string) => {
    if (!selectedPlatforms.includes(platform)) {
      setGenerationError('Select the platform in Step 2 before regenerating it.');
      return;
    }
    if (!prompt.trim() && topicMediaItems.length===0 && mediaItems.length===0 && !generatedImage && !generatedVideo) {
      setGenerationError('Please enter a topic or attach an image/video before generating.');
      return;
    }
    setGenerationError('');
    setIsGeneratingContent(true);
    try {
      const refImages = [...topicMediaItems.filter(m=>m.type==='image'), ...mediaItems.filter(m=>m.type==='image')].slice(0, 4);
      const originalImage = refImages[0]?.url || generatedImage;
      const imageDataListForAPI = refImages.length
        ? await Promise.all(refImages.map(m => getCompressedForAPI(m.url)))
        : originalImage ? [await getCompressedForAPI(originalImage)] : [];
      const imageDataForAPI = imageDataListForAPI[0];
      const res = await fetch('/api/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, tone, platforms: [platform], hasImage: imageDataListForAPI.length > 0, imageData: imageDataForAPI, imageDataList: imageDataListForAPI }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (isSafetyBlockCode(data.code)) { applySafetyBlock(data); setIsGeneratingContent(false); return; }
        throw new Error(data.error || 'Failed to regenerate content');
      }
      if (!data.platforms?.[platform]) throw new Error('Invalid response from AI. Please try again.');
      const entry = data.platforms[platform];
      setPlatformContent(prev => ({ ...prev, [platform]: entry }));
      if (data.image_prompt) setImagePrompt(data.image_prompt);
      if (activePreviewPlatform === platform) {
        setContent(entry.caption + '\n\n' + formatHashtags(entry.hashtags || []));
      }
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : 'Failed to regenerate content');
    }
    setIsGeneratingContent(false);
  };

  // Image generation runs as a background job on the server (see
  // /api/generate-image) instead of one long-held HTTP request - the public
  // Cloudflare tunnel this app is served through has its own ~100s edge
  // limit per request, and gpt-image-2 can legitimately take longer than
  // that. Polling keeps every individual request short so the tunnel limit
  // no longer matters, no matter how long generation actually takes.
  const pollImageJob = async (jobId: string): Promise<{ status: string; image?: string; message?: string }> => {
    const POLL_INTERVAL_MS = 2500;
    const MAX_WAIT_MS = 5 * 60 * 1000; // safeguard - generation itself has no server-side timeout
    const startedAt = Date.now();
    while (Date.now() - startedAt < MAX_WAIT_MS) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      let res: Response;
      try {
        res = await fetch(`/api/generate-image?jobId=${encodeURIComponent(jobId)}`);
      } catch {
        continue; // transient network hiccup — retry next poll
      }
      if (res.status === 404) {
        // Job lost (e.g. dev server restarted and in-memory jobs cleared).
        // Don't throw as unhandled error — return as normal UI error.
        return { status: 'error', message: 'Server restarted and lost the pending image job — please click Generate again.' };
      }
      if (!res.ok) continue; // transient — retry
      const data = await res.json();
      if (data.status === 'pending') continue;
      return data;
    }
    return { status: 'error', message: 'Image generation is taking unusually long — please try again.' };
  };

  // Discriminated result of one background image job. Extracted so the modal
  // flow can hold the bytes for selection while the classic callers keep
  // their fire-and-insert behavior — the network/poll/block/error handling
  // below is the original generateImageFromPrompt logic, unchanged.
  type ImageJobOutcome =
    | { status: 'done'; image: string }
    | { status: 'moderation-blocked' }
    | { status: 'provider-blocked' }
    | { status: 'error'; message: string };

  const runImageJob = async (promptText: string): Promise<ImageJobOutcome> => {
    if (!aspectRatio) return { status: 'error', message: 'Please choose an aspect ratio first.' };
    setIsGeneratingImage(true);
    setGenerationError('');
    try {
      const size = aspectRatioMap[aspectRatio] || aspectRatioMap['1:1'];
      const startRes = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText, style: imageStyle, size: { width: size.width, height: size.height }, aspectRatio }),
      });
      const startData = await startRes.json();
      // Server refused BEFORE generating anything: no provider call, no image,
      // no MediaAsset, nothing in the Asset Gallery. Safety blocks open the
      // revision warning (per-category copy when the backend sent it); anything
      // else is a genuine error.
      if (isSafetyBlockCode(startData.code)) {
        applySafetyBlock(startData);
        setIsGeneratingImage(false);
        return { status: 'moderation-blocked' };
      }
      if (startRes.status === 429) {
        throw new Error(startData.error || 'Too many image requests. Please try again later.');
      }
      if (!startRes.ok || !startData.jobId) {
        throw new Error(startData.message || startData.error || 'Could not start image generation — try again');
      }

      const data = await pollImageJob(startData.jobId);
      if (data.status === 'blocked') {
        // Not an outage - the filter refused these exact words.
        setIsGeneratingImage(false);
        return { status: 'provider-blocked' };
      }
      if (data.status === 'error' || !data.image) {
        throw new Error(data.message || 'Image generation failed — gpt-image-2 hold, try again');
      }
      setIsGeneratingImage(false);
      return { status: 'done', image: data.image };
    } catch (err) {
      console.error('Image generation failed', err);
      const message = err instanceof Error ? err.message : 'Image generation failed — gpt-image-2 hold, try again';
      setGenerationError(message);
      setIsGeneratingImage(false);
      return { status: 'error', message };
    }
  };

  // Inserts freshly generated bytes through the one existing mechanism
  // (gallery prepend + generated-image state). Used by the classic flow and
  // by the modal's Use Selected alike — never a parallel store.
  const insertGeneratedImage = (image: string): MediaItem => {
    const item: MediaItem = { id: Date.now().toString(36)+Math.random().toString(36).slice(2,4), url: image, type: 'image', name: 'generated' };
    setMediaItems(prev => [...prev, item]);
    setGeneratedImage(image);
    // Fresh, unburned bytes — drop any stale pre-logo original/flag for
    // 'gen' so overlays show and future burns start from this exact image.
    delete originalMediaRef.current['gen'];
    setBurnedLogoIds(prev => {
      if (!prev['gen']) return prev;
      const next = { ...prev };
      delete next['gen'];
      return next;
    });
    setGeneratedVideo('');
    setMediaType('image');
    return item;
  };

  const generateImageFromPrompt = async (promptText: string): Promise<MediaItem | null> => {
    if (!aspectRatio) { setGenerationError('Please choose an aspect ratio first.'); return null; }
    const outcome = await runImageJob(promptText);
    if (outcome.status === 'done') return insertGeneratedImage(outcome.image);
    // 'moderation-blocked' already opened the precise warning dialog;
    // 'provider-blocked' opens the legacy provider-refusal dialog, exactly
    // as before this refactor.
    if (outcome.status === 'provider-blocked') setSafetyBlockedOpen(true);
    return null;
  };

  // --- AI generation modal (real-request-driven overlay) -------------------
  // Opened by Generate (image) and Generate-slides (carousel). Phases follow
  // the live request only: generating while pending, selecting on real
  // success, error on real failure. No timers, no fake progress. There is no
  // Cancel during GENERATING because the pipeline has no AbortController —
  // the modal disables closing in-flight instead of faking cancellation.
  type GenModalPhase = 'generating' | 'selecting' | 'error';
  interface GenModalState {
    mode: 'image' | 'carousel';
    phase: GenModalPhase;
    items: Array<{ id: string; url: string }>;
    error: string;
    promptText: string;
    count: number;
  }
  const [genModal, setGenModal] = useState<GenModalState | null>(null);
  const closeGenModal = () => setGenModal(null);

  const startImageRun = async (promptText: string) => {
    setGenModal({ mode: 'image', phase: 'generating', items: [], error: '', promptText, count: 1 });
    const outcome = await runImageJob(promptText);
    if (outcome.status === 'done') {
      setGenModal(m => (m ? { ...m, phase: 'selecting', items: [{ id: 'held', url: outcome.image }] } : m));
    } else if (outcome.status === 'moderation-blocked') {
      // Precise warning dialog is already open; the modal must not linger.
      setGenModal(null);
    } else if (outcome.status === 'provider-blocked') {
      setGenModal(m => (m ? { ...m, phase: 'error', error: 'The image model refused this prompt — try different words.' } : m));
    } else {
      setGenModal(m => (m ? { ...m, phase: 'error', error: outcome.message } : m));
    }
  };

  const applyModalImageSelection = (ids: string[]) => {
    const url = genModal?.items.find(i => ids.includes(i.id))?.url || genModal?.items[0]?.url;
    if (url) insertGeneratedImage(url);
    setGenModal(null);
  };

  const regenerateModal = () => {
    if (!genModal) return;
    if (genModal.mode === 'image') void startImageRun(genModal.promptText);
    else void generateCarouselSlides(genModal.count);
  };

  const useModalCarouselSelection = (ids: string[]) => {
    // Slides were really generated and appended during the run (existing
    // semantics); applying ensures the chosen set is the carousel selection.
    if (ids.length) setCarouselSlideIds(prev => [...prev, ...ids.filter(id => !prev.includes(id))].slice(0, 9));
    setGenModal(null);
  };

  const generateImage = async () => {
    const promptText = imagePrompt || content.trim().split('\n')[0].substring(0, 200) || prompt.trim();
    if (!promptText) return;
    await startImageRun(promptText);
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
  // takes 1 video OR up to 9 images, never mixed) and when carousel mode is
  // on (the carousel slide order is the explicit selection — no extras).
  const topicImagesForPost = topicMediaItems.filter(m => m.type === 'image' && !mediaItems.some(x => x.url === m.url));
  const postHasVideo = mediaItems.some(m => m.type === 'video') || !!generatedVideo;
  // Ordered carousel slides, resolved against the live gallery (a removed
  // image drops out automatically) and restricted to images — carousels are
  // image-only on every platform (Instagram enforces this server-side too).
  const carouselSlides: MediaItem[] = carouselSlideIds
    .map(id => mediaItems.find(m => m.id === id))
    .filter((m): m is MediaItem => !!m && m.type === 'image');
  const carouselValidation = ((): { valid: boolean; reason: string } => {
    if (!isCarousel) return { valid: false, reason: '' };
    // Multiple Images accepts 1–9 slides (shared rule — see lib/carousel-rules).
    const issue = carouselMediaIssue(carouselSlides.length);
    if (issue) return { valid: false, reason: issue };
    return { valid: true, reason: '' };
  })();
  const publishMediaList = (isCarousel ? carouselSlides : (postHasVideo ? mediaItems : [...mediaItems, ...topicImagesForPost])).slice(0, 9);
  // Instagram Reel shape: Instagram selected + a single video (which the
  // Instagram route publishes with media_type REELS). Photo posts, carousels
  // and other platforms never qualify — the Trial option stays hidden there.
  const instagramReelReady = selectedPlatforms.includes('instagram') && !isCarousel &&
    (publishMediaList.length > 0 ? publishMediaList[0]?.type === 'video' : !!generatedVideo);
  // Clear a stale Trial flag the moment the post stops being an IG Reel.
  useEffect(() => { if (!instagramReelReady && trialReel) setTrialReel(false); }, [instagramReelReady]);

  // Carousel slide selection helpers (order = swipe order on every platform).
  const toggleCarouselSlide = (id: string) => {
    const item = mediaItems.find(m => m.id === id);
    if (!item || item.type !== 'image') return;
    setCarouselSlideIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id].slice(0, 9));
  };
  const moveCarouselSlide = (id: string, dir: -1 | 1) => {
    setCarouselSlideIds(prev => {
      const i = prev.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const removeCarouselSlide = (id: string) => setCarouselSlideIds(prev => prev.filter(x => x !== id));

  // "Generate N slides": runs the normal single-image job N times with a
  // per-slide prompt variation (distinct composition, same story/style), so
  // each slide goes through the same background-job + polling path as a
  // manual Generate AI Image. Slides append to the gallery AND auto-select
  // into the carousel in swipe order. Stops on first failure, keeping
  // whatever succeeded (e.g. a safety-filter block mid-run).
  const generateCarouselSlides = async (count: number) => {
    const base = imagePrompt || content.trim().split('\n')[0].substring(0, 200) || prompt.trim();
    if (!base) { setGenerationError('Enter a topic or generate content first — the slides need a prompt.'); return; }
    if (!aspectRatio) { setGenerationError('Please choose an aspect ratio first.'); return; }
    if (isGeneratingCarousel || isGeneratingImage) return;
    const room = 9 - mediaItems.length;
    if (room < 1) { setGenerationError('Gallery is full (max 9) — remove some media first.'); return; }
    const toMake = Math.min(Math.max(1, count), 9, room);
    setIsGeneratingCarousel(true);
    setIsCarousel(true);
    setGenerationError('');
    // Modal opens on the real run: loader while slides generate, preview of
    // the real made slides after. Slides keep their existing live-insert +
    // auto-select semantics; the modal only presents them.
    setGenModal({ mode: 'carousel', phase: 'generating', items: [], error: '', promptText: base, count: toMake });
    const made: MediaItem[] = [];
    for (let i = 0; i < toMake; i++) {
      const slidePrompt = `${base} — carousel slide ${i + 1} of ${toMake}, distinct composition continuing the same visual story, ${imageStyle} style`;
      const item = await generateImageFromPrompt(slidePrompt);
      if (item) made.push(item);
      else break;
    }
    if (made.length) setCarouselSlideIds(prev => [...prev, ...made.map(m => m.id)].slice(0, 9));
    if (made.length < toMake && made.length >= 1) setGenerationError(`Made ${made.length} of ${toMake} slides — the rest failed, add more manually or retry.`);
    if (made.length === 0) {
      setGenModal(m => (m ? { ...m, phase: 'error', error: 'No slides could be generated — try different words or retry.' } : m));
    } else {
      setGenModal(m => (m ? { ...m, phase: 'selecting', items: made.map(m => ({ id: m.id, url: m.url })) } : m));
    }
    setIsGeneratingCarousel(false);
  };

  // The image "Edit in Canva" acts on: whatever's currently generated, else
  // the first image already in the media list.
  const canvaSourceImage = generatedImage || mediaItems.find(m => m.type === 'image')?.url || '';

  // "Edit in Canva": upload the current image as a Canva asset, create a
  // design pre-loaded with it (sized to SocialPulse's own aspect ratio
  // setting), then open the editor in a NEW TAB - this tab stays put and is
  // NEVER navigated away. When the user finishes in Canva, /content-studio ->
  // /api/canva/return verifies the JWT and lands the editor tab on
  // /canva-return, which postMessages the ready id back here (the Canva tab
  // is left open for the user to close). Import stays an explicit button
  // press (never automatic).
  // Handle to the Canva editor tab opened by "Edit/Create in Canva" (reused while open).
  const canvaTabRef = useRef<Window | null>(null);

  // Opens (or reuses) the Canva editor tab SYNCHRONOUSLY inside the click
  // stack - before any await - so popup blockers allow it. Returns the tab,
  // or null when blocked: this tab is then NEVER navigated away, the user is
  // simply told to allow popups and click again (all work stays intact).
  const prepareCanvaTab = (): Window | null => {
    if (canvaTabRef.current && !canvaTabRef.current.closed) { canvaTabRef.current.focus?.(); return canvaTabRef.current; }
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      notify('Popup was blocked — allow popups for this site, then click again. Your work is safe.', true);
      return null;
    }
    canvaTabRef.current = tab;
    try {
      tab.document.write('<!doctype html><title>Opening Canva…</title><p style="font-family:sans-serif;color:#64748B;padding:24px">Opening the Canva editor…</p>');
    } catch { /* ignore */ }
    return tab;
  };

  // Points a prepared tab at the Canva editor URL after the design was
  // created server-side. About:blank is same-origin, so its sessionStorage
  // survives the editor round trip even if the external site severs opener.
  const navigateCanvaTab = async (tab: Window, editUrl: string): Promise<boolean> => {
    try {
      const id = crypto.randomUUID();
      await returnStore('put', id, captureEditor());
      try { tab.sessionStorage.setItem('canva-editor-return', id); } catch { /* Existing editor tab may be cross-origin. Parent remains open. */ }
      tab.location.href = editUrl;
      tab.focus?.();
      return true;
    } catch {
      tab.close();
      notify('Could not preserve editor state. Canva was not opened; your work is still here.', true);
      return false;
    }
  };

  const openInCanva = async (sourceUrl?: string) => {
    if (!canvaConnected) {
      void connectPlatform('canva');
      return;
    }
    // Explicit per-image target when given (thumbnail Edit buttons);
    // otherwise the working default: generated image, else first gallery image.
    // Guard: a bare onClick passes its MouseEvent - only a dataURL counts.
    const src = (typeof sourceUrl === 'string' && sourceUrl.startsWith('data:') ? sourceUrl : '') || canvaSourceImage;
    if (!src) {
      setGenerationError('Generate or upload an image first — there is nothing to edit in Canva yet.');
      return;
    }
    // Link the outing to the gallery item being edited (carousel slides keep
    // their order on re-import because the item id is preserved).
    const sourceMediaId = mediaItems.find(m => m.type === 'image' && m.url === src)?.id || null;
    const tab = prepareCanvaTab();
    if (!tab) return;

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
      if (await navigateCanvaTab(tab, data.editUrl)) {
        if (data.designId) setCanvaSession({ designId: data.designId, sourceMediaId, mode: 'edit', openedAt: Date.now() });
        notify('Canva editor opened in a new tab. When you finish editing, return here and press Import from Canva.', false);
      }
      setIsSendingToCanva(false);
    } catch (err) {
      try { tab.close(); } catch { /* ignore */ }
      setGenerationError(err instanceof Error ? err.message : 'Failed to open design in Canva');
      setIsSendingToCanva(false);
    }
  };

  // "Create in Canva": blank design (no source image) for building with
  // Canva's own tools. Same new tab + same return/import chain as Edit.
  const [isCreatingInCanva, setIsCreatingInCanva] = useState(false);
  const createInCanva = async () => {
    if (!canvaConnected) {
      void connectPlatform('canva');
      return;
    }
    const tab = prepareCanvaTab();
    if (!tab) return;
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
      if (await navigateCanvaTab(tab, data.editUrl)) {
        if (data.designId) setCanvaSession({ designId: data.designId, sourceMediaId: null, mode: 'create', openedAt: Date.now() });
        notify('Canva editor opened in a new tab. When you finish your design, return here and press Import from Canva.', false);
      }
      setIsCreatingInCanva(false);
    } catch (err) {
      try { tab.close(); } catch { /* ignore */ }
      setGenerationError(err instanceof Error ? err.message : 'Failed to create design in Canva');
      setIsCreatingInCanva(false);
    }
  };

  // "Import from Canva": exports the design the user just edited and merges
  // it into the SAME media pipeline as uploads/AI images (never a separate
  // subsystem). A repeat import of the same design updates the linked item in
  // place - same id, so carousel order/selection, ALT text and branding links
  // survive - instead of stacking duplicates. The readyId is only consumed
  // server-side after a successful export, so a failed import keeps working
  // for "Retry Import".
  const importFromCanva = async () => {
    if (!canvaReadyId || isImportingFromCanva) return;
    if (canvaLastImportedReadyId === canvaReadyId) {
      notify('This Canva design was already imported.', false);
      return;
    }
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
      const designId = canvaSession?.designId || '';
      const now = Date.now();
      // An edit ADDS a new gallery item instead of overwriting the item it was
      // derived from. Overwriting meant the generated original silently ceased
      // to exist, so the user had no choice about what got published. Keeping
      // both lets them compare and pick. Re-importing the *same* export is
      // already blocked above by canvaLastImportedReadyId, so this cannot stack
      // duplicates from a repeated click.
      const derivedFrom = designId ? mediaItems.find(m => m.canvaDesignId === designId) : undefined;
      const item: MediaItem = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 4),
        url: data.image,
        type: 'image',
        name: 'canva-edit',
        source: 'canva',
        canvaDesignId: designId || undefined,
        // Carry lineage from the item this was edited from, so the gallery can
        // still show which original an edit descends from.
        sourceMediaId: canvaSession?.sourceMediaId ?? derivedFrom?.sourceMediaId,
        importedAt: now,
      };
      // Prepended, not appended: WhatsApp sends only the first media item, so
      // putting the edit first keeps "the edited version is what gets posted"
      // as the default while the original stays available to fall back to.
      setMediaItems(prev => [item, ...prev]);
      notify(derivedFrom
        ? 'Edited image added to your gallery \u2014 the original is still there, pick which to publish.'
        : 'Edited image imported from Canva \u2713', false);
      setCanvaLastImportedReadyId(canvaReadyId);
      setCanvaReadyId('');
      setCanvaSession(prev => prev ? { ...prev, importedAt: now } : prev);
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
    setCanvaSession(null);
    setCanvaLastImportedReadyId('');
  };

  const [whatsappDisconnecting, setWhatsappDisconnecting] = useState(false);
  const disconnectWhatsApp = async () => {
    if (whatsappDisconnecting || whapiLoading) return;
    setWhatsappDisconnecting(true);
    try {
      await fetch('/api/whatsapp/disconnect', { method: 'POST' });
    } catch { /* server session may already be gone; UI still resets below */ }
    setWhapiConnected(false);
    setWhapiChannelStatus('');
    setWhapiAccountName('');
    setWhapiPhoneMasked('');
    setWhapiGroups([]);
    setWhapiSelectedGroupId('');
    setWhapiGroupsError('');
    setWhatsappQrImage('');
    setWhatsappConnectMessage('');
    setWhatsappConnectOpen(false);
    setSelectedPlatforms(prev => prev.filter(p => p !== 'whatsapp'));
    setWhatsappDisconnecting(false);
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
    setCarouselSlideIds(prev => prev.filter(x => x !== id));
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

  // Asset Gallery "Use": drops a persistent asset into the SAME session
  // media pipeline as uploads (data URL, first-item drives generated
  // image/video) and jumps to the studio — no second pipeline invented.
  const useGalleryAsset = (item: { url: string; type: 'image' | 'video'; name: string }) => {
    const m: MediaItem = { id: `gal_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, url: item.url, type: item.type, name: item.name, source: 'gallery' };
    setMediaItems(prev => [...prev, m]);
    if (item.type === 'video') { setGeneratedVideo(item.url); setGeneratedImage(''); setMediaType('video'); }
    else { setGeneratedImage(item.url); setGeneratedVideo(''); setMediaType('image'); }
    goToTab('studio');
  };

  const clearTopicMedia = () => setTopicMediaItems([]);
  const clearAllMedia = () => {
    originalMediaRef.current = {};
    setLogoTargetId(null);
    setBurnedLogoIds({});
    setCarouselSlideIds([]);
    setIsCarousel(false);
    setMediaItems([]); setGeneratedImage(''); setGeneratedVideo(''); setMediaType(null);
  };
  // Removes only the current AI-generated hero visual (gallery items sharing
  // its URL go too); uploads and the generated video are left untouched.
  const clearGeneratedImage = () => {
    const url = generatedImage;
    if (url) setMediaItems(prev => prev.filter(m => m.url !== url));
    setGeneratedImage('');
  };

  // Burns reflect a fixed position/size/opacity — a user-initiated geometry
  // change invalidates them, so revert burned items to their clean originals
  // and let the live overlay take over at the new geometry (never stack,
  // never double). Draft restores and mounts must NOT trigger this.
  const geometryTouchedRef = useRef(false);
  useEffect(() => {
    if (!geometryTouchedRef.current) return;
    geometryTouchedRef.current = false;
    const originals = originalMediaRef.current;
    if (Object.keys(originals).length > 0) {
      setMediaItems(prev => prev.map(m => (originals[m.id] && originals[m.id] !== m.url ? { ...m, url: originals[m.id] } : m)));
      if (originals['gen']) setGeneratedImage(prev => (prev && prev !== originals['gen'] ? originals['gen'] : prev));
    }
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
  // Gallery "Set as cover": moves the item to the front and re-syncs the
  // first-item preview state, mirroring removeMediaItem's sync logic.
  const setMediaCover = (id: string) => {
    setMediaItems(prev => {
      const idx = prev.findIndex(m => m.id === id);
      if (idx <= 0) return prev;
      const next = [...prev];
      const [m] = next.splice(idx, 1);
      next.unshift(m);
      const first = next[0];
      if (first.type === 'video') { setGeneratedVideo(first.url); setGeneratedImage(''); setMediaType('video'); }
      else { setGeneratedImage(first.url); setGeneratedVideo(''); setMediaType('image'); }
      return next;
    });
  };
  // Carousel drag-to-reorder: splices the dragged slide to the drop position.
  const reorderCarouselSlide = (activeId: string, overId: string) => {
    if (activeId === overId) return;
    setCarouselSlideIds(prev => {
      const from = prev.indexOf(activeId);
      const to = prev.indexOf(overId);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
  };
  // Brand Logo card "Remove" + logo dialog Remove: clears the logo image AND
  // restores pre-logo originals, so no branded pixels remain anywhere.
  const clearLogo = () => { setLogoImage(''); restoreBurnedMedia(); };

  // Undo a previous "Apply to All Slides": swap burned items back to their
  // stashed pre-logo originals and clear their burned flags. Removing the
  // brand logo alone cannot erase already-burned pixels.
  const restoreBurnedMedia = () => {
    const originals = originalMediaRef.current;
    const ids = Object.keys(originals);
    if (!ids.length) return;
    setMediaItems(prev => prev.map(m => (originals[m.id] && originals[m.id] !== m.url ? { ...m, url: originals[m.id] } : m)));
    if (originals['gen']) setGeneratedImage(prev => (prev && prev !== originals['gen'] ? originals['gen'] : prev));
    setBurnedLogoIds(prev => {
      const next = { ...prev };
      ids.forEach(id => { delete next[id]; });
      return next;
    });
    originalMediaRef.current = {};
    setLogoTargetId(null);
    setPublishResult('Original visuals restored — burned-in logos removed.');
    setPublishResultType('success'); setShowToast(true); setTimeout(() => setShowToast(false), 4000);
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
        // Stable gallery id so re-applies REPLACE the branded copy in place
        // (never duplicate it), and the clean original is keyed by that id
        // (never stack a new logo onto already-branded bytes, never lose it).
        const GEN_ID = 'gen-logo';
        const baseUrl = originalMediaRef.current[GEN_ID] || originalMediaRef.current['gen'] || generatedImage;
        const base: MediaItem = { id: GEN_ID, url: baseUrl, type: 'image' };
        const out = await processOne(base);
        if (!originalMediaRef.current[GEN_ID]) originalMediaRef.current[GEN_ID] = baseUrl;
        if (!originalMediaRef.current['gen']) originalMediaRef.current['gen'] = baseUrl;
        setGeneratedImage(out.url);
        const genItem: MediaItem = { id: GEN_ID, url: out.url, type: 'image', name: 'with-logo' };
        setMediaItems(prev => {
          const i = prev.findIndex(m => m.id === GEN_ID);
          if (i >= 0) { const next = [...prev]; next[i] = genItem; return next; }
          return [...prev, genItem];
        });
        // Flag BOTH the gallery copy and 'gen': overlays showing generatedImage
        // directly check burnedLogoIds['gen'] — without it they'd stack a live
        // logo on top of these burned pixels (double logo).
        setBurnedLogoIds(prev => ({ ...prev, [GEN_ID]: true, gen: true }));
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
      case 'INSTAGRAM_TRIAL_REEL_NOT_SUPPORTED':
        return 'Trial Reel publishing is not connected yet (Meta approval pending). Turn the Trial option off to publish as a normal Reel.';
      case 'LINKEDIN_PUBLISH_FAILED':
      default:
        return fallback || 'Failed to publish to LinkedIn.';
    }
  };

  const publishToAll = async (targets?: string[]) => {
    // ONE USER ACTION = ONE PUBLISH REQUEST. Ref guard stops rapid
    // repeated clicks even before React re-renders the disabled button.
    if (publishingRef.current || isPublishing || publishCooldown > 0) return;
    if (publishMediaList.some(m => m.type === 'image' && !m.altText?.trim())) {
      notify('ALT text missing on one or more images. You can add it in Accessibility.', true);
      if (!window.confirm('Some images are missing ALT text. Publish anyway?')) return;
    }
    const connectedSelected = selectedPlatforms.filter(p =>
      p === 'whatsapp' ? whapiConnected : accounts.some(a => a.platform === p && a.connected)
    );
    if (connectedSelected.length === 0) {
      setPublishResult('No connected platforms selected');
      setPublishResultType('error');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 4000);
      return;
    }
    if (isCarousel && !carouselValidation.valid) {
      setPublishResult(`Carousel not ready: ${carouselValidation.reason}`);
      setPublishResultType('error');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 4000);
      return;
    }

    publishingRef.current = true;
    setIsPublishing(true);
    const results: string[] = [];
    let hasError = false;
    // Mark only the platforms this request will attempt.
    const attemptTargets = targets && targets.length ? targets : connectedSelected;
    setPublishStatuses(prev => {
      const next = { ...prev };
      attemptTargets.forEach(pl => { next[pl] = { state: 'pending' }; });
      return next;
    });
    const markPlatform = (platform: string, state: 'pending' | 'success' | 'failed', message?: string) =>
      setPublishStatuses(prev => ({ ...prev, [platform]: { state, message } }));

    for (const platform of attemptTargets) {
      if (platform === 'whatsapp') {
        if (!whapiSelectedGroupId) {
          results.push('whatsapp: No WhatsApp chat selected');
          markPlatform('whatsapp', 'failed', 'No WhatsApp chat selected');
          hasError = true;
          continue;
        }
        const platformData = platformContent[platform];
        // WhatsApp: no hashtags ever — strip every #tag anywhere in the text.
        const finalPublishContent = platformData
          ? stripAllHashtags(platformData.caption)
          : stripAllHashtags(content);
        const attemptId = `ui_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}_whatsapp`;
        console.log(`[publish] attempt ${attemptId} → whatsapp ${whapiSelectedGroupId.slice(0, 8)}...`);
        try {
          const waMedia = publishMediaList.slice(0, 1);
          const res = await fetch('/api/whatsapp/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupId: whapiSelectedGroupId, text: finalPublishContent, mediaList: waMedia, attemptId }),
          });
          if (res.ok) {
            results.push('whatsapp: Success');
            markPlatform('whatsapp', 'success');
          } else {
            const err = await readPublishResponse(res);
            results.push(`whatsapp: ${publishReason(err, res, 'WhatsApp publish failed')}`);
            markPlatform('whatsapp', 'failed', publishReason(err, res, 'WhatsApp publish failed'));
            hasError = true;
          }
        } catch {
          results.push('whatsapp: Network error — no retry was attempted');
          markPlatform('whatsapp', 'failed', 'Network error');
          hasError = true;
        }
        continue;
      }
      // Fan out over every SELECTED connected account for this platform, not
      // just the first one. Accounts with no explicit selection still default
      // to all of them, so existing single-account behaviour is unchanged.
      const platformAccounts = accounts.filter(a => a.platform === platform && a.connected);
      const chosen = platformAccounts.filter(a => {
        const key = accountKey(a);
        return selectedAccountKeys.length === 0 || selectedAccountKeys.includes(key);
      });
      const targets = chosen.length > 0 ? chosen : platformAccounts;
      if (targets.length === 0) {
        results.push(`${platform}: Not connected — reconnect through OAuth`);
        markPlatform(platform, 'failed', 'Connection expired — reconnect to continue');
        hasError = true;
        continue;
      }
      // platformContent captions are synced with Step-3 edits (see wizard),
      // so this is always the current edited caption — never a stale value.
      const platformData = platformContent[platform];
      const publishContent = platformData
        ? `${stripTrailingHashtags(platformData.caption)}\n\n${formatHashtags(platformData.hashtags || [])}`.trim()
        : stripTrailingHashtags(content);

      for (const account of targets) {
        // Unique id per user action + platform + account. Logged server-side,
        // never a secret.
        const attemptId = `ui_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}_${platform}_${(account.userId || '').slice(0, 8)}`;
        const label = targets.length > 1 ? `${platform} (${account.name || account.email || account.userId.slice(0, 8)})` : platform;
        console.log(`[publish] attempt ${attemptId} → ${label}`);
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
              isCarousel: isCarousel && carouselValidation.valid ? true : undefined,
              trialReel: platform === 'instagram' && trialReel && instagramReelReady ? true : undefined,
              collaborators: platform === 'instagram' ? collaboratorsForPublish(collaborators) : undefined,
              userId: account.userId,
              pageId: account.pageId || undefined,
              attemptId,
            }),
          });
          // No automatic retry on any failure — the user decides.
          if (res.ok) {
            results.push(`${label}: Success`);
            markPlatform(platform, 'success');
            if (platform === 'instagram') {
              const data = await readPublishResponse(res);
              const collabResults = Array.isArray(data.collaborators) ? data.collaborators as Parameters<typeof mergeCollaboratorResults>[1] : undefined;
              const postUrl = typeof data.postUrl === 'string' ? data.postUrl : undefined;
              if (postUrl) setInstagramPostUrl(postUrl);
              if (collabResults?.length || postUrl) { setCollaborators(cs => mergeCollaboratorResults(cs, collabResults)); void saveFullDraft(); }
            }
          } else {
            const err = await readPublishResponse(res);
            const reason = publishErrorText(typeof err.code === 'string' ? err.code : undefined, typeof err.message === 'string' ? err.message : undefined);
            results.push(`${label}: ${reason === 'Publish failed. Please try again.' ? publishReason(err, res, 'Publish failed') : reason}`);
            markPlatform(platform, 'failed', reason);
            hasError = true;
            if (platform === 'instagram') {
              const collabResults = Array.isArray(err.collaborators) ? err.collaborators as Parameters<typeof mergeCollaboratorResults>[1] : undefined;
              if (collabResults?.length) { setCollaborators(cs => mergeCollaboratorResults(cs, collabResults)); void saveFullDraft(); }
            }
          }
        } catch {
          results.push(`${label}: Network error — no retry was attempted`);
          markPlatform(platform, 'failed', 'Network error');
          hasError = true;
        }
      }
    }

    // Safe events only — never log tokens, cookies, OTPs or raw credentials.
    console.info(`[publish] PUBLISH_${targets ? 'RETRY' : 'STARTED'}_RESULT ok=${!hasError} targets=${attemptTargets.join(',')}`);
    const okCount = attemptTargets.length - results.filter(r => !r.endsWith('Success')).length;
    const failedCount = results.filter(r => !r.endsWith('Success')).length;
    setPublishResult(
      hasError
        ? `Published to ${okCount} of ${attemptTargets.length} platform${attemptTargets.length === 1 ? '' : 's'}.`
        : `Published to ${failedCount === 0 ? attemptTargets.length : okCount} of ${attemptTargets.length} platform${attemptTargets.length === 1 ? '' : 's'}.`
    );
    setPublishResultType(hasError ? 'error' : 'success');
    setShowToast(true);
    publishingRef.current = false;
    setIsPublishing(false);
    if (!hasError) {
      setPublishSuccessFlash(true);
      setPublishCooldown(10);
      setTimeout(() => setPublishSuccessFlash(false), 2200);
    }
    setTimeout(() => setShowToast(false), 5000);
  };

  // Retry only the platforms that actually failed. Platforms already marked
  // 'success' are never re-sent, so a retry cannot duplicate a live post.
  const retryFailedPublish = () => {
    const failed = Object.entries(publishStatuses)
      .filter(([, v]) => v.state === 'failed')
      .map(([k]) => k);
    if (failed.length === 0) return;
    void publishToAll(failed);
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

  // Which view a post belongs to is decided by its DERIVED status. A post that
  // published to 2 of 4 platforms is "published" enough to leave the calendar,
  // but it still needs its Retry action, so it is surfaced in BOTH the
  // Scheduled (needs attention) and Published (history) lists.
  const effectiveStatus = (p: PostRecord) => p.overallStatus || p.status;
  const pendingPosts = allPosts.filter(p => {
    const s = effectiveStatus(p);
    return s === 'pending' || s === 'publishing' || s === 'connection_required' || s === 'partially_published';
  }).sort((a, b) => (a.scheduledAt || '').localeCompare(b.scheduledAt || ''));
  const publishedPosts = allPosts.filter(p => {
    const s = effectiveStatus(p);
    return s === 'published' || s === 'partially_published';
  });
  const failedPosts = allPosts.filter(p => effectiveStatus(p) === 'failed');
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
    draft: { bg: '#f1f5f9', color: '#64748b', label: 'Draft' },
    publishing: { bg: '#fffbeb', color: '#b45309', label: 'Publishing' },
    cancelled: { bg: '#f1f5f9', color: '#64748b', label: 'Cancelled' },
  };

  const topBarInfo: Record<string, { title: string; subtitle: string }> = {
    dashboard: { title: 'Dashboard', subtitle: 'Your content overview at a glance' },
    studio: { title: 'Content Studio', subtitle: 'Turn your ideas into impactful social media content with AI' },
    scheduler: { title: 'Scheduler', subtitle: 'Manage upcoming and past scheduled posts' },
    analytics: { title: 'Analytics', subtitle: 'Track your publishing performance' },
    media: { title: 'Asset Gallery', subtitle: 'All uploaded and generated media in one place' },
    drafts: { title: 'Drafts', subtitle: 'Continue where you left off' },
    connect: { title: 'Connect Platforms', subtitle: 'Connect and manage the accounts you use with SocialPulse.' },
  };

  // Week-calendar data shared by all Scheduler tabs (see SchedulerCalendar).
  // calView/calMonth persist across tabs; Month is the default view.
  const goCalToday = () => {
    setCalendarWeekStart(startOfWeekLocal(new Date()));
    const n = new Date();
    setCalMonth(new Date(n.getFullYear(), n.getMonth(), 1));
  };
  const calendarDays = Array.from({ length: 7 }, (_, i) => addDaysLocal(calendarWeekStart, i));
  const todayKey = localDateKey(new Date());
  const weekStartLabel = calendarDays[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const weekEndSameMonth = calendarDays[0].getMonth() === calendarDays[6].getMonth() && calendarDays[0].getFullYear() === calendarDays[6].getFullYear();
  const weekEndLabel = weekEndSameMonth ? `${calendarDays[6].getDate()}, ${calendarDays[6].getFullYear()}` : calendarDays[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const weekRangeLabel = `${weekStartLabel} - ${weekEndLabel}`;

  return (
    <div className="sp-root" data-theme={theme} style={{ position: 'relative', display: 'flex', minHeight: '100vh', overflow: 'hidden' }}>
      <div className="sp-atmos" aria-hidden="true">
        <span className="sp-stars" />
        <span className="sp-aurora" style={{ width: 680, height: 680, right: '2%', top: -320, background: 'radial-gradient(circle, rgba(124,92,255,.24) 0%, transparent 68%)' }} />
        <span className="sp-aurora" style={{ width: 620, height: 620, left: '10%', top: 380, background: 'radial-gradient(circle, rgba(72,112,255,.14) 0%, transparent 68%)', animationDelay: '-8s' }} />
        <span className="sp-aurora" style={{ width: 560, height: 560, right: '12%', bottom: -260, background: 'radial-gradient(circle, rgba(168,93,245,.13) 0%, transparent 68%)', animationDelay: '-14s' }} />
      </div>
      <style>{`
        /* --- App shell responsiveness ------------------------------------------------
           The header's right cluster (tagline, platform-count pill, date, bell, avatar)
           measured 504px wide while the header itself had only 142px to give it, so it
           overflowed the page by 533px on a 390px phone. Rather than hide information,
           the non-essential parts collapse first: tagline and date go, the status pill
           shortens to an icon-sized count, and everything else shrinks rather than
           forcing the row wider. */
        .sp-hdr { min-width: 0; }
        .sp-hdr > * { min-width: 0; }
        .sp-hdr-right { min-width: 0; flex-shrink: 1; overflow: hidden; }
        .sp-hdr-right > * { min-width: 0; flex-shrink: 0; }
        .sp-hdr-status { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 190px; }
        @media (max-width: 1100px) {
          .sp-hdr-tagline { display: none; }
          .sp-hdr-divider { display: none; }
          .sp-hdr-status { max-width: 132px; }
        }
        @media (max-width: 768px) {
          .sp-hdr { padding: 0 12px !important; gap: 8px; }
          .sp-hdr-date { display: none; }
          .sp-hdr-status { max-width: 40px; padding: 6px 10px !important; }
          .sp-hdr-status-text { display: none; }
          .sp-hdr-right { gap: 8px; }
        }
        @media (max-width: 480px) {
          .sp-hdr-sub { display: none; }
        }
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

      {/* Sidebar - collapsible slidebar (icon rail on tablet, drawer on phone) */}
      {drawerOpen && (
        <div
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(5,7,18,0.6)', zIndex: 9 }}
        />
      )}
      <aside className="sp-glass" style={{
        width: drawerOpen ? '264px' : (isMobile ? '264px' : (railMode ? '72px' : '264px')),
        transform: isMobile && !mobileNavOpen ? 'translateX(-100%)' : 'translateX(0)',
        transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1), width 0.3s cubic-bezier(0.4,0,0.2,1)',
        position: 'fixed', zIndex: 10, height: '100vh',
        display: 'flex', flexDirection: 'column', gap: '22px', flexShrink: 0,
        padding: railMode ? '20px 10px 16px' : '22px 16px 18px',
        background: 'var(--sp-sidebar-bg)',
        borderRight: '1px solid var(--sp-divider)',
        overflow: 'hidden', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#3a3d6f transparent',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '2px 4px 0', justifyContent: railMode ? 'center' : 'flex-start' }}>
          <img src={SP_LOGO} alt="SocialPulse" width={38} height={38} style={{ width: '38px', height: '38px', borderRadius: '11px', objectFit: 'cover', flexShrink: 0, boxShadow: '0 6px 18px -6px rgba(98,224,255,.9)' }} />
          {!railMode && (
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span className="sp-display" style={{ fontSize: '21px', fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.1, color: 'var(--sp-heading)' }}>SocialPulse</span>
              <span className="sp-mono" style={{ fontSize: '10.5px', letterSpacing: '0.16em', textTransform: 'uppercase' as const, color: 'var(--sp-muted)' }}>Content Manager</span>
            </div>
          )}
          <button
            type="button"
            className="sp-btn sp-btn-ghost"
            aria-label={isNarrow ? (drawerOpen ? 'Close navigation menu' : 'Open navigation menu') : (sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar')}
            onClick={() => (isNarrow ? setMobileNavOpen(v => !v) : setSidebarCollapsed(v => !v))}
            style={{ width: '36px', height: '36px', flex: 'none', display: 'grid', placeItems: 'center', borderRadius: '11px', border: '1px solid rgba(150,242,255,.18)', color: '#B9BEE0' }}
          >
            <SpIcon name={sidebarCollapsed || railMode ? 'chevronRight' : 'chevronLeft'} size={16} />
          </button>
        </div>

        <nav aria-label="Main" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' }}>
          {!railMode && <span className="sp-mono" style={{ padding: '0 12px', fontSize: '10.5px', letterSpacing: '0.22em', textTransform: 'uppercase' as const, color: 'var(--sp-muted)' }}>Main</span>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {([
              { icon: 'dashboard', label: 'Dashboard', tab: 'dashboard' as const },
              { icon: 'studio', label: 'Content Studio', tab: 'studio' as const },
              { icon: 'scheduler', label: 'Scheduler', tab: 'scheduler' as const },
              { icon: 'analytics', label: 'Analytics', tab: 'analytics' as const },
              { icon: 'gallery', label: 'Asset Gallery', tab: 'media' as const },
              { icon: 'connect', label: 'Connect Platforms', tab: 'connect' as const },
            ] as const).map(item => {
              const active = activeTab === item.tab;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => goToTab(item.tab)}
                  title={railMode ? item.label : undefined}
                  className={`sp-nav${active ? ' sp-nav-active' : ''}`}
                  style={{
                    minHeight: '48px', padding: railMode ? 0 : '0 14px 0 9px', borderRadius: '15px',
                    color: active ? '#FFFFFF' : 'var(--sp-muted)', fontSize: '14.5px', fontWeight: active ? 700 : 600,
                    display: 'flex', alignItems: 'center', gap: railMode ? 0 : '12px', width: '100%',
                    justifyContent: railMode ? 'center' : 'flex-start', textAlign: 'left', border: 'none', background: active ? undefined : 'transparent', fontFamily: 'inherit',
                  }}
                >
                  <span className={active ? undefined : 'sp-soft-icon'} style={{
                    width: '32px', height: '32px', flex: 'none', display: 'grid', placeItems: 'center', borderRadius: '10px', color: active ? '#FFFFFF' : 'var(--sp-muted)',
                    background: active ? 'linear-gradient(135deg, #6483FD, #5DAAF5)' : undefined,
                    border: active ? 'none' : '1px solid transparent',
                    boxShadow: active ? '0 6px 18px -6px rgba(98,224,255,.9)' : 'none',
                  }}>
                    <SpIcon name={item.icon} size={17} />
                  </span>
                  {!railMode && <span style={{ flex: 1 }}>{item.label}</span>}
                  {!railMode && active && <span className="sp-led" style={{ width: '6px', height: '6px', background: '#B8F1FF', color: '#B8F1FF', boxShadow: '0 0 10px #9DF0FF' }} />}
                </button>
              );
            })}
          </div>
        </nav>

        <div style={{ marginTop: 'auto', position: 'relative' }}>
          <button
            type="button"
            className="sp-soft-icon"
            onClick={() => setProfileMenuOpen(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: railMode ? 'center' : 'flex-start', width: '100%', padding: '12px', borderRadius: '16px', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <span className="sp-display" style={{ width: '38px', height: '38px', flex: 'none', display: 'grid', placeItems: 'center', borderRadius: '50%', fontSize: '15px', fontWeight: 700, color: '#FFFFFF', background: 'linear-gradient(#141A3C, #141A3C) padding-box, linear-gradient(135deg, #6483FD, #5DAAF5) border-box', border: '2px solid transparent' }}>
              {(currentUser?.name || '?').charAt(0).toUpperCase()}
            </span>
            {!railMode && (
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
                <span style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--sp-heading)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentUser?.name || 'Loading…'}</span>
                <span style={{ fontSize: '11.5px', color: 'var(--sp-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentUser?.email || ''}</span>
              </div>
            )}
          </button>
          {profileMenuOpen && (
            <>
              <div onClick={() => setProfileMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 19 }} />
              <div style={{ position: 'absolute', bottom: '100%', left: railMode ? '4px' : '0', right: railMode ? '4px' : '0', marginBottom: '8px', background: 'var(--sp-panel-bg)', borderRadius: '14px', boxShadow: '0 20px 48px -16px rgba(0,0,0,.6)', border: '1px solid rgba(140,241,255,.2)', overflow: 'hidden', zIndex: 20 }}>
                <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--sp-divider)' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--sp-heading)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentUser?.name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--sp-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentUser?.email}</div>
                </div>
                <button onClick={() => setProfileMenuOpen(false)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', fontSize: '13px', fontWeight: 500, color: '#D9DCFA', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Account</button>
                <button onClick={handleLogout} disabled={loggingOut} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', fontSize: '13px', fontWeight: 600, color: '#FDA8B8', background: 'none', border: 'none', cursor: loggingOut ? 'default' : 'pointer', fontFamily: 'inherit', borderTop: '1px solid var(--sp-divider)' }}>
                  {loggingOut ? 'Logging out…' : 'Logout'}
                </button>
              </div>
            </>
          )}
        </div>
      </aside>

      {/* Mobile overlay when sidebar expanded on small screens */}
      {!sidebarCollapsed && (
        <div onClick={() => setSidebarCollapsed(true)} style={{ display: 'none' }} className="sidebar-overlay" />
      )}

      {/* Main Content */}
      <div style={{
        // minWidth:0 is the whole fix for the page-wide horizontal scroll. A
        // flex item defaults to min-width:auto, i.e. it refuses to shrink below
        // its content's min-content width. This subtree's min-content width is
        // ~1104px (the wizard's maxWidth:1120 plus padding), so at a 1024px
        // viewport the available column is only 776px after the sidebar offset —
        // and the item stayed 1104px, pushing the document to 1352px and giving
        // the entire app a horizontal scrollbar on desktop AND mobile.
        position: 'relative',
        zIndex: 1,
        flex: 1,
        minWidth: 0,
        width: 'auto',
        maxWidth: '100%',
        marginLeft: isMobile ? '0' : (railMode ? '72px' : '264px'),
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        transition: 'margin-left 0.3s cubic-bezier(0.4,0,0.2,1)',
      }}>
        {/* Top Bar — dark glass header */}
        <header className="sp-hdr sp-topbar sp-glass" style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '14px 20px', padding: '14px 32px',
          background: 'var(--sp-topbar-bg)', borderBottom: '1px solid var(--sp-divider)', position: 'sticky', top: 0, zIndex: 5,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', minWidth: 0 }}>
            <button type="button" className="sp-btn sp-btn-ghost" aria-label={isNarrow ? 'Open navigation menu' : 'Toggle sidebar'} onClick={() => (isNarrow ? setMobileNavOpen(v => !v) : setSidebarCollapsed(v => !v))} title="Toggle sidebar" style={{ width: '44px', height: '44px', flex: 'none', display: 'grid', placeItems: 'center', borderRadius: '13px', border: '1px solid rgba(150,242,255,.18)', color: '#C9CDEB' }}>
              <SpIcon name="hamburger" size={19} />
            </button>
            <span aria-hidden="true" className="sp-hdr-divider" style={{ width: '1px', height: '32px', background: 'rgba(140,241,255,.18)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="sp-led" style={{ width: '8px', height: '8px', background: '#34D399', color: '#34D399', boxShadow: '0 0 10px rgba(52,211,153,.8)' }} />
                <h1 className="sp-display" style={{ margin: 0, fontSize: '21px', fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.2, color: 'var(--sp-heading)' }}>{topBarInfo[activeTab].title}</h1>
              </div>
              <p className="sp-hdr-sub" style={{ margin: 0, fontSize: '13px', color: 'var(--sp-muted)' }}>{topBarInfo[activeTab].subtitle}</p>
            </div>
          </div>
          <div className="sp-hdr-right" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
            {activeTab === 'studio' && (
              <span className="sp-hdr-tagline sp-mono" style={{ fontSize: 11, fontWeight: 700, color: '#BEF2FF', backgroundColor: 'rgba(108,234,255,.14)', border: '1px solid rgba(108,234,255,.3)', padding: '6px 12px', borderRadius: 999, whiteSpace: 'nowrap' }}>Create. Brand. Schedule. Grow.</span>
            )}
            <button
              type="button"
              className="sp-btn sp-btn-ghost"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={toggleTheme}
              style={{ width: '44px', height: '44px', display: 'grid', placeItems: 'center', borderRadius: '13px', border: '1px solid var(--sp-divider)', color: '#C9CDEB' }}
            >
              <SpIcon name={theme === 'dark' ? 'sun' : 'moon'} size={19} />
            </button>
            <div className="sp-mono sp-hdr-date sp-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', height: '40px', padding: '0 14px', borderRadius: '999px', border: '1px solid transparent', fontSize: '12.5px' }}>
              <SpIcon name="calendar" size={15} />
              <span>{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            </div>
            <NotificationBell />
            <button type="button" className="sp-btn sp-display" aria-label="Account" onClick={() => setProfileMenuOpen(v => !v)} style={{ width: '44px', height: '44px', display: 'grid', placeItems: 'center', borderRadius: '50%', fontSize: '16px', fontWeight: 700, color: '#FFFFFF', background: 'linear-gradient(#141A3C, #141A3C) padding-box, linear-gradient(135deg, #6483FD, #5DAAF5) border-box', border: '2px solid transparent', boxShadow: '0 0 22px rgba(98,224,255,.35)' }}>
              {(currentUser?.name || '?').charAt(0).toUpperCase()}
            </button>
          </div>
        </header>

        {/* Content Studio — SaaS redesign (UI-only, logic preserved) */}
        {activeTab === 'studio' && (
          <div style={{ flex: 1, minHeight: 0, backgroundColor: '#f8fafc' }}>
          <StudioWorkspace
            wizardState={wizardState} setWizardState={setWizardState} saveFullDraft={saveFullDraft} cancelPreview={cancelPreview}
            updateAltText={updateAltText} generateAltText={generateAltText} altBusy={altBusy}
            prompt={prompt} setPrompt={setPrompt}
            topicMediaItems={topicMediaItems} removeTopicMedia={removeTopicMedia} clearTopicMedia={clearTopicMedia}
            topicFileInputRef={topicFileInputRef} handleTopicUpload={handleTopicUpload} handleTopicDrop={handleTopicDrop}
            topicDragOver={topicDragOver} setTopicDragOver={setTopicDragOver}
            dragOverTopic={dragOverTopic} setDragOverTopic={setDragOverTopic} handleDragOver={handleDragOver}
            tone={tone} setTone={setTone}
            imageStyle={imageStyle} setImageStyle={setImageStyle}
            aspectRatio={aspectRatio} setAspectRatio={setAspectRatio} aspectRatioMap={aspectRatioMap}
            generateContent={generateContent} isGeneratingContent={isGeneratingContent} regeneratePlatform={regeneratePlatform}
            generateImage={generateImage} isGeneratingImage={isGeneratingImage}
            varyImageFromUrl={varyImageFromUrl} varyingImageUrl={varyingImageUrl}
            selectedPlatforms={selectedPlatforms}
            content={content} setContent={setContent}
            statusMessage={statusMessage}
            generationError={generationError} setGenerationError={setGenerationError}
            platformContent={platformContent} setPlatformContent={setPlatformContent} activePreviewPlatform={activePreviewPlatform} switchPreviewPlatform={switchPreviewPlatform}
            editorTab={editorTab} setEditorTab={setEditorTab}
            imagePrompt={imagePrompt} setImagePrompt={setImagePrompt} clearGeneratedImage={clearGeneratedImage}
            charCount={charCount} wordCount={wordCount}
            mediaItems={mediaItems}
            removeMediaItem={removeMediaItem} clearAllMedia={clearAllMedia} moveMedia={moveMedia}
            handleUploadImage={handleUploadImage} handleDrop={handleDrop}
            isCarousel={isCarousel} setIsCarousel={setIsCarousel}
            trialReel={trialReel} setTrialReel={setTrialReel} instagramReelReady={instagramReelReady}
            collaborators={collaborators} addCollaborator={addCollaboratorEntry} removeCollaborator={removeCollaboratorEntry}
            updateCollaboratorField={updateCollaboratorEntry} markCollaboratorSent={markCollaboratorEntrySent}
            markCollaboratorPending={markCollaboratorEntryPending} markCollaboratorResolved={markCollaboratorEntryResolved}
            instagramPostUrl={instagramPostUrl}
            carouselSlides={carouselSlides} carouselValidation={carouselValidation}
            toggleCarouselSlide={toggleCarouselSlide} moveCarouselSlide={moveCarouselSlide} removeCarouselSlide={removeCarouselSlide}
            reorderCarouselSlide={reorderCarouselSlide} setMediaCover={setMediaCover}
            generateCarouselSlides={generateCarouselSlides} isGeneratingCarousel={isGeneratingCarousel}
            carouselSlideCount={carouselSlideCount} setCarouselSlideCount={setCarouselSlideCount}
            isSavingDraft={isSavingDraft}
            handleMediaDragStart={handleMediaDragStart} handleMediaDragOver={handleMediaDragOver} handleMediaDrop={handleMediaDrop} handleMediaDragEnd={handleMediaDragEnd}
            draggedMediaId={draggedMediaId} dragOverMediaId={dragOverMediaId}
            dragOverPreview={dragOverPreview} setDragOverPreview={setDragOverPreview}
            fileInputRef={fileInputRef}
            generatedImage={generatedImage} generatedVideo={generatedVideo}
            logoImage={logoImage} logoPosition={logoPosition} logoScale={logoScale} logoOpacity={logoOpacity}
            setLogoPosition={setLogoPosition}
            setLogoModalOpen={setLogoModalOpen} logoInputRef={logoInputRef}
            logoTargetId={logoTargetId} setLogoTargetId={setLogoTargetId}
            burnedLogoIds={burnedLogoIds} clearLogo={clearLogo} restoreBurnedMedia={restoreBurnedMedia}
            applyLogoToAllMedia={applyLogoToAllMedia} isApplyingLogo={isApplyingLogo}
            accounts={accounts} togglePlatform={togglePlatform}

            selectedAccountKeys={selectedAccountKeys} toggleAccount={toggleAccount} selectAllAccountsFor={selectAllAccountsFor} clearAccountsFor={clearAccountsFor} connectPlatform={connectPlatform} disconnectPlatform={disconnectPlatform}
            setAccountPageId={setAccountPageId}
            justConnectedPlatform={justConnectedPlatform}
            canvaConnected={canvaConnected} canvaName={canvaName} canvaSourceImage={canvaSourceImage}
            openInCanva={openInCanva} isSendingToCanva={isSendingToCanva}
            createInCanva={createInCanva} isCreatingInCanva={isCreatingInCanva}
            canvaReadyId={canvaReadyId} importFromCanva={importFromCanva} isImportingFromCanva={isImportingFromCanva}
            canvaSession={canvaSession}
            disconnectCanva={disconnectCanva}
            publishToAll={publishToAll} isPublishing={isPublishing} publishSuccessFlash={publishSuccessFlash}
            publishCooldown={publishCooldown}
            publishStatuses={publishStatuses} retryFailedPublish={retryFailedPublish}
            hoveredBtn={hoveredBtn} setHoveredBtn={setHoveredBtn}
            setScheduleModalOpen={setScheduleModalOpen}
            scheduleDate={scheduleDate} setScheduleDate={setScheduleDate}
            scheduleTime={scheduleTime} setScheduleTime={setScheduleTime}
            schedulePost={schedulePost} isScheduling={isScheduling}
            pendingPosts={pendingPosts}
            publishResult={publishResult} setPublishResult={setPublishResult}
            setPublishResultType={setPublishResultType} setShowToast={setShowToast}
            platformColors={platformColors} PlatformIcon={PlatformIcon}
            whapiConnected={whapiConnected} whapiChannelStatus={whapiChannelStatus} whapiAccountName={whapiAccountName} whapiPhoneMasked={whapiPhoneMasked}
            whapiGroups={whapiGroups} whapiSelectedGroupId={whapiSelectedGroupId} setWhapiSelectedGroupId={setWhapiSelectedGroupId}

            whapiDestinations={whapiDestinations} whapiSelectedDestinations={whapiSelectedDestinations} setWhapiSelectedDestinations={setWhapiSelectedDestinations} loadWhapiDestinations={loadWhapiDestinations}
            whapiGroupsLoading={whapiGroupsLoading} whapiGroupsError={whapiGroupsError} loadWhapiGroups={loadWhapiGroups} startWhatsAppConnect={startWhatsAppConnect}
            disconnectWhatsApp={disconnectWhatsApp} whatsappDisconnecting={whatsappDisconnecting} whapiCanConnect={whapiCanConnect}
            publishToWhapi={publishToWhapi} whapiPublishing={whapiPublishing} refreshWhapiStatus={refreshWhapiStatus} whapiLoading={whapiLoading}
          />
          </div>
        )}

        {activeTab === 'connect' && (
          <div style={{ flex: 1, minHeight: 0, backgroundColor: '#f8fafc' }}>
          <ConnectPlatforms
            accounts={accounts} connectPlatform={connectPlatform} disconnectPlatform={disconnectPlatform}
            whapiConnected={whapiConnected} whapiChannelStatus={whapiChannelStatus} whapiAccountName={whapiAccountName} whapiPhoneMasked={whapiPhoneMasked}
            whapiGroups={whapiGroups} whapiLoading={whapiLoading} whapiGroupsLoading={whapiGroupsLoading} loadWhapiGroups={loadWhapiGroups} startWhatsAppConnect={startWhatsAppConnect}
            disconnectWhatsApp={disconnectWhatsApp} whatsappDisconnecting={whatsappDisconnecting} whapiCanConnect={whapiCanConnect}
            canvaConnected={canvaConnected} canvaName={canvaName} disconnectCanva={disconnectCanva} refreshWhapiStatus={refreshWhapiStatus} refreshCanvaStatus={refreshCanvaStatus}
            platformColors={platformColors} PlatformIcon={PlatformIcon}
          />
          </div>
        )}

        {/* Asset Gallery (persistent uploads via AssetLibrary + legacy session view) */}
        {activeTab === 'media' && (
          <div style={{ padding: 24, flex: 1, display: 'flex', flexDirection: 'column', gap: 16, backgroundColor: '#F7F8FC' }}>
            <AssetLibrary sessionItems={mediaItems} onUseAsset={useGalleryAsset} />
            <div style={{ backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E8EAF1', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: 9, background: 'linear-gradient(135deg,#7C3AED,#8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🖼️</div>
              <div><div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>This Session</div><div style={{ fontSize: 11, color: '#64748B' }}>{mediaItems.length} session files • {allPosts.filter(p => getPostMedia(p as never).count! > 0).length} posts with media</div></div>
              <button onClick={() => { goToTab('studio'); }} style={{ marginLeft: 'auto', padding: '9px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, border: 'none', background: 'linear-gradient(135deg,#7C3AED,#8B5CF6)', color: '#fff', cursor: 'pointer' }}>Open Studio →</button>
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

        {/* Dashboard — PROFESSIONAL */}
        {activeTab === 'dashboard' && (() => {
          const connectedCount = accounts.filter(a => a.connected).length + (whapiConnected ? 1 : 0);
          // Both gated on `mounted` so the SSR HTML and the first client render
          // agree (see the `mounted` declaration for the full explanation).
          const firstName = ((mounted ? currentUser?.name : '') || '').split(' ')[0] || 'there';
          const greetHour = mounted ? new Date().getHours() : 12;
          const greeting = greetHour < 12 ? 'Good morning,' : greetHour < 18 ? 'Good afternoon,' : 'Good evening,';
          const platformMeta = {
            linkedin: { label: 'LinkedIn', color: '#8DBBFF', bg: 'rgba(91,155,255,.13)', border: 'rgba(91,155,255,.3)' },
            instagram: { label: 'Instagram', color: '#F9A8D4', bg: 'rgba(244,114,182,.12)', border: 'rgba(244,114,182,.3)' },
            facebook: { label: 'Facebook', color: '#A5B4FF', bg: 'rgba(110,139,255,.13)', border: 'rgba(110,139,255,.3)' },
            whatsapp: { label: 'WhatsApp', color: '#6EE7B7', bg: 'rgba(52,211,153,.12)', border: 'rgba(52,211,153,.3)' },
          } as const;
          const kpiTiles = [
            { label: 'Connected Accounts', value: accounts.length, sub: accounts.length ? 'Active' : 'No connections', icon: 'users' as const, color: '#A9BBFF', bg: 'rgba(100,131,253,.14)', border: 'rgba(100,131,253,.38)', glow: 'rgba(100,131,253,.32)' },
            { label: 'Pending Queue', value: pendingPosts.length, sub: pendingPosts.length ? 'Awaiting publish' : 'Queue empty', icon: 'hourglass' as const, color: '#FFCD85', bg: 'rgba(255,181,71,.12)', border: 'rgba(255,181,71,.36)', glow: 'rgba(255,181,71,.24)' },
            { label: 'Published', value: publishedPosts.length, sub: successRate !== null ? `${successRate}% success rate` : 'No attempts yet', icon: 'checkCircle' as const, color: '#7EEAC3', bg: 'rgba(52,211,153,.12)', border: 'rgba(52,211,153,.36)', glow: 'rgba(52,211,153,.22)' },
            { label: 'Failed / Cancelled', value: failedPosts.length + cancelledPosts.length, sub: failedPosts.length ? 'Needs attention' : 'All clear', icon: 'xCircle' as const, color: '#FDA8B8', bg: 'rgba(251,113,133,.12)', border: 'rgba(251,113,133,.36)', glow: 'rgba(251,113,133,.22)' },
          ];
          // addDaysLocal/localDateKey are local-time based, so these day labels
          // also differ between the server's timezone and the viewer's. Until
          // mounted we render no chart at all (see `mounted`), so the first
          // client render contains no date-derived text and matches the SSR HTML.
          const days = Array.from({ length: 7 }, (_, i) => {
            const d = addDaysLocal(new Date(), -6 + i);
            const key = localDateKey(d);
            const count = allPosts.filter(p => localDateKey(new Date(p.createdAt || p.scheduledAt)) === key).length;
            return { label: d.toLocaleDateString('en-US', { weekday: 'short' }), key, count, isToday: key === todayKey };
          });
          const maxDay = Math.max(1, ...days.map(d => d.count));
          return (
            <div className="sp-main" style={{ width: '100%', maxWidth: '1400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px', padding: '28px 32px 44px' }}>

              {/* Hero */}
              <section className="sp-panel sp-hero" aria-label="Welcome" style={{ position: 'relative', overflow: 'hidden', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 24px', padding: '30px 24px 10px 48px', borderRadius: '30px', border: '1px solid rgba(140,241,255,.2)', background: 'linear-gradient(115deg, rgba(23,29,66,.94) 0%, rgba(14,18,43,.94) 55%, rgba(17,49,55,.94) 100%)', boxShadow: '0 40px 90px -40px rgba(60,185,200,.55)' }}>
                <span aria-hidden="true" style={{ position: 'absolute', right: '-60px', top: '-170px', width: '560px', height: '560px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(92,218,255,.32) 0%, transparent 64%)', pointerEvents: 'none' }} />
                <span aria-hidden="true" style={{ position: 'absolute', left: '-140px', bottom: '-230px', width: '480px', height: '480px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(80,120,255,.2) 0%, transparent 64%)', pointerEvents: 'none' }} />
                <span className="sp-hero-grid" aria-hidden="true" />

                <div style={{ position: 'relative', zIndex: 2, flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '20px', padding: '6px 0 22px' }}>
                  <h2 className="sp-display sp-hero-title" style={{ margin: 0, fontSize: '56px', fontWeight: 600, lineHeight: 1.02, letterSpacing: '-0.03em', color: '#FFFFFF' }}>
                    {greeting}<span className="sp-grad-text" style={{ display: 'block' }}>{firstName}</span>
                  </h2>
                  <p style={{ margin: 0, maxWidth: '470px', fontSize: '16px', lineHeight: 1.6, color: '#B3B8DA' }}>
                    Here&rsquo;s what&rsquo;s happening with your content today · <span style={{ whiteSpace: 'nowrap' }}>{mounted ? new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : ''}</span>
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', paddingTop: '6px' }}>
                    <button type="button" className="sp-btn sp-btn-primary" onClick={() => goToTab('studio')} style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', height: '52px', padding: '0 24px 0 20px', borderRadius: '15px', border: 0, color: '#FFFFFF', fontSize: '15px', fontWeight: 700 }}>
                      <SpIcon name="sparkle" size={19} />
                      <span>Create Post</span>
                    </button>
                    <button type="button" className="sp-btn sp-btn-ghost" onClick={() => goToTab('scheduler')} style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', height: '52px', padding: '0 20px 0 22px', borderRadius: '15px', border: '1px solid rgba(150,242,255,.3)', color: '#E6E8FF', fontSize: '15px', fontWeight: 700 }}>
                      <span>View Schedule</span>
                      <SpIcon name="arrowRight" size={18} />
                    </button>
                  </div>
                </div>

                <DashboardHeroCoin connectedCount={connectedCount} />
              </section>

              {/* KPI cards */}
              <section aria-label="Content overview" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(230px, 100%), 1fr))', gap: '20px' }}>
                {kpiTiles.map(tile => (
                  <article key={tile.label} className="sp-card sp-panel" style={{ position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '18px', padding: '20px 20px 22px', borderRadius: '22px', border: '1px solid var(--sp-panel-border)', background: 'var(--sp-card-bg)' }}>
                    <span className="sp-card-glow" style={{ background: `radial-gradient(circle, ${tile.glow} 0%, transparent 68%)` }} />
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ width: '44px', height: '44px', display: 'grid', placeItems: 'center', borderRadius: '14px', color: tile.color, background: tile.bg, border: `1px solid ${tile.border}`, boxShadow: `0 0 22px ${tile.glow}` }}>
                        <SpIcon name={tile.icon} size={20} />
                      </span>
                      <span role="img" aria-label="No change" style={{ width: '28px', height: '28px', display: 'grid', placeItems: 'center', borderRadius: '50%', color: tile.color, background: tile.bg, border: `1px solid ${tile.border}` }}>
                        <SpIcon name="minus" size={14} />
                      </span>
                    </div>
                    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '7px' }}>
                      <span className="sp-mono" style={{ fontSize: '11px', letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--sp-muted)' }}>{tile.label}</span>
                      <span className="sp-display" style={{ fontSize: '48px', fontWeight: 600, lineHeight: 1, letterSpacing: '-0.02em', color: 'var(--sp-heading)' }}>{tile.value}</span>
                      <span style={{ fontSize: '13px', color: 'var(--sp-muted)' }}>{tile.sub}</span>
                    </div>
                  </article>
                ))}
              </section>

              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '24px' }}>
                <div style={{ flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '24px' }}>

                  {/* Publishing activity */}
                  <section className="sp-panel" aria-label="Publishing activity" style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '18px', padding: '22px 24px 20px', borderRadius: '24px', border: '1px solid var(--sp-panel-border)', background: 'var(--sp-panel-bg)' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        <span style={{ width: '42px', height: '42px', flex: 'none', display: 'grid', placeItems: 'center', borderRadius: '13px', color: '#AEF1FF', background: 'rgba(108,234,255,.13)', border: '1px solid rgba(108,234,255,.32)' }}>
                          <SpIcon name="barsChart" size={19} />
                        </span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <h2 className="sp-display" style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--sp-heading)' }}>Publishing Activity</h2>
                          <p style={{ margin: 0, fontSize: '13px', color: 'var(--sp-muted)' }}>Last 7 days · {allPosts.length} total posts</p>
                        </div>
                      </div>
                      <span className="sp-mono sp-chip" style={{ display: 'inline-flex', alignItems: 'center', height: '30px', padding: '0 12px', borderRadius: '999px', border: '1px solid transparent', fontSize: '10.5px', letterSpacing: '0.14em', textTransform: 'uppercase' as const }}>{successRate !== null ? `${successRate}% delivered` : 'No data'}</span>
                    </div>

                    <div className="sp-chart" style={{ position: 'relative', height: '236px', padding: '18px 18px 14px', borderRadius: '18px', overflow: 'hidden', border: '1px solid transparent' }}>
                      <span aria-hidden="true" style={{ position: 'absolute', left: '18px', right: '18px', top: '25%', borderTop: '1px dashed var(--sp-divider)' }} />
                      <span aria-hidden="true" style={{ position: 'absolute', left: '18px', right: '18px', top: '50%', borderTop: '1px dashed var(--sp-divider)' }} />
                      <span aria-hidden="true" style={{ position: 'absolute', left: '18px', right: '18px', top: '75%', borderTop: '1px dashed var(--sp-divider)' }} />
                      <span className="sp-scan" aria-hidden="true" />
                      <div style={{ position: 'relative', height: '100%', display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '12px' }}>
                        {mounted && days.map(d => (
                          <div key={d.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                            <div className={d.isToday ? 'sp-today' : 'sp-chart-track'} style={{ position: 'relative', flex: 1, width: '100%', maxWidth: '48px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '5px', borderRadius: '14px', background: d.isToday ? 'linear-gradient(180deg, rgba(108,234,255,.04), rgba(108,234,255,.22))' : undefined, border: '1px solid transparent' }}>
                              {d.isToday && <span className="sp-led" style={{ position: 'absolute', left: '50%', top: '12px', width: '7px', height: '7px', marginLeft: '-3.5px', background: '#BEF2FF', color: '#BEF2FF', boxShadow: '0 0 10px #9DF0FF' }} />}
                              <span className={d.isToday ? undefined : 'sp-chart-fill'} style={{ display: 'block', height: d.isToday ? '5px' : '4px', borderRadius: '4px', background: d.isToday ? 'linear-gradient(90deg, #6483FD, #5DAAF5)' : undefined, boxShadow: d.isToday ? '0 0 14px rgba(110,220,255,.9)' : 'none', ...(d.count > 0 ? { height: `${Math.max(5, (d.count / maxDay) * 100)}%`, minHeight: '5px' } : {}) }} />
                            </div>
                            <span className="sp-mono" style={{ fontSize: '11.5px', fontWeight: d.isToday ? 600 : 400, color: d.isToday ? 'var(--sp-link)' : 'var(--sp-muted)' }}>{d.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="sp-soft-icon" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '12px 16px', borderRadius: '14px' }}>
                      <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--sp-muted)' }}>Today · <strong style={{ color: 'var(--sp-heading)', fontWeight: 700 }}>{days[6].count}</strong> posts · <strong style={{ color: 'var(--sp-heading)', fontWeight: 700 }}>{pendingPosts.length}</strong> in queue</p>
                      <a href="#" onClick={(e) => { e.preventDefault(); goToTab('scheduler'); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minHeight: '32px', fontSize: '13.5px', fontWeight: 700, textDecoration: 'none' }}>
                        <span>Open scheduler</span>
                        <SpIcon name="arrowRight" size={16} />
                      </a>
                    </div>
                  </section>

                  {/* Recent activity */}
                  <section className="sp-panel" aria-label="Recent activity" style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '8px', padding: '22px 24px 30px', borderRadius: '24px', border: '1px solid var(--sp-panel-border)', background: 'var(--sp-panel-bg)' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        <span style={{ width: '42px', height: '42px', flex: 'none', display: 'grid', placeItems: 'center', borderRadius: '13px', color: '#AEF1FF', background: 'rgba(108,234,255,.13)', border: '1px solid rgba(108,234,255,.32)' }}>
                          <SpIcon name="clock" size={19} />
                        </span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <h2 className="sp-display" style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--sp-heading)' }}>Recent Activity</h2>
                          <p style={{ margin: 0, fontSize: '13px', color: 'var(--sp-muted)' }}>{allPosts.length} total · {publishedPosts.length} delivered</p>
                        </div>
                      </div>
                      <button type="button" className="sp-btn sp-btn-ghost" onClick={() => goToTab('scheduler')} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', height: '44px', padding: '0 16px', borderRadius: '13px', border: '1px solid rgba(150,242,255,.24)', color: '#D9DCFA', fontSize: '13.5px', fontWeight: 700 }}>
                        <span>View all</span>
                        <SpIcon name="arrowRight" size={16} />
                      </button>
                    </div>

                    {allPosts.length === 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' as const, gap: '10px', padding: '26px 16px 6px' }}>
                        <div className="sp-empty" aria-hidden="true">
                          <span style={{ position: 'absolute', left: '50%', top: '50%', width: '150px', height: '150px', margin: '-75px 0 0 -75px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(108,234,255,.30) 0%, transparent 66%)' }} />
                          <span className="sp-empty-orbit" />
                          <span className="sp-empty-tile" style={{ color: '#BEF2FF', background: 'linear-gradient(160deg, rgba(40,46,96,.95), rgba(18,22,52,.95))', border: '1px solid rgba(168,242,255,.42)', boxShadow: '0 18px 40px -16px rgba(70,229,255,.8), inset 0 1px 0 rgba(255,255,255,.12)' }}>
                            <SpIcon name="doc" size={30} />
                            <span style={{ position: 'absolute', right: '-8px', top: '-8px', width: '26px', height: '26px', display: 'grid', placeItems: 'center', borderRadius: '50%', color: '#FFFFFF', background: 'linear-gradient(135deg, #6483FD, #5DAAF5)', boxShadow: '0 0 16px rgba(110,220,255,.8)' }}>
                              <SpIcon name="plus" size={14} />
                            </span>
                          </span>
                        </div>
                        <h3 className="sp-display" style={{ margin: '6px 0 0', fontSize: '20px', fontWeight: 600, color: 'var(--sp-heading)' }}>No posts yet</h3>
                        <p style={{ margin: 0, fontSize: '14px', color: 'var(--sp-muted)' }}>Create your first AI-powered post in Studio</p>
                        <button type="button" className="sp-btn sp-btn-primary" onClick={() => goToTab('studio')} style={{ marginTop: '12px', display: 'inline-flex', alignItems: 'center', gap: '10px', height: '50px', padding: '0 22px', borderRadius: '15px', border: 0, color: '#FFFFFF', fontSize: '15px', fontWeight: 700 }}>
                          <span>Create your first post</span>
                          <SpIcon name="arrowRight" size={18} />
                        </button>
                      </div>
                    ) : (
                      <div style={{ overflowX: 'auto' as const }}>
                        <div style={{ minWidth: '560px' }}>
                          {allPosts.slice().sort((a, b) => (b.createdAt || b.scheduledAt).localeCompare(a.createdAt || a.scheduledAt)).slice(0, 5).map(post => {
                            const meta = statusMeta[post.status] || statusMeta.pending;
                            const m = getPostMedia(post as unknown as never);
                            return (
                              <div key={post.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 10px', borderBottom: '1px solid rgba(140,241,255,.08)' }}>
                                <div className="sp-soft-icon" style={{ width: '38px', height: '38px', borderRadius: '10px', overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {m.url ? (m.isVideo ? <video src={m.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted /> : <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />) : <SpIcon name="doc" size={16} />}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--sp-heading)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{post.content.split('\n')[0].substring(0, 72)}</div>
                                  <div style={{ fontSize: '11.5px', color: 'var(--sp-muted)', marginTop: '2px' }}>{post.platforms.join(', ')} · {new Date(post.scheduledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                                </div>
                                <span className="sp-mono" style={{ fontSize: '10px', fontWeight: 700, padding: '5px 10px', borderRadius: '999px', background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}44`, letterSpacing: '0.03em', textTransform: 'uppercase' as const, flexShrink: 0 }}>{meta.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </section>
                </div>

                <div style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '24px' }}>

                  {/* Quick actions */}
                  <section className="sp-panel" aria-label="Quick actions" style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '16px', padding: '22px 20px 20px', borderRadius: '24px', border: '1px solid var(--sp-panel-border)', background: 'var(--sp-panel-bg)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ width: '40px', height: '40px', flex: 'none', display: 'grid', placeItems: 'center', borderRadius: '12px', color: '#FFCD85', background: 'rgba(255,181,71,.12)', border: '1px solid rgba(255,181,71,.32)' }}>
                          <SpIcon name="bolt" size={18} />
                        </span>
                        <h2 className="sp-display" style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--sp-heading)' }}>Quick Actions</h2>
                      </div>
                      <span className="sp-mono sp-chip" style={{ display: 'inline-flex', alignItems: 'center', height: '28px', padding: '0 11px', borderRadius: '999px', border: '1px solid transparent', fontSize: '10.5px', letterSpacing: '0.14em', textTransform: 'uppercase' as const }}>{accounts.length ? 'Ready' : 'Setup'}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <button type="button" className="sp-btn sp-btn-primary" onClick={() => goToTab('studio')} style={{ display: 'flex', alignItems: 'center', gap: '14px', width: '100%', minHeight: '64px', padding: '10px 18px 10px 11px', borderRadius: '17px', border: 0, color: '#FFFFFF', textAlign: 'left' }}>
                        <span style={{ width: '42px', height: '42px', flex: 'none', display: 'grid', placeItems: 'center', borderRadius: '12px', background: 'rgba(255,255,255,.16)', border: '1px solid rgba(255,255,255,.24)' }}>
                          <SpIcon name="pencil" size={19} />
                        </span>
                        <span style={{ flex: 1, fontSize: '15.5px', fontWeight: 700 }}>New Post</span>
                        <SpIcon name="arrowRight" size={19} />
                      </button>
                      <button type="button" className="sp-btn sp-btn-ghost" onClick={() => goToTab('scheduler')} style={{ display: 'flex', alignItems: 'center', gap: '14px', width: '100%', minHeight: '64px', padding: '10px 16px 10px 11px', borderRadius: '17px', border: '1px solid rgba(150,242,255,.16)', color: '#E6E8FF', textAlign: 'left' }}>
                        <span style={{ width: '42px', height: '42px', flex: 'none', display: 'grid', placeItems: 'center', borderRadius: '12px', color: '#AEF1FF', background: 'rgba(108,234,255,.12)', border: '1px solid rgba(108,234,255,.28)' }}>
                          <SpIcon name="scheduler" size={19} />
                        </span>
                        <span style={{ flex: 1, fontSize: '15px', fontWeight: 700 }}>View Scheduler</span>
                        <span className="sp-mono" style={{ display: 'inline-flex', alignItems: 'center', height: '26px', padding: '0 10px', borderRadius: '999px', color: '#BEF2FF', background: 'rgba(108,234,255,.14)', border: '1px solid rgba(108,234,255,.3)', fontSize: '11px', fontWeight: 600 }}>{pendingPosts.length} pending</span>
                      </button>
                      <button type="button" className="sp-btn sp-btn-ghost" onClick={() => goToTab('analytics')} style={{ display: 'flex', alignItems: 'center', gap: '14px', width: '100%', minHeight: '64px', padding: '10px 18px 10px 11px', borderRadius: '17px', border: '1px solid rgba(150,242,255,.16)', color: '#E6E8FF', textAlign: 'left' }}>
                        <span style={{ width: '42px', height: '42px', flex: 'none', display: 'grid', placeItems: 'center', borderRadius: '12px', color: '#AEF1FF', background: 'rgba(108,234,255,.12)', border: '1px solid rgba(108,234,255,.28)' }}>
                          <SpIcon name="analytics" size={19} />
                        </span>
                        <span style={{ flex: 1, fontSize: '15px', fontWeight: 700 }}>View Analytics</span>
                        <span style={{ color: 'var(--sp-muted)' }}><SpIcon name="arrowRight" size={18} /></span>
                      </button>
                    </div>
                  </section>

                  {/* Platform health */}
                  <section className="sp-panel" aria-label="Platform health" style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '16px', padding: '22px 20px 20px', borderRadius: '24px', border: '1px solid var(--sp-panel-border)', background: 'var(--sp-panel-bg)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ width: '40px', height: '40px', flex: 'none', display: 'grid', placeItems: 'center', borderRadius: '12px', color: '#A9BBFF', background: 'rgba(100,131,253,.13)', border: '1px solid rgba(100,131,253,.32)' }}>
                          <SpIcon name="globe" size={18} />
                        </span>
                        <h2 className="sp-display" style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--sp-heading)' }}>Platform Health</h2>
                      </div>
                      <span className="sp-mono" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--sp-muted)' }}>{connectedCount}/4 connected</span>
                    </div>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {(['linkedin', 'instagram', 'facebook', 'whatsapp'] as const).map(platform => {
                        const isWhapi = platform === 'whatsapp';
                        const isConnected = isWhapi ? whapiConnected : accounts.some(a => a.platform === platform && a.connected);
                        const justConnected = justConnectedPlatform === platform || (isWhapi && whapiConnected && justConnectedPlatform === 'whatsapp');
                        const meta = platformMeta[platform];
                        return (
                          <li key={platform} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '11px 16px 11px 11px', borderRadius: '16px', background: 'var(--sp-row-bg)', border: '1px solid rgba(140,241,255,.1)', animation: justConnected ? 'connectRowFlash 1.8s ease-out' : 'none' }}>
                            <span style={{ width: '42px', height: '42px', flex: 'none', display: 'grid', placeItems: 'center', borderRadius: '12px', color: meta.color, background: meta.bg, border: `1px solid ${meta.border}`, opacity: isConnected ? 1 : 0.5 }}>
                              <PlatformIcon platform={platform} size={18} />
                            </span>
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1px' }}>
                              <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--sp-heading)' }}>{meta.label}</span>
                              <span style={{ fontSize: '12.5px', color: isConnected ? '#7EEAC3' : 'var(--sp-muted)' }}>{isConnected ? (isWhapi ? `Connected${whapiPhoneMasked ? ` · ${whapiPhoneMasked}` : ' · ready to publish'}` : 'Connected · ready to publish') : 'Not connected'}</span>
                            </div>
                            <span aria-hidden="true" style={{ width: '10px', height: '10px', flex: 'none', borderRadius: '50%', background: isConnected ? '#34D399' : '#3E436C', boxShadow: isConnected ? '0 0 0 4px rgba(52,211,153,.18)' : '0 0 0 4px rgba(90,96,150,.16)' }} />
                          </li>
                        );
                      })}
                    </ul>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '12px 16px', borderRadius: '14px', border: '1px dashed rgba(160,242,255,.32)', background: 'rgba(108,234,255,.07)' }}>
                      <span style={{ fontSize: '13.5px', color: 'var(--sp-text)' }}>{connectedCount ? 'All set for publishing' : 'Connect a platform to start'}</span>
                      <a href="#" onClick={(e) => { e.preventDefault(); goToTab('connect'); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minHeight: '32px', fontSize: '13.5px', fontWeight: 700, textDecoration: 'none' }}>
                        <span>Connect</span>
                        <SpIcon name="arrowRight" size={16} />
                      </a>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          );
        })()}

        {activeTab === 'scheduler' && (
          <div style={{ padding: '24px 32px', flex: 1, display: 'flex', flexDirection: 'column', gap: 20, backgroundColor: '#f8fafc' }}>
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: 0 }}>Scheduler</h2>
              <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>Manage your content lifecycle</p>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' as const }}>
              {([
                { key: 'drafts', label: 'Drafts', icon: '📝', count: newestDrafts([...allPosts.filter(p => ['draft','cancelled'].includes(p.status)), ...legacyDrafts]).length },
                { key: 'pending', label: 'Scheduled', icon: '🗓️', count: pendingPosts.length },
                { key: 'published', label: 'Published', icon: '✅', count: publishedPosts.length },
              ] as const).map(f => {
                const isActive = schedulerFilter === f.key || (f.key==='drafts' && schedulerFilter==='all');
                return (
                  <button
                    key={f.key}
                    onClick={() => setSchedulerFilter(f.key as any)}
                    style={{
                      padding: '9px 18px', borderRadius: '999px', fontSize: '13px', fontWeight: 600,
                      border: isActive ? '2px solid #6366f1' : '2px solid #e2e8f0',
                      backgroundColor: isActive ? '#eef2ff' : '#fff', color: isActive ? '#6366f1' : '#64748b',
                      cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 6
                    }}
                  >
                    <span>{f.icon}</span> {f.label} <span style={{ opacity: 0.7 }}>({f.count})</span>
                  </button>
                );
              })}
              <button
                onClick={() => void checkDuePosts()}
                disabled={isCheckingDue}
                title="Publish all due scheduled posts now"
                style={{
                  marginLeft: 'auto', padding: '9px 18px', borderRadius: '999px', fontSize: '12px', fontWeight: 700,
                  border: 'none', background: 'linear-gradient(135deg, #7C3AED, #8B5CF6)', color: '#fff',
                  cursor: isCheckingDue ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                  boxShadow: '0 2px 8px rgba(124,58,237,0.3)', opacity: isCheckingDue ? 0.7 : 1,
                }}
              >
                {isCheckingDue ? 'Checking…' : '▶ Check now — publish due'}
              </button>
            </div>

            {(schedulerFilter === 'drafts' || schedulerFilter === 'all') && (
              <SchedulerCalendar
                title="Drafts Calendar"
                headerMeta={`${newestDrafts([...allPosts.filter(p => ['draft','cancelled'].includes(p.status)), ...legacyDrafts]).length} drafts`}
                posts={newestDrafts([...allPosts.filter(p => ['draft','cancelled'].includes(p.status)), ...legacyDrafts])}
                dateOf={(p) => (p as unknown as { previousScheduledAt?: string }).previousScheduledAt || p.updatedAt || p.createdAt || ''}
                toDateKey={(iso) => localDateKey(new Date(iso))}
                formatTime={(iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                mode="drafts"
                emptyText="No drafts for this period."
                days={calendarDays}
                todayKey={todayKey}
                dayKeyOf={(d) => localDateKey(d)}
                weekLabel={weekRangeLabel}
                view={calView} onViewChange={setCalView}
                monthAnchor={calMonth}
                monthLabel={calMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                onPrevMonth={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                onNextMonth={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                onPrevWeek={() => setCalendarWeekStart(w => addDaysLocal(w, -7))}
                onNextWeek={() => setCalendarWeekStart(w => addDaysLocal(w, 7))}
                onToday={goCalToday}
                onPostClick={(post) => setPreviewPost(post)}
                onRetryFailed={(post) => retryFailedPost(post)}
                onReconnect={(platform) => reconnectPlatform(platform)}
                onEdit={(post) => editPost(post, false)}
                onSchedule={(post) => editPost(post, true)}
                onDelete={(post) => deleteDraft(post)}
                platformColors={platformColors}
                PlatformIcon={PlatformIcon}
                getMedia={(post) => { const m = getPostMedia(post as never); return { url: m.url, isVideo: m.isVideo }; }}
              />
            )}

            {schedulerFilter === 'pending' && (
              <SchedulerCalendar
                title="Scheduled Calendar"
                headerMeta={`${pendingPosts.length} scheduled • ${failedPosts.length} failed`}
                posts={[...pendingPosts, ...failedPosts]}
                dateOf={(p) => p.scheduledAt || ''}
                toDateKey={(iso) => localDateKey(new Date(iso))}
                formatTime={(iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                mode="scheduled"
                emptyText="No scheduled posts for this period."
                days={calendarDays}
                todayKey={todayKey}
                dayKeyOf={(d) => localDateKey(d)}
                weekLabel={weekRangeLabel}
                view={calView} onViewChange={setCalView}
                monthAnchor={calMonth}
                monthLabel={calMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                onPrevMonth={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                onNextMonth={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                onPrevWeek={() => setCalendarWeekStart(w => addDaysLocal(w, -7))}
                onNextWeek={() => setCalendarWeekStart(w => addDaysLocal(w, 7))}
                onToday={goCalToday}
                onPostClick={(post) => setPreviewPost(post)}
                onRetryFailed={(post) => retryFailedPost(post)}
                onReconnect={(platform) => reconnectPlatform(platform)}
                onReschedule={(post) => openReschedule(post)}
                onCancel={(id) => cancelScheduled(id)}
                onEdit={(post) => editPost(post, post.status === 'failed')}
                onSchedule={(post) => editPost(post, true)}
                platformColors={platformColors}
                PlatformIcon={PlatformIcon}
                getMedia={(post) => { const m = getPostMedia(post as never); return { url: m.url, isVideo: m.isVideo }; }}
              />
            )}

            {schedulerFilter === 'published' && (
              <SchedulerCalendar
                title="Published Calendar"
                headerMeta={`${publishedPosts.length} published`}
                posts={publishedPosts}
                dateOf={(p) => (p as unknown as { publishedAt?: string }).publishedAt || p.scheduledAt || p.updatedAt || ''}
                toDateKey={(iso) => localDateKey(new Date(iso))}
                formatTime={(iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                mode="published"
                emptyText="No published posts for this period."
                days={calendarDays}
                todayKey={todayKey}
                dayKeyOf={(d) => localDateKey(d)}
                weekLabel={weekRangeLabel}
                view={calView} onViewChange={setCalView}
                monthAnchor={calMonth}
                monthLabel={calMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                onPrevMonth={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                onNextMonth={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                onPrevWeek={() => setCalendarWeekStart(w => addDaysLocal(w, -7))}
                onNextWeek={() => setCalendarWeekStart(w => addDaysLocal(w, 7))}
                onToday={goCalToday}
                onPostClick={(post) => setPreviewPost(post)}
                onRetryFailed={(post) => retryFailedPost(post)}
                onReconnect={(platform) => reconnectPlatform(platform)}
                onDuplicate={(post) => duplicatePost(post)}
                platformColors={platformColors}
                PlatformIcon={PlatformIcon}
                getMedia={(post) => { const m = getPostMedia(post as never); return { url: m.url, isVideo: m.isVideo }; }}
              />
            )}

            {previewPost && (
              <div onClick={() => setPreviewPost(null)} style={{ position: 'fixed' as const, inset: 0, backgroundColor: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(2px)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                <div onClick={e => e.stopPropagation()} style={{ backgroundColor: '#fff', borderRadius: 16, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' as const, boxShadow: '0 24px 64px rgba(15,23,42,0.3)' }}>
                  <div style={{ padding: '18px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{previewPost.status === 'published' ? 'Published Post' : previewPost.status === 'failed' ? 'Failed Post' : previewPost.status === 'draft' || previewPost.status === 'cancelled' ? 'Draft' : 'Scheduled Post'}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{(previewPost.scheduledAt ? new Date(previewPost.scheduledAt) : new Date(previewPost.createdAt || Date.now())).toLocaleString()}</div>
                    </div>
                    <button onClick={() => setPreviewPost(null)} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', backgroundColor: '#f1f5f9', color: '#64748b', cursor: 'pointer' }}>×</button>
                  </div>
                  <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ fontSize: 13, color: '#0f172a', whiteSpace: 'pre-wrap' as const, lineHeight: 1.6 }}>{previewPost.content}</div>
                    {(() => { const m = getPostMedia(previewPost as unknown as never); return m.url ? (m.isVideo ? <video src={m.url} style={{ width: '100%', borderRadius: 10 }} controls /> : <img src={m.url} alt="" style={{ width: '100%', borderRadius: 10 }} />) : null; })()}
                    <div style={{ fontSize: 11, color: '#64748b' }}>Platforms: {previewPost.platforms.join(', ')} • {previewPost.status}{previewPost.status==='failed' && ' • not published'}</div>
                    {(previewPost as PostRecord).trialReel === true && previewPost.platforms.includes('instagram') && (
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#7c3aed', backgroundColor: '#f5f3ff', border: '1px solid #ddd6fe', padding: '7px 12px', borderRadius: 8, textAlign: 'center' as const }}>🎬 Trial Reel — shown to non-followers first</div>
                    )}
                    {previewPost.status === 'pending' && <div style={{ display: 'flex', gap: 8 }}><button onClick={() => { setPreviewPost(null); openReschedule(previewPost); }} style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', backgroundColor: '#eef2ff', color: '#4338ca', fontWeight: 600, cursor: 'pointer' }}>Reschedule</button><button onClick={() => { cancelScheduled(previewPost.id); setPreviewPost(null); }} style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', backgroundColor: '#fef2f2', color: '#dc2626', fontWeight: 600, cursor: 'pointer' }}>Cancel → Draft</button></div>}
                    {previewPost.status === 'failed' && <div style={{ display: 'flex', gap: 8 }}><button onClick={() => { editPost(previewPost, true); setPreviewPost(null); }} style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', backgroundColor: '#eef2ff', color: '#4338ca', fontWeight: 600, cursor: 'pointer' }}>Edit as Draft</button><button onClick={() => { cancelScheduled(previewPost.id); setPreviewPost(null); }} style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #e2e8f0', backgroundColor: '#fff', color: '#64748b', cursor: 'pointer' }}>Move to Drafts</button></div>}
                    {previewPost.status === 'published' && <div style={{ fontSize: 11, color: '#059669', backgroundColor: '#ecfdf5', padding: '8px 12px', borderRadius: 8, textAlign: 'center' as const }}>Read-only • published {new Date(previewPost.scheduledAt || previewPost.createdAt || '').toLocaleString()}</div>}
                    {(previewPost.status==='draft' || previewPost.status==='cancelled') && <div style={{ display: 'flex', gap: 8 }}><button onClick={() => { editPost(previewPost, true); setPreviewPost(null); }} style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Edit / Schedule</button><button onClick={() => { deleteDraft(previewPost); setPreviewPost(null); }} style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}>Delete</button></div>}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Analytics */}

        {/* Analytics */}
        {activeTab === 'analytics' && (
          <div style={{ padding: '24px 32px', flex: 1, display: 'flex', flexDirection: 'column', gap: '24px', backgroundColor: '#f8fafc' }}>
            {allPosts.length === 0 ? (
              <div style={{ backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', padding: '56px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '36px', opacity: 0.3 }}>📈</span>
                <span style={{ fontSize: '14px', color: '#64748b', fontWeight: 500 }}>No analytics yet</span>
                <span style={{ fontSize: '12px', color: '#94a3b8', maxWidth: '320px', textAlign: 'center' as const }}>Schedule and publish posts to see performance data here.</span>
                <button
                  onClick={() => goToTab('studio')}
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

      {/* AI generation modal — the single generation status UI while a real
          request runs. Opens on Generate / Generate-slides, follows the live
          request only. */}
      {genModal && (
        <AIGenerationModal
          mode={genModal.mode}
          phase={genModal.phase}
          items={genModal.items}
          error={genModal.error}
          onUseSelected={genModal.mode === 'image' ? applyModalImageSelection : useModalCarouselSelection}
          onRegenerate={regenerateModal}
          onRetry={regenerateModal}
          onClose={closeGenModal}
        />
      )}

      {/* Server-side moderation warning. Shown when OUR pre-generation gate
          blocked the request; nothing was sent to any provider and the prompt
          was left untouched. Confirmed violations advance the account counter
          (first attempt is a warning only, never a suspension); clarification
          requests do not count. */}
      {moderationWarning && (() => {
        const warnBody =
          moderationWarning.violationCount < 2
            ? 'Warning ' + moderationWarning.violationCount + ' of 2 on this account. One more blocked request will flag your account for review.'
            : 'Warning ' + moderationWarning.violationCount + ' on this account. This account has been flagged for review.';
        return (
        <div
          onClick={() => setModerationWarning(null)}
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(2px)',
            zIndex: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
            animation: 'overlayIn 0.15s ease-out',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="sp-moderation-warning-title"
            style={{
              backgroundColor: '#fff', borderRadius: '18px', width: '100%', maxWidth: '470px',
              boxShadow: '0 24px 64px rgba(15,23,42,0.3)', animation: 'modalPopIn 0.2s cubic-bezier(0.16,1,0.3,1)',
            }}
          >
            <div style={{ padding: '22px 24px 0', display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{
                width: '42px', height: '42px', borderRadius: '12px', flexShrink: 0,
                background: 'linear-gradient(135deg,#ef4444,#b91c1c)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '19px',
              }}>&#9888;</div>
              <div>
                <div id="sp-moderation-warning-title" style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>{moderationWarning.title || 'Content Safety Warning'}</div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '1px' }}>This request was not processed — your prompt is unchanged</div>
              </div>
            </div>
            <div style={{ padding: '18px 24px 22px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '13px', color: '#334155', lineHeight: 1.65 }}>{moderationWarning.message}</div>
              {moderationWarning.guidance && moderationWarning.guidance.length > 0 && (
                <div style={{ fontSize: '12.5px', color: '#334155', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', padding: '11px 13px', borderRadius: '10px', lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>What to change:</div>
                  {moderationWarning.guidance.map(g => (
                    <div key={g} style={{ display: 'flex', gap: 7, marginTop: 3 }}><span>•</span><span>{g}</span></div>
                  ))}
                </div>
              )}
              {moderationWarning.exampleInstead && (
                <div style={{ fontSize: '12.5px', color: '#334155', lineHeight: 1.6 }}>
                  <div style={{ marginBottom: 4 }}>Instead of: <i>“{moderationWarning.exampleInstead}”</i></div>
                  {moderationWarning.exampleUse && <div>Use: <i>“{moderationWarning.exampleUse}”</i></div>}
                </div>
              )}
              {moderationWarning.violationCount > 0 && (
                <div style={{
                  fontSize: '12px', color: '#b45309', backgroundColor: '#fffbeb', border: '1px solid #fde68a',
                  padding: '10px 12px', borderRadius: '10px', lineHeight: 1.55,
                }}>{warnBody}</div>
              )}
              <button
                onClick={() => setModerationWarning(null)}
                style={{ padding: '11px 18px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg,#7C3AED,#8B5CF6)', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
              >{moderationWarning.category ? 'Edit Prompt' : 'I Understand'}</button>
            </div>
          </div>
        </div>
        );
      })()}


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

              {instagramReelReady && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '11px 13px', borderRadius: '10px', border: `1.5px solid ${trialReel ? '#6366f1' : '#e2e8f0'}`, backgroundColor: trialReel ? '#eef2ff' : '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <input type="checkbox" checked={trialReel} onChange={e => setTrialReel(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: '#6366f1', cursor: 'pointer' }} />
                  <span style={{ fontSize: '13px', fontWeight: 700, color: trialReel ? '#4338ca' : '#0f172a' }}>Post as Trial Reel</span>
                </label>
              )}

              {selectedPlatforms.includes('instagram') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>Instagram collaborators (optional)</label>
                  {collaborators.map((c, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <input
                        value={c.username}
                        onChange={e => updateCollaboratorEntry(i, { username: e.target.value.replace(/^@+/, '').slice(0, 30) })}
                        placeholder="username (without @)"
                        autoComplete="off"
                        style={{ flex: '1 1 160px', minWidth: 0, padding: '11px 13px', borderRadius: '10px', border: `1.5px solid ${c.username ? '#6366f1' : '#e2e8f0'}`, backgroundColor: '#fff', color: '#0f172a', fontSize: '13px', outline: 'none', fontFamily: 'inherit' }}
                      />
                      <select
                        value={c.type}
                        onChange={e => updateCollaboratorEntry(i, { type: e.target.value as 'professional' | 'private' })}
                        style={{ padding: '9px 10px', borderRadius: '10px', border: '1.5px solid #e2e8f0', fontFamily: 'inherit', fontSize: '13px' }}
                      >
                        <option value="professional">Professional (Business/Creator)</option>
                        <option value="private">Private (Personal)</option>
                      </select>
                      <button type="button" onClick={() => removeCollaboratorEntry(i)} aria-label="Remove collaborator" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '15px', color: '#64748b' }}>✕</button>
                    </div>
                  ))}
                  {collaborators.length < 3 && (
                    <button type="button" onClick={addCollaboratorEntry} style={{ alignSelf: 'flex-start', border: '1px dashed #cbd5e1', background: 'transparent', borderRadius: '8px', padding: '6px 12px', fontSize: '12.5px', fontWeight: 700, color: '#4338ca', cursor: 'pointer', fontFamily: 'inherit' }}>+ Add collaborator</button>
                  )}
                  <small style={{ fontSize: '11px', color: '#64748b' }}>Professional accounts receive an automatic Instagram invite. Personal accounts can't be invited through the API — you'll complete that step manually in the Instagram app after publishing.</small>
                </div>
              )}

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
                      onClick={() => { setScheduleModalOpen(false); goToTab('scheduler'); setSchedulerFilter('pending'); }}
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
                    <button onClick={() => clearLogo()} title="Remove the logo and restore clean originals" style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #fecaca', backgroundColor: '#fff', color: '#dc2626', fontSize: '11px', cursor: 'pointer' }}>Remove</button>
                  </div>
                  {/* Position grid */}
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#0f172a', marginBottom: '8px', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Position</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                      {(['top-left','top-right','center','bottom-left','bottom-right'] as const).map(pos => (
                        <button key={pos} onClick={() => { geometryTouchedRef.current = true; setLogoPosition(pos); }} style={{ padding: '10px 6px', borderRadius: '10px', border: logoPosition === pos ? '2px solid #0A66C2' : '1px solid #e2e8f0', backgroundColor: logoPosition === pos ? '#eef2ff' : '#fff', color: logoPosition === pos ? '#0A66C2' : '#475569', fontSize: '11px', fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' as const }}>
                          {pos.replace('-', ' ')} {logoPosition === pos && '✓'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: '#0f172a' }}>Size: {Math.round(logoScale*100)}%</label>
                        <input type="range" min={0.1} max={0.35} step={0.02} value={logoScale} onChange={e => { geometryTouchedRef.current = true; setLogoScale(parseFloat(e.target.value)); }} style={{ width: '100%', marginTop: '6px' }} />
                      <div style={{ fontSize: '10px', color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}><span>Small</span><span>Large</span></div>
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: '#0f172a' }}>Opacity: {Math.round(logoOpacity*100)}%</label>
                        <input type="range" min={0.5} max={1} step={0.05} value={logoOpacity} onChange={e => { geometryTouchedRef.current = true; setLogoOpacity(parseFloat(e.target.value)); }} style={{ width: '100%', marginTop: '6px' }} />
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

      {whatsappConnectOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.46)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: 'min(430px, 100%)', background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', boxShadow: '0 22px 70px rgba(15,23,42,0.28)', padding: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ width: 38, height: 38, borderRadius: 12, background: 'linear-gradient(135deg,#25D366,#128C7E)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>💬</span>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, color: '#0F172A' }}>Connect WhatsApp</h3>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: '#64748B' }}>Scan this QR using WhatsApp. Your account is only connected after the scan is confirmed.</p>
              </div>
            </div>
            <div style={{ border: '1px solid #E2E8F0', borderRadius: 14, padding: 16, textAlign: 'center', background: '#F8FAFC' }}>
              {whatsappConnecting ? (
                <div style={{ minHeight: 230, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B', fontSize: 13 }}>Preparing secure connection…</div>
              ) : whatsappQrImage ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={whatsappQrImage} alt="WhatsApp connection QR code" style={{ width: 220, height: 220, objectFit: 'contain', background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', padding: 10 }} />
                  <p style={{ margin: '12px auto 0', maxWidth: 300, color: '#475569', fontSize: 12, lineHeight: 1.55 }}>{whatsappConnectMessage}</p>
                  <div
                    aria-live="polite"
                    style={{
                      margin: '10px auto 0', maxWidth: 300, display: 'inline-flex', alignItems: 'center', gap: 7,
                      padding: '5px 12px', borderRadius: 999,
                      background: whatsappQrStatus === 'WAITING_FOR_SCAN' ? '#ECFDF5' : '#F1F5F9',
                      border: `1px solid ${whatsappQrStatus === 'WAITING_FOR_SCAN' ? '#A7F3D0' : '#E2E8F0'}`,
                      color: whatsappQrStatus === 'WAITING_FOR_SCAN' ? '#047857' : '#64748B',
                      fontSize: 11.5, fontWeight: 800,
                    }}
                  >
                    {whatsappQrStatus === 'WAITING_FOR_SCAN' && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981' }} />}
                    {whatsappQrStatus === 'WAITING_FOR_SCAN'
                      ? 'Status: Waiting for scan…'
                      : whatsappQrStatus === 'EXPIRED'
                        ? 'Status: QR expired'
                        : whatsappQrStatus === 'CANCELLED'
                          ? 'Status: Cancelled'
                          : `Status: ${(whatsappQrStatus || 'PENDING').replace(/_/g, ' ')}`}
                    {whatsappQrSecondsLeft !== null && whatsappQrStatus === 'WAITING_FOR_SCAN' && (
                      <span style={{ opacity: 0.75, fontWeight: 700 }}>
                        · {Math.floor(whatsappQrSecondsLeft / 60)}:{String(whatsappQrSecondsLeft % 60).padStart(2, '0')} left
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <p style={{ margin: '52px auto', maxWidth: 320, color: '#475569', fontSize: 13, lineHeight: 1.6 }}>{whatsappConnectMessage || 'Connection information will appear here.'}</p>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button
                onClick={cancelWhatsAppQr}
                style={{ flex: 1, padding: '11px 14px', borderRadius: 10, border: '1px solid #CBD5E1', background: '#fff', color: '#334155', fontWeight: 700, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={startWhatsAppConnect}
                disabled={whatsappConnecting || whapiLoading}
                style={{ flex: 1, padding: '11px 14px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#25D366,#128C7E)', color: '#fff', fontWeight: 800, cursor: whatsappConnecting || whapiLoading ? 'wait' : 'pointer', opacity: whatsappConnecting || whapiLoading ? 0.7 : 1 }}
              >
                {whatsappConnecting ? 'Preparing…' : whatsappQrImage && whatsappQrStatus !== 'EXPIRED' && whatsappQrStatus !== 'CANCELLED' ? 'Refresh QR' : 'Generate New QR'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disconnect warning — shown only when the platform has future scheduled posts */}
      {disconnectTarget && (
        <div onClick={() => !isDisconnecting && setDisconnectTarget(null)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(2px)', zIndex: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', animation: 'overlayIn 0.15s ease-out' }}>
          <div onClick={e => e.stopPropagation()} style={{ backgroundColor: '#fff', borderRadius: '16px', width: '100%', maxWidth: '420px', boxShadow: '0 24px 64px rgba(15,23,42,0.3)', animation: 'modalPopIn 0.2s cubic-bezier(0.16,1,0.3,1)', padding: '24px' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '50%', backgroundColor: '#fffbeb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', marginBottom: '14px' }}>⚠️</div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>
              {disconnectTarget.unverified
                ? `Disconnect ${labelForPlatform(disconnectTarget.platform)}?`
                : `${labelForPlatform(disconnectTarget.platform)} has ${disconnectTarget.count} scheduled post${disconnectTarget.count === 1 ? '' : 's'}.`}
            </h3>
            <p style={{ fontSize: '13px', color: '#64748b', lineHeight: 1.55, margin: '0 0 20px' }}>
              {disconnectTarget.unverified
                ? 'We could not check for scheduled posts, so any that are due will wait until the account is reconnected.'
                : `Disconnecting ${labelForPlatform(disconnectTarget.platform)} will prevent these posts from publishing until the account is reconnected. You can reconnect and retry them at any time.`}
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setDisconnectTarget(null)}
                disabled={isDisconnecting}
                style={{ flex: 1, padding: '11px', borderRadius: '10px', border: '1px solid #e2e8f0', backgroundColor: '#fff', color: '#334155', fontSize: '13px', fontWeight: 700, cursor: isDisconnecting ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
              >Keep Connected</button>
              <button
                onClick={confirmDisconnectPlatform}
                disabled={isDisconnecting}
                style={{ flex: 1, padding: '11px', borderRadius: '10px', border: 'none', backgroundColor: isDisconnecting ? '#fca5a5' : '#dc2626', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: isDisconnecting ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
              >{isDisconnecting ? 'Disconnecting…' : 'Disconnect Anyway'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Scheduled Post — confirmation modal */}
      {cancelTarget && (
        <div onClick={() => !isCancelling && setCancelTarget(null)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(2px)', zIndex: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', animation: 'overlayIn 0.15s ease-out' }}>
          <div onClick={e => e.stopPropagation()} style={{ backgroundColor: '#fff', borderRadius: '16px', width: '100%', maxWidth: '400px', boxShadow: '0 24px 64px rgba(15,23,42,0.3)', animation: 'modalPopIn 0.2s cubic-bezier(0.16,1,0.3,1)', padding: '24px' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '50%', backgroundColor: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', marginBottom: '14px' }}>⚠️</div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>Cancel Scheduled Post?</h3>
            <p style={{ fontSize: '13px', color: '#64748b', lineHeight: 1.5, margin: '0 0 20px' }}>Are you sure you want to cancel this scheduled post? It will not be published, and will move to Drafts with its content and media preserved.</p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setCancelTarget(null)}
                disabled={isCancelling}
                style={{ flex: 1, padding: '11px', borderRadius: '10px', border: '1px solid #e2e8f0', backgroundColor: '#fff', color: '#334155', fontSize: '13px', fontWeight: 600, cursor: isCancelling ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
              >Keep Scheduled</button>
              <button
                onClick={confirmCancelScheduled}
                disabled={isCancelling}
                style={{ flex: 1, padding: '11px', borderRadius: '10px', border: 'none', backgroundColor: isCancelling ? '#fca5a5' : '#dc2626', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: isCancelling ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
              >{isCancelling ? 'Cancelling…' : 'Cancel Post'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule Post modal */}
      {rescheduleTarget && (
        <div onClick={() => !isRescheduling && setRescheduleTarget(null)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(2px)', zIndex: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', animation: 'overlayIn 0.15s ease-out' }}>
          <div onClick={e => e.stopPropagation()} style={{ backgroundColor: '#fff', borderRadius: '16px', width: '100%', maxWidth: '400px', boxShadow: '0 24px 64px rgba(15,23,42,0.3)', animation: 'modalPopIn 0.2s cubic-bezier(0.16,1,0.3,1)', padding: '24px' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '50%', backgroundColor: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', marginBottom: '14px' }}>🗓️</div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', margin: '0 0 4px' }}>Reschedule Post</h3>
            <p style={{ fontSize: '13px', color: '#64748b', lineHeight: 1.5, margin: '0 0 18px' }}>
              Currently scheduled for {rescheduleTarget.scheduledAt ? new Date(rescheduleTarget.scheduledAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}. Pick a new date and time.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '18px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '6px' }}>Date</label>
                <input
                  type="date"
                  value={rescheduleDate}
                  min={localDateKey(new Date())}
                  onChange={e => setRescheduleDate(e.target.value)}
                  style={{ width: '100%', padding: '9px 10px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', fontFamily: 'inherit', color: '#0f172a' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '6px' }}>Time</label>
                <input
                  type="time"
                  value={rescheduleTime}
                  onChange={e => setRescheduleTime(e.target.value)}
                  style={{ width: '100%', padding: '9px 10px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', fontFamily: 'inherit', color: '#0f172a' }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setRescheduleTarget(null)}
                disabled={isRescheduling}
                style={{ flex: 1, padding: '11px', borderRadius: '10px', border: '1px solid #e2e8f0', backgroundColor: '#fff', color: '#334155', fontSize: '13px', fontWeight: 600, cursor: isRescheduling ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
              >Cancel</button>
              <button
                onClick={confirmReschedule}
                disabled={isRescheduling || !rescheduleDate || !rescheduleTime}
                style={{ flex: 1, padding: '11px', borderRadius: '10px', border: 'none', background: isRescheduling || !rescheduleDate || !rescheduleTime ? '#e2e8f0' : 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: isRescheduling || !rescheduleDate || !rescheduleTime ? '#94a3b8' : '#fff', fontSize: '13px', fontWeight: 700, cursor: isRescheduling || !rescheduleDate || !rescheduleTime ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
              >{isRescheduling ? 'Rescheduling…' : 'Confirm Reschedule'}</button>
            </div>
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
          {publishResult === 'Post cancelled and moved to Drafts.' && <button onClick={() => { goToTab('scheduler'); setSchedulerFilter('drafts'); setShowToast(false); }}>View Draft</button>}
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
