'use client';

import { useState } from 'react';
import type { MediaItem } from './social-media-manager';
import type { Collaborator } from '@/lib/posts';
import StudioWizard from './studio-wizard';

// ---------------------------------------------------------------------------
// Design tokens (spec §16)
// ---------------------------------------------------------------------------
const C = {
  page: '#F7F8FC',
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
  success: '#059669',
  successBg: '#ECFDF5',
  warnBg: '#FFFBEB',
  warnBorder: '#FDE68A',
  warnInk: '#92400E',
};

const card: React.CSSProperties = {
  backgroundColor: C.card,
  borderRadius: 14,
  border: `1px solid ${C.border}`,
  boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 14px rgba(15,23,42,0.04)',
  overflow: 'hidden',
};

const cardHead: React.CSSProperties = {
  padding: '14px 18px',
  borderBottom: `1px solid ${C.borderSoft}`,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

const cardTitle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: C.ink, letterSpacing: '-0.01em' };
const cardSub: React.CSSProperties = { fontSize: 11, color: C.muted, marginTop: 1 };

const iconTile = (bg: string): React.CSSProperties => ({
  width: 30, height: 30, borderRadius: 9, background: bg,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 14, flexShrink: 0,
});

const btnBase: React.CSSProperties = {
  minHeight: 42, padding: '10px 14px', borderRadius: 10,
  fontSize: 13, fontWeight: 700, cursor: 'pointer',
  fontFamily: 'inherit', transition: 'all 0.18s',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%',
};

const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  ...btnBase,
  border: 'none',
  background: disabled ? '#DDD6FE' : 'linear-gradient(135deg, #7C3AED, #8B5CF6)',
  color: '#fff',
  cursor: disabled ? 'not-allowed' : 'pointer',
  boxShadow: disabled ? 'none' : '0 3px 12px rgba(124,58,237,0.28)',
});

const secondaryBtn: React.CSSProperties = {
  ...btnBase,
  border: `1.5px solid ${C.border}`,
  backgroundColor: '#fff',
  color: C.primary,
};

const selectBtn = (active: boolean): React.CSSProperties => ({
  padding: '9px 6px', borderRadius: 10, fontSize: 12, fontWeight: 600,
  border: active ? `1.5px solid ${C.primary}` : `1px solid ${C.border}`,
  background: active ? C.primarySoft : '#fff',
  color: active ? C.primaryDark : '#475569',
  cursor: 'pointer', transition: 'all 0.18s', fontFamily: 'inherit',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  boxShadow: active ? '0 2px 8px rgba(124,58,237,0.14)' : 'none',
  minHeight: 40,
});

// ---------------------------------------------------------------------------
// Types — props mirror existing page.tsx state/handlers (no logic moved)
// ---------------------------------------------------------------------------
export interface StudioWorkspaceProps {
  wizardState: Record<string, unknown>;
  setWizardState: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  saveFullDraft: () => void;
  cancelPreview: () => Promise<boolean>;
  updateAltText: (id: string, text: string) => void;
  generateAltText: (items: MediaItem[]) => Promise<void>;
  altBusy: boolean;
  // topic
  prompt: string; setPrompt: (v: string) => void;
  topicMediaItems: MediaItem[]; removeTopicMedia: (id: string) => void; clearTopicMedia: () => void;
  topicFileInputRef: React.RefObject<HTMLInputElement | null>;
  handleTopicUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleTopicDrop: (e: React.DragEvent) => void;
  topicDragOver: boolean; setTopicDragOver: (v: boolean) => void;
  dragOverTopic: boolean; setDragOverTopic: (v: boolean) => void;
  handleDragOver: (e: React.DragEvent) => void;
  // settings
  tone: string; setTone: (v: string) => void;
  imageStyle: string; setImageStyle: (v: string) => void;
  aspectRatio: string; setAspectRatio: (v: string) => void;
  aspectRatioMap: Record<string, { width: number; height: number; label: string; icon: string }>;
  // generation
  generateContent: () => void; isGeneratingContent: boolean;
  regeneratePlatform: (platform: string) => void;
  generateImage: () => void; isGeneratingImage: boolean;
  varyImageFromUrl: (url: string) => void; varyingImageUrl: string | null;
  selectedPlatforms: string[];
  content: string; setContent: (v: string) => void;
  statusMessage: string;
  generationError: string; setGenerationError: (v: string) => void;
  platformContent: Record<string, { caption: string; hashtags: string[] }>;
  setPlatformContent: (v: Record<string, { caption: string; hashtags: string[] }>) => void;
  activePreviewPlatform: string; switchPreviewPlatform: (p: string) => void;
  editorTab: 'edit' | 'preview'; setEditorTab: (v: 'edit' | 'preview') => void;
  imagePrompt: string; setImagePrompt: (v: string) => void;
  clearGeneratedImage: () => void;
  charCount: number; wordCount: number;
  // media
  mediaItems: MediaItem[];
  removeMediaItem: (id: string) => void; clearAllMedia: () => void; moveMedia: (id: string, dir: -1 | 1) => void;
  handleUploadImage: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleMediaDragStart: (id: string) => void;
  handleMediaDragOver: (e: React.DragEvent, id: string) => void;
  handleMediaDrop: (e: React.DragEvent, id: string) => void;
  handleMediaDragEnd: () => void;
  draggedMediaId: string | null; dragOverMediaId: string | null;
  dragOverPreview: boolean; setDragOverPreview: (v: boolean) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  generatedImage: string; generatedVideo: string;
  // carousel (multi-image swipeable post — ordered image-only subset, 1–9)
  isCarousel: boolean; setIsCarousel: (v: boolean) => void;
  carouselSlides: MediaItem[]; carouselValidation: { valid: boolean; reason: string };
  toggleCarouselSlide: (id: string) => void; moveCarouselSlide: (id: string, dir: -1 | 1) => void; removeCarouselSlide: (id: string) => void;
  reorderCarouselSlide: (activeId: string, overId: string) => void; setMediaCover: (id: string) => void;
  generateCarouselSlides: (count: number) => void; isGeneratingCarousel: boolean;
  carouselSlideCount: number; setCarouselSlideCount: (v: number) => void;
  // Instagram Trial Reel (checkbox only for IG + single video Reel)
  trialReel: boolean; setTrialReel: (v: boolean) => void; instagramReelReady: boolean;
  collaborators: Collaborator[];
  addCollaborator: () => void;
  removeCollaborator: (index: number) => void;
  updateCollaboratorField: (index: number, patch: Partial<Collaborator>) => void;
  markCollaboratorSent: (index: number) => void;
  markCollaboratorPending: (index: number) => void;
  markCollaboratorResolved: (index: number, outcome: 'Accepted' | 'Declined') => void;
  instagramPostUrl: string;
  isSavingDraft: boolean;
  // brand
  logoImage: string; logoPosition: string; logoScale: number; logoOpacity: number;
  setLogoPosition: (v: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center') => void;
  setLogoModalOpen: (v: boolean) => void;
  logoInputRef: React.RefObject<HTMLInputElement | null>;
  logoTargetId: string | null; setLogoTargetId: (v: string | null) => void;
  burnedLogoIds: Record<string, boolean>; clearLogo: () => void; restoreBurnedMedia: () => void;
  applyLogoToAllMedia: (logoOverride?: string, opts?: { keepOpen?: boolean }) => void; isApplyingLogo: boolean;
  // platforms / accounts
  accounts: Array<{ platform: string; connected: boolean; name: string; email: string; accessToken?: string; userId: string; pages?: Array<{ id: string; name: string }>; pageId?: string }>;
  togglePlatform: (p: string) => void;
  setAccountPageId: (platform: string, pageId: string) => void;
  connectPlatform: (p: string) => void;
  disconnectPlatform: (p: string) => void;
  justConnectedPlatform: string | null;
  // Canva (Connect API - optional editing source for Step 4)
  canvaConnected: boolean; canvaName: string; canvaSourceImage: string;
  openInCanva: (sourceUrl?: string) => void; isSendingToCanva: boolean;
  createInCanva: () => void; isCreatingInCanva: boolean;
  canvaReadyId: string; importFromCanva: () => void; isImportingFromCanva: boolean;
  canvaSession: { mode: string; openedAt: number } | null;
  disconnectCanva: () => void;
  // publish
  publishToAll: (targets?: string[]) => void; isPublishing: boolean; publishSuccessFlash: boolean;
  publishStatuses: Record<string, { state: 'pending' | 'success' | 'failed'; message?: string }>;
  retryFailedPublish: () => void;
  publishCooldown: number;
  hoveredBtn: string | null; setHoveredBtn: (v: string | null) => void;
  setScheduleModalOpen: (v: boolean) => void;
  scheduleDate: string; setScheduleDate: (v: string) => void;
  schedulePost: () => Promise<void>; isScheduling: boolean;
  scheduleTime: string; setScheduleTime: (v: string) => void;
  pendingPosts: Array<{ id: string }>;
  publishResult: string; setPublishResult: (v: string) => void;
  setPublishResultType: (v: 'success' | 'error') => void;
  setShowToast: (v: boolean) => void;
  platformColors: Record<string, string>;
  PlatformIcon: ({ platform, size }: { platform: string; size?: number }) => React.JSX.Element;
  // Whapi — existing-group publishing (separate from Meta)
  whapiConnected: boolean; whapiChannelStatus: string; whapiAccountName: string; whapiPhoneMasked: string;
  whapiGroups: Array<{ id: string; name: string; participantsCount: number; type: string; source?: 'community' | 'group' }>; whapiSelectedGroupId: string; setWhapiSelectedGroupId: (v: string) => void;
  whapiGroupsLoading: boolean; whapiGroupsError: string; loadWhapiGroups: () => void; startWhatsAppConnect: () => void;
  // Unified multi-destination selection (communities + groups + chats).
  whapiDestinations: Array<{ id: string; name: string; type: 'community' | 'group' | 'chat'; participantsCount: number; sendId: string }>;
  whapiSelectedDestinations: Set<string>;
  setWhapiSelectedDestinations: (v: Set<string>) => void;
  loadWhapiDestinations: () => void;
  // Per-account multi-select so a platform with several connected logins can
  // target any subset of them.
  selectedAccountKeys: string[];
  toggleAccount: (key: string) => void;
  selectAllAccountsFor: (platform: string) => void;
  clearAccountsFor: (platform: string) => void;
  disconnectWhatsApp: () => void; whatsappDisconnecting: boolean; whapiCanConnect: boolean;
  publishToWhapi: () => void; whapiPublishing: boolean; refreshWhapiStatus: () => void; whapiLoading: boolean;
}

function formatHashtagsLocal(tags: string[]): string {
  return tags.map(t => `#${String(t).replace(/^#+/, '').trim()}`).filter(t => t.length > 1).join(' ');
}

// ---------------------------------------------------------------------------
// Workflow stepper (presentation-only, derived from existing state)
// ---------------------------------------------------------------------------
function WorkflowStepper({ step }: { step: number }) {
  const steps = [
    { n: 1, t: 'Idea', s: 'Tell us your idea' },
    { n: 2, t: 'Content', s: 'AI generates' },
    { n: 3, t: 'Media', s: 'Images / Videos' },
    { n: 4, t: 'Brand', s: 'Add your logo' },
    { n: 5, t: 'Preview', s: 'See how it looks' },
    { n: 6, t: 'Publish', s: 'Share or schedule' },
  ];
  return (
    <div style={{ ...card, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 4, overflowX: 'auto' }}>
      {steps.map((st, i) => {
        const done = st.n < step;
        const active = st.n === step;
        return (
          <div key={st.n} style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 120 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 800,
              background: done ? '#10B981' : active ? 'linear-gradient(135deg,#7C3AED,#8B5CF6)' : '#F1F5F9',
              color: done || active ? '#fff' : '#94A3B8',
              border: active ? 'none' : done ? 'none' : `1px solid ${C.border}`,
              boxShadow: active ? '0 2px 8px rgba(124,58,237,0.3)' : 'none',
            }}>{done ? '✓' : st.n}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: active ? C.primaryDark : done ? C.ink : '#94A3B8' }}>{st.t}</div>
              <div style={{ fontSize: 10, color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.s}</div>
            </div>
            {i < steps.length - 1 && <div style={{ flex: 1, height: 2, borderRadius: 2, margin: '0 8px', background: st.n < step ? '#10B981' : '#E9ECF3' }} />}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main workspace
// ---------------------------------------------------------------------------
export default function StudioWorkspace(p: StudioWorkspaceProps) {
  // 6-step wizard (UI-only). All business logic stays in page.tsx handlers
  // passed through as props — this wrapper only switches presentation.
  return <StudioWizard {...p} />;
}
