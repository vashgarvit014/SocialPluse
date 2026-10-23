'use client';

import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from 'react';
import Link from 'next/link';
import { Caveat, Plus_Jakarta_Sans } from 'next/font/google';
import { SP_LOGO } from './_shell/brand-assets';

const caveat = Caveat({ subsets: ['latin'], weight: ['500', '600'], display: 'swap' });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], display: 'swap' });

// Converts a plain CSS-text declaration list ("color:red;font-weight:700") into
// a React style object. Lets this page's markup stay close to the original
// hand-authored design instead of hand-converting hundreds of properties.
function sx(css?: string): CSSProperties {
  if (!css) return {};
  const style: Record<string, string> = {};
  css.split(';').forEach(decl => {
    const idx = decl.indexOf(':');
    if (idx === -1) return;
    const prop = decl.slice(0, idx).trim();
    const val = decl.slice(idx + 1).trim();
    if (!prop || !val) return;
    const camel = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    style[camel] = val;
  });
  return style as CSSProperties;
}

function merge(...styles: (CSSProperties | undefined)[]): CSSProperties {
  return Object.assign({}, ...styles);
}

// Small helper for the handful of elements that swap styles on hover.
function Hover({
  tag = 'div', base, hover, style, children, ...rest
}: {
  tag?: ElementType; base?: string; hover?: string; style?: CSSProperties; children?: ReactNode;
  [key: string]: unknown;
}) {
  const [isHover, setIsHover] = useState(false);
  const Tag = tag as ElementType;
  return (
    <Tag
      style={merge(sx(base), style, { transition: 'all .2s' }, isHover ? sx(hover) : {})}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * THE ORIGINAL SocialPulse MARK — and only the original mark.
 *
 * `SP_LOGO` is `src/assets/sp-logo.png`, imported (not served out of /public) so
 * webpack emits it under /_next/static/media with a content hash in the name.
 * That is deliberate and documented in _shell/brand-assets.ts: a /public path is
 * unhashed and served with a 4h max-age, which is how a swapped logo shipped as
 * the OLD mark on one browser profile and the NEW mark on another.
 *
 * The landing page used to draw its own approximation — a `linear-gradient`
 * rounded square with a hand-authored `<polyline>` zigzag inside it — in six
 * places. Every one of them now renders this file instead. Do not reintroduce a
 * CSS/SVG recreation of the logo; add a new approved artwork file to
 * src/assets and re-export it from _shell/brand-assets.ts instead.
 *
 * `size` accepts a CSS length string so the responsive layer can drive it from
 * a custom property (see landing.css) — an inline style cannot carry a media
 * query, but `width:var(--lp-nav-tile)` can.
 */
function SPMark({ size = 40, radius, className }: { size?: number | string; radius?: number | string; className?: string }) {
  // Percentage-of-own-width radii are unreliable on replaced elements, so derive
  // the radius from the box instead. A `size` that is itself a CSS length (the
  // responsive layer drives it from a custom property) can be used in calc()
  // directly, so no media query is needed to keep the corner proportional.
  const r = radius ?? (typeof size === 'number' ? Math.round(size * 0.26) : `calc(${size} * 0.26)`);
  return (
    /* eslint-disable-next-line @next/next/no-img-element -- the ORIGINAL brand
       asset, imported (not a /public path) precisely so Next serves it from
       /_next/static/media with a content hash. See _shell/brand-assets.ts:
       an unhashed /public URL is served with a 4h max-age, which is how a
       swapped logo shipped as the OLD mark on one profile and the NEW mark on
       another. A plain <img> also keeps object-fit:contain and the exact
       intrinsic box inside the flex rows this page uses. */
    <img
      src={SP_LOGO}
      alt="SocialPulse"
      className={`lp-sp-logo${className ? ' ' + className : ''}`}
      style={{ width: size as React.CSSProperties['width'], height: size as React.CSSProperties['height'], borderRadius: r, objectFit: 'contain', display: 'block', flexShrink: 0 }}
    />
  );
}

type PlatformKey = 'linkedin' | 'facebook' | 'instagram' | 'whatsapp' | 'canva';
const P: Record<PlatformKey, { name: string; short: string; bg: string }> = {
  linkedin: { name: 'LinkedIn', short: 'in', bg: '#0a66c2' },
  facebook: { name: 'Facebook', short: 'f', bg: '#1877f2' },
  instagram: { name: 'Instagram', short: 'IG', bg: 'linear-gradient(45deg,#f58529,#dd2a7b,#8134af)' },
  whatsapp: { name: 'WhatsApp', short: 'W', bg: '#25d366' },
  canva: { name: 'Canva', short: 'C', bg: 'linear-gradient(135deg,#00c4cc,#7d2ae8)' },
};

/**
 * REAL PLATFORM BRAND ARTWORK — the same files the app shell already ships
 * (public/brand-icons/*, added 2026-10-06 from the user-supplied artwork), not
 * letter glyphs drawn in a coloured box. Each bitmap is a full-bleed app-icon
 * on a white field, so it is rendered `contain` inside a white tile rather than
 * recoloured or cropped.
 *
 * Canva uses its official compact UI icon from its published developer bundle,
 * as required for product surfaces under 50px.
 */
const BRAND_ICON: Partial<Record<PlatformKey, string>> = {
  linkedin: '/brand-icons/linkedin.webp',
  facebook: '/brand-icons/facebook.png',
  instagram: '/brand-icons/instagram.png',
  whatsapp: '/brand-icons/whatsapp.png',
  canva: '/brand-icons/canva.svg',
};

/** Brand-tinted shadow per platform, so a white artwork tile still reads as a
 *  distinct chip on a white card without needing a heavy border. */
const BRAND_RING: Record<PlatformKey, string> = {
  linkedin: 'rgba(10,102,194,.34)',
  facebook: 'rgba(24,119,242,.32)',
  instagram: 'rgba(209,66,152,.32)',
  whatsapp: 'rgba(37,211,102,.36)',
  canva: 'rgba(124,58,237,.32)',
};

/**
 * One real platform mark, sized to the box its caller reserves.
 *
 * Falls back to the brand colour + the platform's short name when the artwork
 * is unavailable, so a missing file degrades to something that still looks
 * deliberate instead of collapsing the layout.
 */
function PlatformIcon({
  k, size = 26, shape = 'square', pad = 0.86, className,
}: { k: PlatformKey; size?: number | string; shape?: 'square' | 'circle'; pad?: number; className?: string }) {
  const src = BRAND_ICON[k];
  // `size` may be a CSS length (the orbit tile is sized from a custom property),
  // in which case the derived pixel values below are resolved in `em`-relative
  // CSS instead of arithmetic, so the same component works at any breakpoint.
  const num = typeof size === 'number' ? size : 26;
  const radius = shape === 'circle'
    ? '50%'
    : typeof size === 'number' ? Math.max(6, Math.round(size * 0.28)) : '28%';
  const tile: CSSProperties = {
    width: size, height: size, flexShrink: 0, overflow: 'hidden',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#fff',
    borderRadius: radius,
    boxShadow: `inset 0 0 0 1px rgba(20,20,60,.06), 0 ${Math.max(2, Math.round(num * 0.1))}px ${Math.max(4, Math.round(num * 0.24))}px -${Math.max(1, Math.round(num * 0.08))}px ${BRAND_RING[k]}`,
  };
  return (
    <span className={`lp-picon${className ? ' ' + className : ''}`} style={tile}>
      {src ? (
        /* eslint-disable-next-line @next/next/no-img-element -- brand artwork,
           same as the app shell's platform marks; a plain <img> keeps
           object-fit:contain and the exact intrinsic box inside a flex row. */
        <img src={src} alt={P[k].name} style={{ width: `${pad * 100}%`, height: `${pad * 100}%`, objectFit: 'contain', display: 'block' }} />
      ) : (
        <span style={{ ...sx(`font-weight:800;color:#fff;background:${P[k].bg};display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:${Math.max(9, Math.round(num * 0.42))}px;`), borderRadius: shape === 'circle' ? '50%' : '20%' }}>{P[k].short}</span>
      )}
    </span>
  );
}

const IMG = [
  'linear-gradient(135deg,#c7b8ff,#f3c1e0)',
  'linear-gradient(135deg,#a8d8ff,#c7b8ff)',
  'linear-gradient(135deg,#ffd3b0,#f7a8c4)',
  'linear-gradient(135deg,#b8f0d8,#a8c8ff)',
  'linear-gradient(135deg,#ffe3a8,#ffb8a8)',
  'linear-gradient(135deg,#d8c8ff,#a8b8ff)',
];

const STEPS: [string, string, string][] = [
  ['Idea', 'Start with an idea', 'Type a thought, a launch, or a campaign theme.'],
  ['AI Content', 'Generate captions', 'Pick a tone and a content category. Get platform-ready copy.'],
  ['AI Image', 'Create or upload media', 'Generate AI images, upload your own, or build a carousel.'],
  ['Branding', 'Apply your brand', 'Add your logo and ALT text in one pass.'],
  ['Preview', 'Preview per platform', 'See how it lands on LinkedIn, Facebook, Instagram, and WhatsApp.'],
  ['Schedule', 'Schedule or publish', 'Queue it for later, publish now, or keep it as a draft.'],
];

type PostStatus = 'draft' | 'scheduled' | 'published';
interface DemoPost { id: number; title: string; p: PlatformKey; time: string; status: PostStatus; stat?: string }

const initialPosts: DemoPost[] = [
  { id: 1, title: 'Onboarding launch recap', p: 'linkedin', time: 'Thu, 10:00 AM', status: 'scheduled' },
  { id: 2, title: 'Autumn collection carousel', p: 'instagram', time: 'Fri, 6:30 PM', status: 'scheduled' },
  { id: 3, title: 'Team update for partners', p: 'whatsapp', time: 'Mon, 9:00 AM', status: 'scheduled' },
  { id: 4, title: 'Customer story: Brightline', p: 'facebook', time: 'Not scheduled', status: 'draft' },
  { id: 5, title: 'Behind the scenes reel', p: 'instagram', time: 'Not scheduled', status: 'draft' },
  { id: 6, title: 'Q3 product roundup', p: 'linkedin', time: 'Published Tue', status: 'published', stat: '4.1K reach' },
  { id: 7, title: 'Studio open day', p: 'facebook', time: 'Published Mon', status: 'published', stat: '2.7K reach' },
];

interface DemoGroup { name: string; members: number; on: boolean }
const initialGroups: DemoGroup[] = [
  { name: 'Northwind Partners', members: 48, on: true },
  { name: 'Studio Crew', members: 16, on: true },
  { name: 'Early Access Customers', members: 212, on: false },
];

const BRAND_ARTWORK = "url('/socialpulse-logo-stacked-dark.png') center/cover no-repeat";

const CAPTIONS: Record<'linkedin' | 'facebook' | 'instagram' | 'whatsapp', { account: string; sub: string; caption: string; meta: string; actions: string; img: string; overlay: string }> = {
  linkedin: { account: 'Northwind Studio', sub: '2,340 followers · Promoted by you', caption: 'We rebuilt our onboarding from scratch this quarter. Three changes cut setup time from 40 minutes to 6. Here is what we learned and what we would do differently.', meta: 'Professional tone · Single image · 3,000 char limit', actions: 'Like · Comment · Repost · Send', img: BRAND_ARTWORK, overlay: '40 min → 6 min' },
  facebook: { account: 'Northwind Studio', sub: 'Just now · Public', caption: 'Big news from the studio: our new onboarding is live. Setup now takes about 6 minutes. Give it a try and tell us what you think in the comments.', meta: 'Friendly tone · Single image · Link preview', actions: 'Like · Comment · Share', img: BRAND_ARTWORK, overlay: 'New onboarding is live' },
  instagram: { account: 'northwind.studio', sub: 'Sponsored · Carousel 1/4', caption: 'Setup in 6 minutes. Swipe through to see the new flow. #productdesign #onboarding #studiolife', meta: 'Casual tone · Carousel · 4 slides · Hashtags', actions: 'Like · Comment · Share · Save', img: BRAND_ARTWORK, overlay: 'Swipe to see the new flow' },
  whatsapp: { account: 'Northwind Partners', sub: '48 members', caption: 'Hi team, the new onboarding is live. Setup takes about 6 minutes now. Full walkthrough: northwind.studio/new', meta: 'Direct tone · Sent to 2 groups', actions: '', img: BRAND_ARTWORK, overlay: 'Onboarding walkthrough' },
};

const ASSET_FILTERS = ['All', 'Generated', 'Uploaded', 'Canva', 'Branded', 'Carousel'];
const ASSETS_ALL: [string, string, string][] = [
  ['Generated', '✨', 'linear-gradient(135deg,#e9ddff,#d7c3f2)'], ['Uploaded', '☁️', 'linear-gradient(135deg,#ffe0c0,#f5bdc8)'],
  ['Canva', '🎨', 'linear-gradient(135deg,#c9d8ff,#c3c4f6)'], ['Branded', '✦', 'linear-gradient(135deg,#c5f0e9,#b8d5f3)'],
  ['Carousel', '🖼️', 'linear-gradient(135deg,#ffe7b1,#f6b9a7)'], ['Generated', '💡', 'linear-gradient(135deg,#d9d0ff,#b5c0f7)'],
  ['Branded', '◈', 'linear-gradient(135deg,#ffd8c6,#f0b1c4)'], ['Canva', '🪄', 'linear-gradient(135deg,#e7d2fb,#e6bfe3)'],
];

/** The connected-app orbit shows each platform exactly ONCE. It used to repeat
 *  three of the five keys purely to fill eight slots, which on a phone meant two
 *  extra icons competing for a much smaller radius — visual noise, not density. */
const RING_KEYS: PlatformKey[] = ['linkedin', 'facebook', 'instagram', 'whatsapp', 'canva'];

export default function LandingClient() {
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState<'linkedin' | 'facebook' | 'instagram' | 'whatsapp'>('linkedin');
  const [modal, setModal] = useState(false);
  const [filter, setFilter] = useState('All');
  const [toast, setToast] = useState('');
  const [posts, setPosts] = useState(initialPosts);
  const [groups, setGroups] = useState(initialGroups);

  const heroStageRef = useRef<HTMLDivElement>(null);
  const fARef = useRef<HTMLDivElement>(null);
  const fBRef = useRef<HTMLDivElement>(null);
  const fCRef = useRef<HTMLDivElement>(null);
  const fDRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const barRefs = useRef<Array<HTMLDivElement | null>>([null, null, null, null, null, null]);

  const anim = useRef({ tx: 0, ty: 0, cx: 0, cy: 0, stepStart: 0, paused: false });
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stepRef = useRef(step);
  useEffect(() => { stepRef.current = step; anim.current.stepStart = performance.now(); }, [step]);

  /**
   * How "loose" the 3D scenes may spread, per viewport width.
   *
   * The hero scene's geometry is fixed pixels authored for a ~600px desktop
   * column, and `translateZ` is what pushes pieces apart: under a 1800px
   * perspective a card at Z=240 renders 13% larger and its edges travel
   * correspondingly further out. Scaling the whole scene down (which is what
   * landing.css does) shrinks everything EQUALLY, so a phone kept seeing the
   * same wide, fanned-out composition just rendered small — the "scattered"
   * report. This factor scales the Z depth and the float amplitude directly,
   * so narrow viewports genuinely pull the pieces toward centre and calm the
   * motion, instead of only making the same spread smaller.
   *
   * Motion is preserved at every width — it is scaled, never switched off.
   */
  const spreadFor = (w: number) => (w <= 360 ? 0.40 : w <= 560 ? 0.46 : w <= 820 ? 0.62 : w <= 1024 ? 0.82 : 1);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      anim.current.tx = e.clientX / window.innerWidth - 0.5;
      anim.current.ty = e.clientY / window.innerHeight - 0.5;
    };
    window.addEventListener('mousemove', onMove);

    let spread = spreadFor(window.innerWidth);
    const onResize = () => { spread = spreadFor(window.innerWidth); };
    window.addEventListener('resize', onResize);

    const floats: [React.RefObject<HTMLDivElement | null>, number, number, number, number][] = [
      [fARef, 140, 10, 1.1, 0], [fBRef, 200, 8, 1.4, 1.5], [fCRef, 170, 7, 1.2, 3], [fDRef, 240, 12, 0.9, 2],
    ];

    let raf = 0;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const loop = (now: number) => {
      const a = anim.current;
      const t = now / 1000;
      a.cx += (a.tx - a.cx) * 0.06;
      a.cy += (a.ty - a.cy) * 0.06;
      // Flatten the base tilt as well as the Z depth: a shallower rotateY moves
      // less of the stage sideways, which is the other half of "compact and
      // centred". Mouse parallax keeps its full range at desktop widths.
      if (heroStageRef.current) heroStageRef.current.style.transform = `rotateX(${10 - 4 * (1 - spread) - a.cy * 8}deg) rotateY(${-16 + 6 * (1 - spread) + a.cx * 12}deg)`;
      floats.forEach(([ref, z, amp, speed, phase]) => {
        if (ref.current) ref.current.style.transform = `translate3d(0,${(Math.sin(t * speed + phase) * amp * spread).toFixed(2)}px,${(z * spread).toFixed(1)}px)`;
      });
      if (ringRef.current) {
        const orbitAngle = (t * 16).toFixed(2);
        ringRef.current.style.setProperty('--lp-orbit-angle', `${orbitAngle}deg`);
        ringRef.current.style.transform = `rotateX(var(--lp-orbit-tilt, -54deg)) rotateZ(${orbitAngle}deg)`;
      }
      // Flatten both 3D scenes as the viewport narrows (see `spreadFor`). The
      // workflow stack's -20deg yaw is a large horizontal shifter: at 320px it
      // threw the fanned cards ~25px past the viewport edge. A shallower yaw is
      // both more compact and more readable on a phone.
      if (stackRef.current) stackRef.current.style.transform = `rotateX(${(8 * (0.5 + 0.5 * spread) - a.cy * 5).toFixed(2)}deg) rotateY(${(-20 * spread + a.cx * 8).toFixed(2)}deg)`;
      const elapsed = performance.now() - a.stepStart;
      for (let i = 0; i < 6; i++) {
        const bar = barRefs.current[i];
        if (bar) bar.style.width = (i === stepRef.current ? Math.min(100, (elapsed / 4200) * 100) : 0) + '%';
      }
      if (!document.hidden) raf = requestAnimationFrame(loop);
      else hideTimer = setTimeout(() => loop(performance.now()), 500);
    };
    raf = requestAnimationFrame(loop);

    const iv = setInterval(() => {
      if (anim.current.paused) return;
      if (performance.now() - anim.current.stepStart >= 4200) {
        setStep(s => (s + 1) % 6);
      }
    }, 250);

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
      clearInterval(iv);
      clearTimeout(hideTimer);
      clearTimeout(toastTimeout.current);
    };
  }, []);

  function flash(msg: string) {
    clearTimeout(toastTimeout.current);
    setToast(msg);
    toastTimeout.current = setTimeout(() => setToast(''), 2600);
  }

  function move(id: number, status: PostStatus, msg: string) {
    setPosts(prev => prev.map(p => (p.id === id ? { ...p, status, time: status === 'draft' ? 'Not scheduled' : 'Wed, 11:00 AM' } : p)));
    flash(msg);
  }

  const drafts = posts.filter(p => p.status === 'draft');
  const scheduled = posts.filter(p => p.status === 'scheduled');
  const published = posts.filter(p => p.status === 'published');
  const cur = { ...CAPTIONS[tab], ...P[tab] };
  const isWA = tab === 'whatsapp';
  const assets = ASSETS_ALL.filter(([tag]) => filter === 'All' || tag === filter);
  const nGroups = groups.filter(g => g.on).length;

  const heroPosts = [
    { title: 'Onboarding launch recap', time: 'Thu, 10:00 AM', img: IMG[1], p: 'linkedin' as PlatformKey, ...P.linkedin },
    { title: 'Autumn collection carousel', time: 'Fri, 6:30 PM', img: IMG[0], p: 'instagram' as PlatformKey, ...P.instagram },
    { title: 'Team update for partners', time: 'Mon, 9:00 AM', img: IMG[3], p: 'whatsapp' as PlatformKey, ...P.whatsapp },
  ];
  const platformTiles: PlatformKey[] = ['linkedin', 'facebook', 'instagram', 'whatsapp'];
  const tabsList: ('linkedin' | 'facebook' | 'instagram' | 'whatsapp')[] = ['linkedin', 'facebook', 'instagram', 'whatsapp'];
  const ringStep = 360 / RING_KEYS.length;
  const ringTiles = RING_KEYS.map((k, i) => {
    const angle = (i * ringStep).toFixed(2);
    return { k, tf: `rotateZ(${angle}deg) translateY(calc(0px - var(--lp-orbit-r,170px))) rotateZ(-${angle}deg)` };
  });

  return (
    <div className={`lp-root ${jakarta.className}`} style={{ background: '#f6f6fb', color: '#0f1020', WebkitFontSmoothing: 'antialiased', scrollBehavior: 'smooth' }}>
      <div style={{ position: 'relative', overflow: 'hidden', background: 'radial-gradient(900px 600px at 78% 12%,#ebe6ff 0%,rgba(235,230,255,0) 70%),radial-gradient(700px 500px at 5% 90%,#eef2ff 0%,rgba(238,242,255,0) 70%),#f6f6fb' }}>
        {/* NAV */}
        <nav className="lp-nav" style={sx('max-width:var(--lp-max);margin:0 auto;padding:22px var(--lp-pad);display:flex;align-items:center;justify-content:space-between;gap:var(--lp-nav-gap,18px);position:relative;z-index:5;')}>
          <a href="#" style={sx('display:flex;align-items:center;gap:12px;color:#0f1020;')}>
            <SPMark size="var(--lp-nav-tile, 40px)" radius="12px" className="lp-nav-tile" />
            <span className="lp-nav-brand" style={sx('font-weight:800;font-size:var(--lp-brand,clamp(18px,4.4vw,22px));letter-spacing:-.02em;white-space:nowrap;')}>SocialPulse</span>
          </a>
          <div className="lp-nav-links" style={sx('gap:34px;font-size:15px;font-weight:500;')}>
            <a href="#workflow" style={sx('color:#2a2c3d;')}>Workflow</a>
            <a href="#platforms" style={sx('color:#2a2c3d;')}>Platforms</a>
            <a href="#scheduler" style={sx('color:#2a2c3d;')}>Scheduler</a>
            <a href="#features" style={sx('color:#2a2c3d;')}>Features</a>
          </div>
          <div className="lp-nav-actions" style={sx('display:flex;align-items:center;gap:var(--lp-nav-act-gap,22px);')}>
            <Link href="/login-signup?mode=login" className="lp-nav-login" style={sx('color:#0f1020;font-weight:600;font-size:15px;')}>Log in</Link>
            <Hover tag={Link} href="/login-signup?mode=signup" className="lp-nav-cta" base="color:#fff;background:linear-gradient(135deg,#5b6cff,#8b5cf6);font-weight:600;box-shadow:0 10px 24px rgba(91,76,245,.3);display:inline-block;" hover="transform:translateY(-1px);box-shadow:0 14px 30px rgba(91,76,245,.4)">
              Get Started →
            </Hover>
          </div>
        </nav>

        {/* HERO */}
        <header style={sx('max-width:var(--lp-max);margin:0 auto;padding:40px var(--lp-pad) 60px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:var(--lp-gap);align-items:center;')}>
          <div style={sx('position:relative;z-index:3;')}>
            <div style={sx('display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:#ece8ff;color:#5b4cf5;font-size:14px;font-weight:600;')}>
              <span style={sx('width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,#5b6cff,#c056f0);')} />
              AI-powered social media workspace
            </div>
            <h1 style={sx('font-size:var(--lp-h1);line-height:1;letter-spacing:-.045em;font-weight:800;margin:26px 0 24px;')}>
              Create. Brand.<br />Schedule.{' '}
              <span style={sx('background:linear-gradient(90deg,#4f7cff,#8b5cf6,#c056f0);-webkit-background-clip:text;background-clip:text;color:transparent;')}>Grow.</span>
            </h1>
            <p style={sx('font-size:var(--lp-lede);line-height:1.6;color:#4d5065;max-width:520px;margin:0 0 34px;text-wrap:pretty;')}>
              An AI-powered social media workspace for creating, previewing, scheduling, and publishing content across multiple platforms.
            </p>
            <div style={sx('display:flex;gap:14px;flex-wrap:wrap;')}>
              <Hover tag={Link} href="/login-signup?mode=signup" className="lp-btn-primary" base="color:#fff;background:linear-gradient(135deg,#5b6cff,#8b5cf6);border-radius:14px;font-weight:600;box-shadow:0 14px 30px rgba(91,76,245,.35);display:inline-block;" hover="transform:translateY(-2px)">
                Get Started Free →
              </Hover>
              <Hover tag="a" href="#workflow" className="lp-btn-secondary" base="color:#0f1020;background:#fff;border-radius:14px;font-weight:600;border:1px solid #e4e4ee;display:inline-flex;align-items:center;justify-content:center;gap:10px;" hover="border:1px solid #c9c3ff">
                <span style={sx('width:24px;height:24px;border-radius:50%;background:#0f1020;display:flex;align-items:center;justify-content:center;flex-shrink:0;')}>
                  <span style={sx('width:0;height:0;border-left:8px solid #fff;border-top:5px solid transparent;border-bottom:5px solid transparent;margin-left:2px;')} />
                </span>
                See the workflow
              </Hover>
            </div>
            <div style={sx('display:flex;gap:24px;flex-wrap:wrap;margin-top:34px;font-size:14px;color:#4d5065;')}>
              {['AI captions & images', 'Platform-specific previews', 'Canva & WhatsApp built in'].map(t => (
                <span key={t} style={sx('display:flex;align-items:center;gap:8px;')}>
                  <span style={sx('width:20px;height:20px;border-radius:50%;background:#e6e3ff;color:#5b4cf5;font-size:11px;display:flex;align-items:center;justify-content:center;font-weight:800;')}>✓</span>
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="lp-hero-box">
            <div className="lp-3d-fit" style={{ ['--lp-scale' as string]: 'var(--lp-hero-scale)', ['--lp-stage-h' as string]: 'var(--lp-hero-stage-h, 600px)' } as React.CSSProperties}>
            <div ref={heroStageRef} style={sx('position:absolute;inset:0;transform-style:preserve-3d;transform:rotateX(10deg) rotateY(-16deg);')}>
              <div style={sx('position:absolute;left:12%;top:8%;width:78%;height:80%;border-radius:50%;background:radial-gradient(circle at 40% 40%,#d9d0ff,#efeaff 60%,rgba(239,234,255,0) 72%);transform:translateZ(-160px);')} />

              <div style={sx('position:absolute;left:var(--lp-hero-card-left,0%);top:70px;width:var(--lp-hero-card-w,86%);background:#fff;border-radius:22px;box-shadow:0 40px 80px -20px rgba(40,30,120,.25),0 0 0 1px rgba(20,20,60,.05);display:flex;overflow:hidden;transform:translateZ(0);')}>
                <div style={sx('width:var(--lp-hero-side-w,132px);padding:18px 12px;border-right:1px solid #f0f0f6;display:flex;flex-direction:column;gap:4px;font-size:12px;color:#4d5065;')}>
                  <div style={sx('display:flex;align-items:center;gap:7px;font-weight:800;font-size:13px;color:#0f1020;margin:0 0 14px 6px;')}>
                    <SPMark size={18} radius={5} />SocialPulse
                  </div>
                  <div style={sx('padding:8px 10px;border-radius:9px;background:#efedff;color:#5b4cf5;font-weight:700;')}>Home</div>
                  <div style={sx('padding:8px 10px;')}>Content Studio</div>
                  <div style={sx('padding:8px 10px;')}>Scheduler</div>
                  <div style={sx('padding:8px 10px;')}>Asset Gallery</div>
                  <div style={sx('padding:8px 10px;')}>Analytics</div>
                  <div style={sx('padding:8px 10px;')}>Connections</div>
                </div>
                <div style={sx('flex:1;padding:var(--lp-hero-card-pad,18px 20px);min-width:0;overflow:hidden;')}>
                  <div style={sx('display:flex;justify-content:space-between;align-items:center;gap:10px;')}>
                    <div style={sx('min-width:0;')}>
                      <div style={sx('font-weight:800;font-size:var(--lp-hero-hello,17px);letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>Good morning, Alex</div>
                      <div style={sx('font-size:11px;color:#8a8ca0;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>Here&apos;s what&apos;s happening with your content.</div>
                    </div>
                    <div style={sx('width:30px;height:30px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,#ffc9a8,#f59ab5);')} />
                  </div>
                  {/* minmax(0,1fr) — a bare 1fr floors at min-content, so the
                      three stat tiles refused to shrink below their longest
                      label and pushed ~40px out through the card at 320px. */}
                  <div style={sx('display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--lp-hero-stat-gap,10px);margin:16px 0;')}>
                    {[['Drafts', '8'], ['Scheduled', '24'], ['Published', '132']].map(([label, val]) => (
                      <div key={label} style={sx('border:1px solid #f0f0f6;border-radius:12px;padding:var(--lp-hero-stat-pad,10px 12px);min-width:0;overflow:hidden;')}>
                        <div style={sx('font-size:10px;color:#8a8ca0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{label}</div>
                        <div style={sx('font-size:var(--lp-hero-stat-size,20px);font-weight:800;margin-top:4px;')}>{val}</div>
                      </div>
                    ))}
                  </div>
                  <div style={sx('font-weight:700;font-size:13px;margin-bottom:8px;')}>Upcoming posts</div>
                  {heroPosts.map(p => (
                    <div key={p.title} style={sx('display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid #f4f4f9;')}>
                      <div style={{ ...sx('width:34px;height:34px;border-radius:9px;flex-shrink:0;'), background: p.img }} />
                      <div style={sx('flex:1;min-width:0;')}>
                        <div style={sx('font-size:12px;font-weight:700;')}>{p.title}</div>
                        <div style={sx('font-size:10px;color:#8a8ca0;margin-top:2px;')}>{p.time}</div>
                      </div>
                      <PlatformIcon k={p.p} size={20} />
                      <div style={sx('font-size:10px;font-weight:700;color:#5b4cf5;background:#efedff;padding:4px 9px;border-radius:999px;')}>Scheduled</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* The four floating pieces. Every offset below is a custom
                  property carrying its desktop value as the fallback, because
                  an inline style cannot hold a media query — landing.css pulls
                  each one inward per breakpoint. `lp-hero-float` marks all four
                  so the mobile overflow audit can measure them as one set. */}
              <div ref={fARef} className="lp-hero-float lp-hero-phone" style={sx('position:absolute;right:var(--lp-hero-a-right,2%);top:var(--lp-hero-a-top,150px);width:var(--lp-hero-a-w,200px);height:var(--lp-hero-a-h,360px);border-radius:30px;background:#fff;padding:8px;box-shadow:0 40px 70px -18px rgba(40,30,120,.35);transform:translateZ(140px);')}>
                <div style={sx('position:relative;height:100%;border-radius:23px;overflow:hidden;background:linear-gradient(160deg,#b9a8ff 0%,#e7b4ec 55%,#ffd3c2 100%);')}>
                  <div style={sx('position:absolute;top:14px;left:14px;right:14px;display:flex;align-items:center;gap:7px;')}>
                    <span style={sx('width:22px;height:22px;border-radius:50%;background:#fff;')} />
                    <span style={sx('font-size:10px;font-weight:700;color:#fff;')}>northwind.studio</span>
                  </div>
                  <div className={caveat.className} style={sx('position:absolute;left:16px;top:86px;font-size:var(--lp-hero-phone-note,34px);line-height:1;color:#fff;')}>Good content,<br />brighter days</div>
                  <div style={sx('position:absolute;left:10px;right:10px;bottom:10px;background:rgba(255,255,255,.92);border-radius:14px;padding:10px;display:flex;align-items:center;gap:8px;')}>
                    <SPMark size={26} radius={8} />
                    <div><div style={sx('font-size:11px;font-weight:800;')}>Instagram preview</div><div style={sx('font-size:9px;color:#6b6d80;')}>Carousel · 4 slides</div></div>
                  </div>
                </div>
              </div>

              <div ref={fBRef} className="lp-hero-float lp-hero-ai" style={sx('position:absolute;left:var(--lp-hero-b-left,-4%);top:var(--lp-hero-b-top,10px);background:#fff;border-radius:16px;padding:12px 14px;box-shadow:0 24px 50px -14px rgba(40,30,120,.3);display:flex;align-items:center;gap:10px;transform:translateZ(200px);')}>
                <span style={sx('width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,#5b6cff,#c056f0);color:#fff;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0;')}>AI</span>
                <div><div style={sx('font-size:12px;font-weight:800;')}>4 captions generated</div><div style={sx('font-size:10px;color:#8a8ca0;')}>LinkedIn · Facebook · Instagram · WhatsApp</div></div>
              </div>

              <div ref={fCRef} className="lp-hero-float lp-hero-pill" style={sx('position:absolute;left:var(--lp-hero-c-left,18%);bottom:var(--lp-hero-c-bottom,30px);background:#0f1020;color:#fff;border-radius:14px;padding:11px 14px;box-shadow:0 24px 50px -14px rgba(15,16,32,.45);display:flex;align-items:center;gap:10px;transform:translateZ(170px);')}>
                <span style={sx('width:8px;height:8px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 4px rgba(74,222,128,.2);flex-shrink:0;')} />
                <span style={sx('font-size:12px;font-weight:600;')}>Scheduled · Thu, 10:00 AM</span>
              </div>

              {/* Real brand marks, not letter glyphs. A COLUMN on desktop (it
                  reads as a vertical rail beside the phone) and a compact ROW
                  pinned to the bottom-right on phones, where a column would
                  collide with the phone mockup's caption. */}
              <div ref={fDRef} className="lp-hero-float lp-hero-platforms" style={sx('position:absolute;right:var(--lp-hero-d-right,-5%);top:var(--lp-hero-d-top,200px);display:flex;flex-direction:var(--lp-hero-d-dir,column);gap:var(--lp-hero-d-gap,10px);transform:translateZ(240px);')}>
                {platformTiles.map(k => (
                  <PlatformIcon key={k} k={k} size={34} className="lp-hero-platform" />
                ))}
              </div>

              <div className={`${caveat.className} lp-hero-note`} style={sx('position:absolute;right:6%;top:40px;font-size:26px;color:#5b5e72;transform:translateZ(80px) rotate(-8deg);')}>Idea to impact ↓</div>
              <div className={`${caveat.className} lp-hero-note`} style={sx('position:absolute;right:26%;bottom:-6px;font-size:24px;color:#5b5e72;transform:translateZ(60px) rotate(-6deg);')}>Plan today, publish everywhere</div>
              </div>
            </div>
          </div>
        </header>
      </div>

      {/* LOGO STRIP */}
      <div style={sx('max-width:var(--lp-max);margin:0 auto;padding:10px var(--lp-pad) 30px;')}>
        <div style={sx('display:flex;align-items:center;gap:20px;font-size:12px;letter-spacing:.24em;color:#6b6d80;font-weight:600;')}>
          <span style={sx('flex:1;height:1px;background:#e4e4ee;')} />PUBLISH AND CONNECT ACROSS<span style={sx('flex:1;height:1px;background:#e4e4ee;')} />
        </div>
        <div className="lp-strip" style={sx('display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:var(--lp-strip-gap,28px) var(--lp-strip-row,24px);padding:28px 0;')}>
          {(['linkedin', 'facebook', 'instagram', 'whatsapp', 'canva'] as PlatformKey[]).map(k => (
            <div key={k} className="lp-platform-item" style={sx('display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;color:#2a2c3d;white-space:nowrap;')}>
              <PlatformIcon k={k} size={30} />
              {P[k].name}
            </div>
          ))}
        </div>
      </div>

      {/* WORKFLOW */}
      <section id="workflow" style={sx('max-width:var(--lp-max);margin:0 auto;padding:var(--lp-sec-pad) var(--lp-pad);')}>
        <div style={sx('text-align:center;max-width:720px;margin:0 auto 56px;')}>
          <div style={sx('font-size:12px;letter-spacing:.24em;color:#5b4cf5;font-weight:700;')}>ONE WORKFLOW</div>
          <h2 style={sx('font-size:var(--lp-h2);letter-spacing:-.035em;line-height:1.05;margin:16px 0;font-weight:800;')}>From idea to published, without switching tools.</h2>
          <p style={sx('font-size:18px;color:#4d5065;line-height:1.6;margin:0;')}>Six steps, one workspace. Every step keeps its state, so you can jump back at any point.</p>
        </div>
        <div
          style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:var(--lp-gap);align-items:center;')}
          onMouseEnter={() => { anim.current.paused = true; }}
          onMouseLeave={() => { anim.current.paused = false; }}
        >
          <div style={sx('display:flex;flex-direction:column;gap:6px;')}>
            {STEPS.map(([label, title, desc], i) => {
              const on = i === step;
              return (
                <div
                  key={label}
                  onClick={() => setStep(i)}
                  style={{
                    ...sx('cursor:pointer;padding:16px 18px;border-radius:18px;transition:background .3s,box-shadow .3s;position:relative;overflow:hidden;'),
                    background: on ? '#fff' : 'transparent',
                    boxShadow: on ? '0 18px 40px -18px rgba(40,30,120,.25)' : 'none',
                  }}
                >
                  <div style={sx('display:flex;align-items:center;gap:14px;')}>
                    <span style={{ ...sx('width:34px;height:34px;border-radius:10px;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;'), background: on ? 'linear-gradient(135deg,#5b6cff,#9b5cf6)' : '#ecebf5', color: on ? '#fff' : '#6b6d80' }}>
                      {'0' + (i + 1)}
                    </span>
                    <div>
                      <div style={sx('font-size:12px;font-weight:700;color:#8a8ca0;letter-spacing:.06em;')}>{label}</div>
                      <div style={{ ...sx('font-size:18px;font-weight:700;'), color: on ? '#0f1020' : '#4d5065' }}>{title}</div>
                    </div>
                  </div>
                  <div style={{ ...sx('margin:8px 0 2px 48px;font-size:15px;line-height:1.55;color:#4d5065;'), display: on ? 'block' : 'none' }}>{desc}</div>
                  <div ref={el => { barRefs.current[i] = el; }} style={sx('position:absolute;left:0;bottom:0;height:3px;width:0;background:linear-gradient(90deg,#5b6cff,#c056f0);')} />
                </div>
              );
            })}
          </div>

          <div className="lp-wf-box">
            <div className="lp-3d-fit" style={{ ['--lp-scale' as string]: 'var(--lp-wf-scale)', ['--lp-stage-h' as string]: 'var(--lp-wf-stage-h, 460px)' } as React.CSSProperties}>
            <div ref={stackRef} style={sx('position:absolute;inset:0;transform-style:preserve-3d;transform:rotateX(8deg) rotateY(-20deg);')}>
              {STEPS.map(([label], i) => {
                const o = i - step;
                let tf: string; let op: number;
                // The fan-out step is a custom property, not a hard-coded 22px.
                // At 320px a 22px-per-step fan threw the last card ~110px past a
                // 292px column, so the stack visibly ran off the right edge.
                if (o === 0) { tf = 'translate3d(0,0,0)'; op = 1; }
                else if (o > 0) {
                  tf = `translate3d(calc(var(--lp-wf-fan,22px) * ${o}),calc(var(--lp-wf-fan-y,-26px) * ${o}),calc(var(--lp-wf-z,-110px) * ${o}))`;
                  op = Math.max(0, 1 - o * 0.22);
                } else {
                  tf = 'translate3d(var(--lp-wf-prev-x,-46px),var(--lp-wf-prev-y,80px),var(--lp-wf-prev-z,160px)) rotateX(-14deg)';
                  op = 0;
                }
                return (
                  <div key={label} style={{
                    ...sx('position:absolute;left:var(--lp-wf-left,0);top:60px;width:var(--lp-wf-card-w,80%);height:330px;background:#fff;border-radius:22px;padding:22px;box-shadow:0 40px 80px -24px rgba(40,30,120,.3),0 0 0 1px rgba(20,20,60,.05);transition:transform .8s cubic-bezier(.2,.8,.2,1),opacity .6s;'),
                    transform: tf, opacity: op,
                    // Explicit, stable layering instead of `20 - Math.abs(o)`,
                    // which gave the incoming card and the first outgoing card
                    // the SAME z-index — so their overlap order depended on DOM
                    // order rather than on intent. Active card wins outright; the
                    // incoming card sits above the fan; the fan descends.
                    zIndex: o === 0 ? 20 : o < 0 ? 15 : 10 - o,
                    pointerEvents: o === 0 ? 'auto' : 'none',
                  }}>
                    <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;')}>
                      <span style={sx('font-size:12px;font-weight:700;color:#5b4cf5;background:#efedff;padding:5px 11px;border-radius:999px;')}>{'0' + (i + 1)} · {label}</span>
                      <span style={sx('display:flex;gap:5px;')}>
                        {[0, 1, 2].map(d => <span key={d} style={sx('width:8px;height:8px;border-radius:50%;background:#e4e4ee;')} />)}
                      </span>
                    </div>

                    {i === 0 && (<>
                      <div style={sx('font-size:13px;font-weight:700;color:#6b6d80;margin-bottom:8px;')}>What do you want to post about?</div>
                      <div style={sx('border:1.5px solid #c9c3ff;border-radius:14px;padding:16px;font-size:16px;line-height:1.5;min-height:92px;')}>
                        Announce our new onboarding. Setup went from 40 minutes to 6.
                        <span style={sx('display:inline-block;width:2px;height:18px;background:#5b4cf5;vertical-align:middle;margin-left:2px;')} />
                      </div>
                      <div style={sx('font-size:13px;font-weight:700;color:#6b6d80;margin:18px 0 8px;')}>Tone</div>
                      <div style={sx('display:flex;gap:8px;flex-wrap:wrap;font-size:13px;font-weight:600;')}>
                        <span style={sx('padding:7px 13px;border-radius:999px;background:#0f1020;color:#fff;')}>Professional</span>
                        <span style={sx('padding:7px 13px;border-radius:999px;background:#f1f0f8;')}>Friendly</span>
                        <span style={sx('padding:7px 13px;border-radius:999px;background:#f1f0f8;')}>Playful</span>
                        <span style={sx('padding:7px 13px;border-radius:999px;background:#f1f0f8;')}>Announcement</span>
                      </div>
                    </>)}

                    {i === 1 && (<>
                      <div style={sx('display:flex;gap:8px;margin-bottom:14px;font-size:12px;font-weight:700;flex-wrap:wrap;')}>
                        {(['linkedin', 'facebook', 'instagram', 'whatsapp'] as PlatformKey[]).map((k, ki) => (
                          <span key={k} style={{
                            ...sx('display:flex;align-items:center;gap:6px;padding:5px 9px 5px 5px;border-radius:8px;'),
                            background: ki === 0 ? '#0a66c2' : '#f1f0f8',
                            color: ki === 0 ? '#fff' : '#4d5065',
                          }}>
                            <PlatformIcon k={k} size={16} />
                            {P[k].name}
                          </span>
                        ))}
                      </div>
                      <div style={sx('font-size:15px;line-height:1.6;color:#2a2c3d;')}>We rebuilt our onboarding from scratch this quarter. Three changes cut setup time from 40 minutes to 6. Here is what we learned.</div>
                      <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-top:18px;padding-top:14px;border-top:1px solid #f0f0f6;font-size:12px;color:#6b6d80;')}>
                        <span>Category: Product update</span><span style={sx('color:#5b4cf5;font-weight:700;')}>↻ Regenerate</span>
                      </div>
                    </>)}

                    {i === 2 && (<>
                      <div style={sx('display:grid;grid-template-columns:repeat(3,1fr);gap:10px;')}>
                        <div style={sx('aspect-ratio:1;border-radius:14px;background:linear-gradient(135deg,#c7b8ff,#f3c1e0);')} />
                        <div style={sx('aspect-ratio:1;border-radius:14px;background:linear-gradient(135deg,#a8d8ff,#c7b8ff);box-shadow:0 0 0 3px #5b4cf5;')} />
                        <div style={sx('aspect-ratio:1;border-radius:14px;background:linear-gradient(135deg,#ffd3b0,#f7a8c4);')} />
                        <div style={sx('aspect-ratio:1;border-radius:14px;background:linear-gradient(135deg,#b8f0d8,#a8c8ff);')} />
                        <div style={sx('aspect-ratio:1;border-radius:14px;background:linear-gradient(135deg,#ffe3a8,#ffb8a8);')} />
                        <div style={sx('aspect-ratio:1;border-radius:14px;border:1.5px dashed #c9c3ff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#5b4cf5;')}>+ Upload</div>
                      </div>
                      <div style={sx('margin-top:14px;font-size:12px;color:#6b6d80;')}>Single image or carousel · 1 selected</div>
                    </>)}

                    {i === 3 && (
                      <div style={sx('display:flex;gap:16px;')}>
                        <div style={sx('position:relative;width:48%;aspect-ratio:1;border-radius:16px;background:linear-gradient(135deg,#a8d8ff,#c7b8ff);')}>
                          <span style={sx('position:absolute;right:10px;bottom:10px;width:34px;height:34px;border-radius:10px;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 14px rgba(0,0,0,.12);')}>
                            <SPMark size={20} radius={6} />
                          </span>
                        </div>
                        <div style={sx('flex:1;display:flex;flex-direction:column;gap:12px;font-size:13px;')}>
                          <div>
                            <div style={sx('font-weight:700;color:#6b6d80;margin-bottom:6px;')}>Logo position</div>
                            <div style={sx('display:flex;gap:6px;')}>
                              <span style={sx('width:26px;height:26px;border-radius:7px;background:#f1f0f8;')} />
                              <span style={sx('width:26px;height:26px;border-radius:7px;background:#f1f0f8;')} />
                              <span style={sx('width:26px;height:26px;border-radius:7px;background:#5b4cf5;')} />
                            </div>
                          </div>
                          <div>
                            <div style={sx('font-weight:700;color:#6b6d80;margin-bottom:6px;')}>ALT text</div>
                            <div style={sx('border:1px solid #e4e4ee;border-radius:10px;padding:10px;line-height:1.45;color:#2a2c3d;')}>Setup screen showing a six-minute progress timer.</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {i === 4 && (<>
                      <div style={sx('border:1px solid #f0f0f6;border-radius:16px;padding:14px;')}>
                        <div style={sx('display:flex;align-items:center;gap:10px;')}>
                          <span style={sx('width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#5b6cff,#9b5cf6);')} />
                          <div><div style={sx('font-size:13px;font-weight:800;')}>Northwind Studio</div><div style={sx('font-size:11px;color:#8a8ca0;')}>LinkedIn preview</div></div>
                        </div>
                        <div style={sx('font-size:13px;line-height:1.5;margin:10px 0;')}>We rebuilt our onboarding from scratch this quarter…</div>
                        <div style={sx('height:110px;border-radius:10px;background:linear-gradient(135deg,#a8d8ff,#c7b8ff);')} />
                      </div>
                      <div style={sx('margin-top:12px;font-size:12px;color:#5b4cf5;font-weight:700;')}>Open full preview ↗</div>
                    </>)}

                    {i === 5 && (<>
                      <div style={sx('display:grid;grid-template-columns:repeat(7,1fr);gap:6px;text-align:center;font-size:12px;')}>
                        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, di) => <span key={di} style={sx('color:#8a8ca0;')}>{d}</span>)}
                        {[21, 22, 23, 24, 25, 26, 27].map(d => (
                          <span key={d} style={d === 24 ? sx('padding:8px 0;border-radius:9px;background:#5b4cf5;color:#fff;font-weight:800;') : sx(`padding:8px 0;${d > 25 ? 'color:#b4b5c4;' : ''}`)}>{d}</span>
                        ))}
                      </div>
                      <div style={sx('display:flex;gap:10px;margin-top:22px;')}>
                        <span style={sx('flex:1;text-align:center;padding:13px;border-radius:12px;background:linear-gradient(135deg,#5b6cff,#8b5cf6);color:#fff;font-weight:700;font-size:14px;')}>Schedule · Thu 10:00</span>
                        <span style={sx('flex:1;text-align:center;padding:13px;border-radius:12px;border:1px solid #e4e4ee;font-weight:700;font-size:14px;')}>Publish now</span>
                      </div>
                    </>)}
                  </div>
                );
              })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PLATFORMS */}
      <section id="platforms" style={sx('background:#fff;border-top:1px solid #efeff5;border-bottom:1px solid #efeff5;')}>
        <div style={sx('max-width:var(--lp-max);margin:0 auto;padding:var(--lp-sec-pad) var(--lp-pad);display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr));gap:56px;align-items:center;')}>
          <div>
            <div style={sx('font-size:12px;letter-spacing:.24em;color:#5b4cf5;font-weight:700;')}>PLATFORM-SPECIFIC CONTENT</div>
            <h2 style={sx('font-size:clamp(34px,4.2vw,52px);letter-spacing:-.035em;line-height:1.06;margin:16px 0;font-weight:800;')}>One idea. Four versions that fit where they land.</h2>
            <p style={sx('font-size:18px;color:#4d5065;line-height:1.6;margin:0 0 30px;text-wrap:pretty;')}>SocialPulse writes a separate caption for each platform, with the right tone, length, and format. Preview the real layout before anything goes out.</p>
            <div style={sx('display:flex;gap:10px;flex-wrap:wrap;')}>
              {tabsList.map(k => (
                <button key={k} className="lp-platform-tab" data-active={tab === k ? 'true' : 'false'} onClick={() => setTab(k)} style={{
                  ...sx('cursor:pointer;display:flex;align-items:center;gap:9px;padding:10px 16px 10px 10px;border-radius:12px;font-size:15px;font-weight:700;transition:all .2s;border:1px solid;white-space:nowrap;'),
                  borderColor: tab === k ? '#0f1020' : '#e4e4ee', background: tab === k ? '#0f1020' : '#fff', color: tab === k ? '#fff' : '#2a2c3d',
                }}>
                  <PlatformIcon k={k} size={26} />
                  {P[k].name}
                </button>
              ))}
            </div>
            <div style={sx('margin-top:22px;font-size:14px;color:#6b6d80;display:flex;align-items:flex-start;gap:8px;')}>
              <span style={sx('width:6px;height:6px;border-radius:50%;background:#5b4cf5;flex-shrink:0;margin-top:7px;')} />{cur.meta}
            </div>
          </div>
          {/* The per-platform preview card. `lp-preview-card` is centred and
              capped at min(440px, 100%) so it can never outgrow its column on a
              320px screen; the rotated backdrop behind it is inset and
              de-rotated per breakpoint, because a -4deg rotate on a tall column
              pushes its own corners past the viewport at phone widths. */}
          <div className="lp-preview-wrap" style={sx('position:relative;display:flex;justify-content:center;')}>
            <div className="lp-preview-backdrop" style={sx('position:absolute;inset:var(--lp-pv-inset,8% 4%);border-radius:40px;background:linear-gradient(135deg,#ece8ff,#f7eefe);transform:rotate(var(--lp-pv-rot,-4deg));')} />
            <div className="lp-preview-card" style={sx('position:relative;width:100%;max-width:min(440px,100%);background:#fff;border-radius:22px;box-shadow:0 40px 80px -24px rgba(40,30,120,.28),0 0 0 1px rgba(20,20,60,.05);overflow:hidden;')}>
              <div style={sx('display:flex;align-items:center;gap:11px;padding:16px 18px;border-bottom:1px solid #f2f2f7;')}>
                <PlatformIcon k={tab} size={38} shape="circle" />
                <div style={sx('flex:1;min-width:0;')}><div style={sx('font-size:15px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{cur.account}</div><div style={sx('font-size:12px;color:#8a8ca0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{cur.sub}</div></div>
                <span style={sx('font-size:12px;font-weight:700;color:#6b6d80;flex-shrink:0;')}>{cur.name}</span>
              </div>
              {!isWA ? (<>
                <div style={sx('padding:14px 18px;font-size:15px;line-height:1.55;color:#2a2c3d;')}>{cur.caption}</div>
                <div className="lp-preview-media" style={{ ...sx('height:var(--lp-pv-media-h,220px);aspect-ratio:var(--lp-pv-media-ar,auto);display:flex;align-items:flex-end;padding:18px;'), background: cur.img }}>
                </div>
                <div style={sx('padding:13px 18px;font-size:13px;font-weight:600;color:#6b6d80;')}>{cur.actions}</div>
              </>) : (
                <div style={sx('background:#efeae2;padding:22px 18px;min-height:340px;display:flex;flex-direction:column;align-items:flex-end;gap:8px;')}>
                  <div style={sx('max-width:84%;background:#d9fdd3;border-radius:12px 12px 2px 12px;padding:8px;box-shadow:0 1px 1px rgba(0,0,0,.08);')}>
                    <div style={{ ...sx('height:var(--lp-pv-wa-media-h,150px);display:flex;align-items:flex-end;padding:12px;'), background: cur.img }}>
                    </div>
                    <div style={sx('font-size:14px;line-height:1.5;color:#1d1f33;padding:8px 4px 2px;')}>{cur.caption}</div>
                    <div style={sx('text-align:right;font-size:11px;color:#6b8f6b;')}>10:00 ✓✓</div>
                  </div>
                </div>
              )}
              <div style={sx('padding:14px 18px;border-top:1px solid #f2f2f7;display:flex;justify-content:flex-end;')}>
                <Hover tag="button" onClick={() => setModal(true)} base="cursor:pointer;border:none;background:#0f1020;color:#fff;font-weight:700;font-size:14px;padding:11px 18px;border-radius:11px;" hover="background:#2a2c3d">
                  Open platform preview ↗
                </Hover>
              </div>
            </div>
          </div>
        </div>
      </section>

      {modal && (
        <div onClick={() => setModal(false)} style={sx('position:fixed;inset:0;z-index:100;background:rgba(15,16,32,.55);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px;')}>
          <div onClick={e => e.stopPropagation()} style={sx('width:100%;max-width:520px;max-height:92vh;overflow:auto;background:#fff;border-radius:24px;box-shadow:0 50px 100px -20px rgba(0,0,0,.4);')}>
            <div style={sx('display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid #f0f0f6;')}>
              <div style={sx('font-weight:800;font-size:17px;')}>{cur.name} preview</div>
              <button onClick={() => setModal(false)} style={sx('cursor:pointer;border:none;background:#f1f0f8;width:34px;height:34px;border-radius:10px;font-size:16px;')}>✕</button>
            </div>
            <div style={sx('display:flex;gap:8px;padding:14px 20px;flex-wrap:wrap;')}>
              {tabsList.map(k => (
                <button key={k} onClick={() => setTab(k)} style={{
                  ...sx('cursor:pointer;padding:7px 12px;border-radius:9px;font-size:13px;font-weight:700;border:1px solid;'),
                  borderColor: tab === k ? '#0f1020' : '#e4e4ee', background: tab === k ? '#0f1020' : '#fff', color: tab === k ? '#fff' : '#2a2c3d',
                }}>{P[k].name}</button>
              ))}
            </div>
            <div style={sx('margin:0 20px;border:1px solid #efeff5;border-radius:18px;overflow:hidden;')}>
              <div style={sx('display:flex;align-items:center;gap:11px;padding:14px 16px;')}>
                <PlatformIcon k={tab} size={40} shape="circle" />
                <div style={sx('min-width:0;')}><div style={sx('font-size:15px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{cur.account}</div><div style={sx('font-size:12px;color:#8a8ca0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{cur.sub}</div></div>
              </div>
              <div style={sx('padding:0 16px 14px;font-size:15px;line-height:1.55;')}>{cur.caption}</div>
              <div className="lp-preview-media" style={{ ...sx('height:var(--lp-pv-modal-media-h,260px);aspect-ratio:var(--lp-pv-modal-media-ar,auto);display:flex;align-items:flex-end;padding:18px;'), background: cur.img }}>
              </div>
              <div style={sx('padding:12px 16px;font-size:13px;font-weight:600;color:#6b6d80;')}>{cur.actions}</div>
            </div>
            <div style={sx('display:flex;gap:10px;padding:18px 20px 22px;')}>
              <button onClick={() => setModal(false)} style={sx('cursor:pointer;flex:1;border:1px solid #e4e4ee;background:#fff;padding:13px;border-radius:12px;font-weight:700;font-size:14px;')}>Back to editing</button>
              <button onClick={() => setModal(false)} style={sx('cursor:pointer;flex:1;border:none;background:linear-gradient(135deg,#5b6cff,#8b5cf6);color:#fff;padding:13px;border-radius:12px;font-weight:700;font-size:14px;')}>Schedule</button>
            </div>
          </div>
        </div>
      )}

      {/* SCHEDULER */}
      <section id="scheduler" style={sx('max-width:var(--lp-max);margin:0 auto;padding:var(--lp-sec-pad) var(--lp-pad);')}>
        <div style={sx('display:flex;justify-content:space-between;align-items:flex-end;gap:30px;flex-wrap:wrap;margin-bottom:40px;')}>
          <div style={sx('max-width:620px;')}>
            <div style={sx('font-size:12px;letter-spacing:.24em;color:#5b4cf5;font-weight:700;')}>SCHEDULER</div>
            <h2 style={sx('font-size:clamp(34px,4.2vw,52px);letter-spacing:-.035em;line-height:1.06;margin:16px 0 0;font-weight:800;')}>Drafts, scheduled, published. Nothing gets lost.</h2>
          </div>
          <p style={sx('font-size:17px;color:#4d5065;line-height:1.6;margin:0;max-width:400px;')}>Cancel a scheduled post and it moves back to Drafts instead of being deleted. Try it below.</p>
        </div>
        <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:18px;')}>
          <div style={sx('background:#eeedf6;border-radius:22px;padding:16px;')}>
            <div style={sx('display:flex;justify-content:space-between;align-items:center;padding:4px 6px 14px;')}>
              <span style={sx('font-weight:800;font-size:16px;')}>Drafts</span>
              <span style={sx('font-size:13px;font-weight:700;color:#6b6d80;background:#fff;padding:3px 10px;border-radius:999px;')}>{drafts.length}</span>
            </div>
            <div style={sx('display:flex;flex-direction:column;gap:10px;')}>
              {drafts.map(p => (
                <div key={p.id} style={sx('background:#fff;border-radius:16px;padding:14px;box-shadow:0 1px 2px rgba(20,20,60,.06);')}>
                  <div style={sx('display:flex;align-items:center;gap:10px;')}>
                    <PlatformIcon k={p.p} size={22} />
                    <span style={sx('font-size:15px;font-weight:700;')}>{p.title}</span>
                  </div>
                  <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-top:12px;')}>
                    <span style={sx('font-size:12px;color:#8a8ca0;')}>{p.time}</span>
                    <Hover tag="button" onClick={() => move(p.id, 'scheduled', `"${p.title}" scheduled for Wed, 11:00 AM`)} base="cursor:pointer;border:none;background:#efedff;color:#5b4cf5;font-weight:700;font-size:12px;padding:7px 12px;border-radius:9px;" hover="background:#e0dcff">Schedule →</Hover>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={sx('background:#eeedf6;border-radius:22px;padding:16px;')}>
            <div style={sx('display:flex;justify-content:space-between;align-items:center;padding:4px 6px 14px;')}>
              <span style={sx('font-weight:800;font-size:16px;display:flex;align-items:center;gap:8px;')}><span style={sx('width:8px;height:8px;border-radius:50%;background:#5b4cf5;')} />Scheduled</span>
              <span style={sx('font-size:13px;font-weight:700;color:#6b6d80;background:#fff;padding:3px 10px;border-radius:999px;')}>{scheduled.length}</span>
            </div>
            <div style={sx('display:flex;flex-direction:column;gap:10px;')}>
              {scheduled.map(p => (
                <div key={p.id} style={sx('background:#fff;border-radius:16px;padding:14px;box-shadow:0 1px 2px rgba(20,20,60,.06);border-left:0;')}>
                  <div style={sx('display:flex;align-items:center;gap:10px;')}>
                    <PlatformIcon k={p.p} size={22} />
                    <span style={sx('font-size:15px;font-weight:700;')}>{p.title}</span>
                  </div>
                  <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-top:12px;')}>
                    <span style={sx('font-size:12px;color:#5b4cf5;font-weight:700;')}>{p.time}</span>
                    <Hover tag="button" onClick={() => move(p.id, 'draft', `"${p.title}" moved back to Drafts`)} base="cursor:pointer;border:1px solid #e4e4ee;background:#fff;color:#4d5065;font-weight:700;font-size:12px;padding:6px 11px;border-radius:9px;" hover="border:1px solid #f0a8a8;color:#c0392b">← Cancel to Drafts</Hover>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={sx('background:#eeedf6;border-radius:22px;padding:16px;')}>
            <div style={sx('display:flex;justify-content:space-between;align-items:center;padding:4px 6px 14px;')}>
              <span style={sx('font-weight:800;font-size:16px;display:flex;align-items:center;gap:8px;')}><span style={sx('width:8px;height:8px;border-radius:50%;background:#22c55e;')} />Published</span>
              <span style={sx('font-size:13px;font-weight:700;color:#6b6d80;background:#fff;padding:3px 10px;border-radius:999px;')}>{published.length}</span>
            </div>
            <div style={sx('display:flex;flex-direction:column;gap:10px;')}>
              {published.map(p => (
                <div key={p.id} style={sx('background:#fff;border-radius:16px;padding:14px;box-shadow:0 1px 2px rgba(20,20,60,.06);')}>
                  <div style={sx('display:flex;align-items:center;gap:10px;')}>
                    <PlatformIcon k={p.p} size={22} />
                    <span style={sx('font-size:15px;font-weight:700;')}>{p.title}</span>
                  </div>
                  <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-top:12px;')}>
                    <span style={sx('font-size:12px;color:#8a8ca0;')}>{p.time}</span>
                    <span style={sx('font-size:12px;font-weight:700;color:#16a34a;')}>{p.stat}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {toast && (
        <div style={sx('position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:90;background:#0f1020;color:#fff;padding:13px 20px;border-radius:14px;font-size:14px;font-weight:600;box-shadow:0 20px 40px -10px rgba(0,0,0,.35);display:flex;align-items:center;gap:10px;')}>
          <span style={sx('width:8px;height:8px;border-radius:50%;background:#4ade80;')} />{toast}
        </div>
      )}

      {/* FEATURES */}
      <section id="features" style={sx('max-width:var(--lp-max);margin:0 auto;padding:40px var(--lp-pad) var(--lp-sec-pad);')}>
        <div style={sx('text-align:center;max-width:700px;margin:0 auto 48px;')}>
          <div style={sx('font-size:12px;letter-spacing:.24em;color:#5b4cf5;font-weight:700;')}>MORE THAN A SCHEDULER</div>
          <h2 style={sx('font-size:clamp(34px,4.2vw,52px);letter-spacing:-.035em;line-height:1.06;margin:16px 0 0;font-weight:800;')}>Everything around the post, in the same place.</h2>
        </div>
        <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:18px;')}>

          <div style={sx('grid-column:1/-1;background:#fff;border-radius:26px;padding:30px;box-shadow:0 0 0 1px #efeff5;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:30px;align-items:center;')}>
            <div>
              <div style={sx('font-size:13px;font-weight:700;color:#5b4cf5;')}>Asset Gallery</div>
              <h3 style={sx('font-size:28px;letter-spacing:-.025em;margin:10px 0;font-weight:800;')}>Every image, one library.</h3>
              <p style={sx('font-size:16px;color:#4d5065;line-height:1.6;margin:0 0 20px;')}>Generated, uploaded, Canva-edited, branded, and carousel media, all filterable and ready to reuse.</p>
              <div style={sx('display:flex;gap:8px;flex-wrap:wrap;')}>
                {ASSET_FILTERS.map(f => (
                  <button key={f} onClick={() => setFilter(f)} style={{
                    ...sx('cursor:pointer;border:none;padding:8px 14px;border-radius:999px;font-size:13px;font-weight:700;transition:all .2s;'),
                    background: filter === f ? '#0f1020' : '#f1f0f8', color: filter === f ? '#fff' : '#4d5065',
                  }}>{f}</button>
                ))}
              </div>
            </div>
            <div style={sx('display:grid;grid-template-columns:repeat(4,1fr);gap:10px;min-height:200px;align-content:start;')}>
              {assets.map(([tag, emoji, background], i) => (
                <div key={i} style={{ ...sx('position:relative;aspect-ratio:1;border-radius:14px;display:flex;align-items:center;justify-content:center;'), background }}>
                  <span aria-hidden="true" style={sx('font-size:32px;filter:drop-shadow(0 5px 8px rgba(50,35,90,.14));')}>{emoji}</span>
                  <span style={sx('position:absolute;left:7px;bottom:7px;font-size:10px;font-weight:700;background:rgba(255,255,255,.9);padding:3px 7px;border-radius:6px;')}>{tag}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={sx('background:#fff;border-radius:26px;padding:30px;box-shadow:0 0 0 1px #efeff5;')}>
            <div style={sx('font-size:13px;font-weight:700;color:#7d2ae8;')}>Canva round-trip</div>
            <h3 style={sx('font-size:24px;letter-spacing:-.02em;margin:10px 0;font-weight:800;')}>Edit in Canva. Come back to exactly where you were.</h3>
            <div style={sx('display:flex;flex-direction:column;gap:10px;margin-top:22px;')}>
              {[['1', 'Open the design in Canva', 'linear-gradient(135deg,#00c4cc,#7d2ae8)'], ['2', 'Switch back to SocialPulse', 'linear-gradient(135deg,#00c4cc,#7d2ae8)'], ['3', 'Import the edit and keep publishing', 'linear-gradient(135deg,#5b6cff,#9b5cf6)']].map(([n, label, bg]) => (
                <div key={n} style={sx('display:flex;align-items:center;gap:12px;padding:12px;border-radius:14px;background:#f6f5fb;')}>
                  <span style={{ ...sx('width:32px;height:32px;border-radius:10px;color:#fff;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;'), background: bg }}>{n}</span>
                  <span style={sx('font-size:15px;font-weight:600;')}>{label}</span>
                </div>
              ))}
            </div>
            <p style={sx('font-size:14px;color:#6b6d80;line-height:1.55;margin:16px 0 0;')}>Captions, platforms, and schedule stay intact.</p>
          </div>

          <div style={sx('background:#fff;border-radius:26px;padding:30px;box-shadow:0 0 0 1px #efeff5;')}>
            <div style={sx('font-size:13px;font-weight:700;color:#16a34a;')}>WhatsApp</div>
            <h3 style={sx('font-size:24px;letter-spacing:-.02em;margin:10px 0;font-weight:800;')}>Post to the groups you already have.</h3>
            <div style={sx('display:flex;flex-direction:column;gap:8px;margin-top:22px;')}>
              {groups.map((g, i) => (
                <Hover key={g.name} tag="div" onClick={() => setGroups(prev => prev.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} base="cursor:pointer;display:flex;align-items:center;gap:12px;padding:12px;border-radius:14px;border:1px solid #efeff5;" hover="background:#f7fbf8">
                  <span style={{ ...sx('width:22px;height:22px;border-radius:7px;color:#fff;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;border:1.5px solid;'), borderColor: g.on ? '#25d366' : '#d4d4e0', background: g.on ? '#25d366' : '#fff' }}>{g.on ? '✓' : ''}</span>
                  <span style={sx('flex:1;font-size:15px;font-weight:600;')}>{g.name}</span>
                  <span style={sx('font-size:12px;color:#8a8ca0;')}>{g.members} members</span>
                </Hover>
              ))}
            </div>
            <Hover tag="button" onClick={() => flash(`Sent to ${nGroups} WhatsApp groups`)} base="cursor:pointer;margin-top:14px;width:100%;border:none;background:#25d366;color:#fff;padding:12px;border-radius:12px;font-weight:700;font-size:14px;" hover="background:#1fb857">
              Send to {nGroups} groups
            </Hover>
          </div>

          <div style={sx('background:#fff;border-radius:26px;padding:30px;box-shadow:0 0 0 1px #efeff5;')}>
            <div style={sx('font-size:13px;font-weight:700;color:#0a66c2;')}>Analytics</div>
            <h3 style={sx('font-size:24px;letter-spacing:-.02em;margin:10px 0;font-weight:800;')}>See what&apos;s working, per platform.</h3>
            <div style={sx('display:flex;align-items:flex-end;gap:10px;height:150px;margin-top:26px;padding-bottom:8px;border-bottom:1px solid #efeff5;')}>
              {[40, 58, 48, 72, 66, 92, 80].map((h, i) => (
                <div key={i} style={{ ...sx('flex:1;border-radius:8px 8px 3px 3px;'), height: h + '%', background: i === 5 ? 'linear-gradient(180deg,#8b5cf6,#5b6cff)' : (i % 2 === 0 ? '#e4e1ff' : '#d5d0ff') }} />
              ))}
            </div>
            <div style={sx('display:flex;justify-content:space-between;font-size:12px;color:#8a8ca0;margin-top:8px;')}><span>Mon</span><span>Sun</span></div>
            <p style={sx('font-size:14px;color:#6b6d80;line-height:1.55;margin:14px 0 0;')}>Insights depend on each connected platform&apos;s API.</p>
          </div>

        </div>
      </section>

      {/* CTA */}
      <section id="start" style={sx('max-width:var(--lp-max);margin:0 auto;padding:0 var(--lp-pad) var(--lp-sec-pad);')}>
        <div style={sx('position:relative;overflow:hidden;border-radius:clamp(20px,4vw,32px);background:radial-gradient(700px 400px at 80% 50%,#3b2f9e 0%,rgba(59,47,158,0) 70%),#0f1020;color:#fff;padding:var(--lp-cta-pad,72px 56px);display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr));gap:40px;align-items:center;')}>
          <div style={sx('position:relative;z-index:2;')}>
            <h2 style={sx('font-size:clamp(40px,5vw,64px);letter-spacing:-.04em;line-height:1.02;margin:0 0 20px;font-weight:800;')}>
              Create. Brand.<br />Schedule.{' '}
              <span style={sx('background:linear-gradient(90deg,#7c9bff,#b18cff,#e08cf5);-webkit-background-clip:text;background-clip:text;color:transparent;')}>Grow.</span>
            </h2>
            <p style={sx('font-size:18px;line-height:1.6;color:#c9cadb;margin:0 0 32px;max-width:460px;')}>Bring your ideas, media, brand, and schedule into one workspace.</p>
            <div style={sx('display:flex;gap:14px;flex-wrap:wrap;')}>
              <Hover tag={Link} href="/login-signup?mode=signup" className="lp-btn-primary" base="color:#0f1020;background:#fff;border-radius:14px;font-weight:700;display:inline-block;" hover="transform:translateY(-2px)">Get Started Free →</Hover>
              <Hover tag="a" href="#workflow" className="lp-btn-secondary" base="color:#fff;border-radius:14px;font-weight:600;border:1px solid rgba(255,255,255,.22);display:inline-block;" hover="border:1px solid rgba(255,255,255,.5)">See the workflow</Hover>
            </div>
          </div>
          <div className="lp-cta-visual" style={sx('position:relative;height:var(--lp-cta-h,340px);perspective:1100px;display:flex;align-items:center;justify-content:center;')}>
            <div className="lp-orbit-track lp-orbit-track-outer" aria-hidden="true" />
            <div className="lp-orbit-track lp-orbit-track-inner" aria-hidden="true" />
            {/* THE ORIGINAL SocialPulse mark at the centre of the orbit — the
                same file as the nav and the footer, not a gradient + zigzag. */}
            <div className="lp-orbit-center" style={sx('position:absolute;width:var(--lp-orbit-center,112px);height:var(--lp-orbit-center,112px);border-radius:26%;box-shadow:0 0 80px rgba(139,92,246,.55);display:flex;align-items:center;justify-content:center;z-index:2;overflow:hidden;')}>
              <SPMark size="var(--lp-orbit-center, 92px)" />
            </div>
            {/* The orbit radius, tile size and tilt are all custom properties, so
                the ring can be sized to fit its column per breakpoint instead of
                being scaled as a whole. Scaling the whole thing is what used to
                clip the outermost icons against the dark panel's own edge while
                still leaving them too big to read. */}
            <div ref={ringRef} className="lp-orbit-ring" style={sx('position:absolute;width:var(--lp-orbit-tile,58px);height:var(--lp-orbit-tile,58px);z-index:1;transform-style:preserve-3d;transform:rotateX(var(--lp-orbit-tilt,-54deg));')}>
              {ringTiles.map((t, i) => (
                <div key={t.k + i} className="lp-orbit-tile" style={{ ...sx('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;'), transform: t.tf }}>
                  <PlatformIcon k={t.k} size="var(--lp-orbit-tile, 58px)" shape="square" pad={0.92} className="lp-orbit-icon" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer style={sx('max-width:var(--lp-max);margin:0 auto;padding:28px var(--lp-pad) 48px;display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap;border-top:1px solid #e7e7f1;font-size:14px;color:#6b6d80;')}>
        <div style={sx('display:flex;align-items:center;gap:10px;font-weight:800;color:#0f1020;font-size:16px;')}>
          <SPMark size={26} radius={7} />SocialPulse
        </div>
        <div style={sx('display:flex;gap:26px;flex-wrap:wrap;')}>
          <a href="#workflow" style={sx('color:#6b6d80;')}>Workflow</a>
          <a href="#platforms" style={sx('color:#6b6d80;')}>Platforms</a>
          <a href="#scheduler" style={sx('color:#6b6d80;')}>Scheduler</a>
          <a href="#features" style={sx('color:#6b6d80;')}>Features</a>
        </div>
        <span>© 2026 SocialPulse</span>
      </footer>
    </div>
  );
}
