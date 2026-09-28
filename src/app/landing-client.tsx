'use client';

import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from 'react';
import Link from 'next/link';
import { Caveat, Plus_Jakarta_Sans } from 'next/font/google';

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

const PulseIcon = ({ size = 22, stroke = '#fff', strokeWidth = 2.4 }: { size?: number; stroke?: string; strokeWidth?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="2,12 7,12 10,5 14,19 17,12 22,12" />
  </svg>
);

type PlatformKey = 'linkedin' | 'facebook' | 'instagram' | 'whatsapp' | 'canva';
const P: Record<PlatformKey, { name: string; short: string; bg: string }> = {
  linkedin: { name: 'LinkedIn', short: 'in', bg: '#0a66c2' },
  facebook: { name: 'Facebook', short: 'f', bg: '#1877f2' },
  instagram: { name: 'Instagram', short: 'IG', bg: 'linear-gradient(45deg,#f58529,#dd2a7b,#8134af)' },
  whatsapp: { name: 'WhatsApp', short: 'W', bg: '#25d366' },
  canva: { name: 'Canva', short: 'C', bg: 'linear-gradient(135deg,#00c4cc,#7d2ae8)' },
};

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

const CAPTIONS: Record<'linkedin' | 'facebook' | 'instagram' | 'whatsapp', { account: string; sub: string; caption: string; meta: string; actions: string; img: string; overlay: string }> = {
  linkedin: { account: 'Northwind Studio', sub: '2,340 followers · Promoted by you', caption: 'We rebuilt our onboarding from scratch this quarter. Three changes cut setup time from 40 minutes to 6. Here is what we learned and what we would do differently.', meta: 'Professional tone · Single image · 3,000 char limit', actions: 'Like · Comment · Repost · Send', img: IMG[1], overlay: '40 min → 6 min' },
  facebook: { account: 'Northwind Studio', sub: 'Just now · Public', caption: 'Big news from the studio: our new onboarding is live. Setup now takes about 6 minutes. Give it a try and tell us what you think in the comments.', meta: 'Friendly tone · Single image · Link preview', actions: 'Like · Comment · Share', img: IMG[2], overlay: 'New onboarding is live' },
  instagram: { account: 'northwind.studio', sub: 'Sponsored · Carousel 1/4', caption: 'Setup in 6 minutes. Swipe through to see the new flow. #productdesign #onboarding #studiolife', meta: 'Casual tone · Carousel · 4 slides · Hashtags', actions: 'Like · Comment · Share · Save', img: IMG[0], overlay: 'Swipe to see the new flow' },
  whatsapp: { account: 'Northwind Partners', sub: '48 members', caption: 'Hi team, the new onboarding is live. Setup takes about 6 minutes now. Full walkthrough: northwind.studio/new', meta: 'Direct tone · Sent to 2 groups', actions: '', img: IMG[3], overlay: 'Onboarding walkthrough' },
};

const ASSET_FILTERS = ['All', 'Generated', 'Uploaded', 'Canva', 'Branded', 'Carousel'];
const ASSETS_ALL: [string, string][] = [
  ['Generated', IMG[0]], ['Uploaded', IMG[2]], ['Canva', IMG[1]], ['Branded', IMG[3]],
  ['Carousel', IMG[4]], ['Generated', IMG[5]], ['Branded', IMG[2]], ['Canva', IMG[0]],
];

const RING_KEYS: PlatformKey[] = ['linkedin', 'facebook', 'instagram', 'whatsapp', 'canva', 'linkedin', 'instagram', 'whatsapp'];

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

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      anim.current.tx = e.clientX / window.innerWidth - 0.5;
      anim.current.ty = e.clientY / window.innerHeight - 0.5;
    };
    window.addEventListener('mousemove', onMove);

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
      if (heroStageRef.current) heroStageRef.current.style.transform = `rotateX(${10 - a.cy * 8}deg) rotateY(${-16 + a.cx * 12}deg)`;
      floats.forEach(([ref, z, amp, speed, phase]) => {
        if (ref.current) ref.current.style.transform = `translate3d(0,${Math.sin(t * speed + phase) * amp}px,${z}px)`;
      });
      if (ringRef.current) ringRef.current.style.transform = `rotateX(-14deg) rotateY(${t * 22}deg)`;
      if (stackRef.current) stackRef.current.style.transform = `rotateX(${8 - a.cy * 5}deg) rotateY(${-20 + a.cx * 8}deg)`;
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
    { title: 'Onboarding launch recap', time: 'Thu, 10:00 AM', img: IMG[1], ...P.linkedin },
    { title: 'Autumn collection carousel', time: 'Fri, 6:30 PM', img: IMG[0], ...P.instagram },
    { title: 'Team update for partners', time: 'Mon, 9:00 AM', img: IMG[3], ...P.whatsapp },
  ];
  const platformTiles: PlatformKey[] = ['linkedin', 'facebook', 'instagram', 'whatsapp'];
  const tabsList: ('linkedin' | 'facebook' | 'instagram' | 'whatsapp')[] = ['linkedin', 'facebook', 'instagram', 'whatsapp'];
  const ringTiles = RING_KEYS.map((k, i) => ({ ...P[k], tf: `rotateY(${i * 45}deg) translateZ(210px)` }));

  return (
    <div className={jakarta.className} style={{ background: '#f6f6fb', color: '#0f1020', WebkitFontSmoothing: 'antialiased', scrollBehavior: 'smooth' }}>
      <div style={{ position: 'relative', overflow: 'hidden', background: 'radial-gradient(900px 600px at 78% 12%,#ebe6ff 0%,rgba(235,230,255,0) 70%),radial-gradient(700px 500px at 5% 90%,#eef2ff 0%,rgba(238,242,255,0) 70%),#f6f6fb' }}>
        {/* NAV */}
        <nav style={sx('max-width:1240px;margin:0 auto;padding:22px 28px;display:flex;align-items:center;justify-content:space-between;gap:24px;position:relative;z-index:5;')}>
          <a href="#" style={sx('display:flex;align-items:center;gap:12px;color:#0f1020;')}>
            <span style={sx('width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#5b6cff,#9b5cf6);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px rgba(91,76,245,.35);')}>
              <PulseIcon />
            </span>
            <span style={sx('font-weight:800;font-size:22px;letter-spacing:-.02em;')}>SocialPulse</span>
          </a>
          <div style={sx('display:flex;gap:34px;font-size:15px;font-weight:500;flex-wrap:wrap;')}>
            <a href="#workflow" style={sx('color:#2a2c3d;')}>Workflow</a>
            <a href="#platforms" style={sx('color:#2a2c3d;')}>Platforms</a>
            <a href="#scheduler" style={sx('color:#2a2c3d;')}>Scheduler</a>
            <a href="#features" style={sx('color:#2a2c3d;')}>Features</a>
          </div>
          <div style={sx('display:flex;align-items:center;gap:22px;')}>
            <Link href="/login-signup?mode=login" style={sx('color:#0f1020;font-weight:600;font-size:15px;')}>Log in</Link>
            <Hover tag={Link} href="/login-signup?mode=signup" base="color:#fff;background:linear-gradient(135deg,#5b6cff,#8b5cf6);padding:12px 22px;border-radius:12px;font-weight:600;font-size:15px;box-shadow:0 10px 24px rgba(91,76,245,.3);display:inline-block;" hover="transform:translateY(-1px);box-shadow:0 14px 30px rgba(91,76,245,.4)">
              Get Started →
            </Hover>
          </div>
        </nav>

        {/* HERO */}
        <header style={sx('max-width:1240px;margin:0 auto;padding:40px 28px 60px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,480px),1fr));gap:40px;align-items:center;')}>
          <div style={sx('position:relative;z-index:3;')}>
            <div style={sx('display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:#ece8ff;color:#5b4cf5;font-size:14px;font-weight:600;')}>
              <span style={sx('width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,#5b6cff,#c056f0);')} />
              AI-powered social media workspace
            </div>
            <h1 style={sx('font-size:clamp(52px,7vw,88px);line-height:1;letter-spacing:-.045em;font-weight:800;margin:26px 0 24px;')}>
              Create. Brand.<br />Schedule.{' '}
              <span style={sx('background:linear-gradient(90deg,#4f7cff,#8b5cf6,#c056f0);-webkit-background-clip:text;background-clip:text;color:transparent;')}>Grow.</span>
            </h1>
            <p style={sx('font-size:19px;line-height:1.6;color:#4d5065;max-width:520px;margin:0 0 34px;text-wrap:pretty;')}>
              An AI-powered social media workspace for creating, previewing, scheduling, and publishing content across multiple platforms.
            </p>
            <div style={sx('display:flex;gap:14px;flex-wrap:wrap;')}>
              <Hover tag={Link} href="/login-signup?mode=signup" base="color:#fff;background:linear-gradient(135deg,#5b6cff,#8b5cf6);padding:18px 30px;border-radius:14px;font-weight:600;font-size:17px;box-shadow:0 14px 30px rgba(91,76,245,.35);display:inline-block;" hover="transform:translateY(-2px)">
                Get Started Free →
              </Hover>
              <Hover tag="a" href="#workflow" base="color:#0f1020;background:#fff;padding:18px 26px;border-radius:14px;font-weight:600;font-size:17px;border:1px solid #e4e4ee;display:flex;align-items:center;gap:10px;" hover="border:1px solid #c9c3ff">
                <span style={sx('width:24px;height:24px;border-radius:50%;background:#0f1020;display:flex;align-items:center;justify-content:center;')}>
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

          <div style={sx('position:relative;height:600px;perspective:1800px;')}>
            <div ref={heroStageRef} style={sx('position:absolute;inset:0;transform-style:preserve-3d;transform:rotateX(10deg) rotateY(-16deg);')}>
              <div style={sx('position:absolute;left:12%;top:8%;width:78%;height:80%;border-radius:50%;background:radial-gradient(circle at 40% 40%,#d9d0ff,#efeaff 60%,rgba(239,234,255,0) 72%);transform:translateZ(-160px);')} />

              <div style={sx('position:absolute;left:0;top:70px;width:86%;background:#fff;border-radius:22px;box-shadow:0 40px 80px -20px rgba(40,30,120,.25),0 0 0 1px rgba(20,20,60,.05);display:flex;overflow:hidden;transform:translateZ(0);')}>
                <div style={sx('width:132px;padding:18px 12px;border-right:1px solid #f0f0f6;display:flex;flex-direction:column;gap:4px;font-size:12px;color:#4d5065;')}>
                  <div style={sx('display:flex;align-items:center;gap:7px;font-weight:800;font-size:13px;color:#0f1020;margin:0 0 14px 6px;')}>
                    <span style={sx('width:18px;height:18px;border-radius:6px;background:linear-gradient(135deg,#5b6cff,#9b5cf6);')} />SocialPulse
                  </div>
                  <div style={sx('padding:8px 10px;border-radius:9px;background:#efedff;color:#5b4cf5;font-weight:700;')}>Home</div>
                  <div style={sx('padding:8px 10px;')}>Content Studio</div>
                  <div style={sx('padding:8px 10px;')}>Scheduler</div>
                  <div style={sx('padding:8px 10px;')}>Asset Gallery</div>
                  <div style={sx('padding:8px 10px;')}>Analytics</div>
                  <div style={sx('padding:8px 10px;')}>Connections</div>
                </div>
                <div style={sx('flex:1;padding:18px 20px;min-width:0;')}>
                  <div style={sx('display:flex;justify-content:space-between;align-items:center;')}>
                    <div>
                      <div style={sx('font-weight:800;font-size:17px;letter-spacing:-.01em;')}>Good morning, Alex</div>
                      <div style={sx('font-size:11px;color:#8a8ca0;margin-top:3px;')}>Here&apos;s what&apos;s happening with your content.</div>
                    </div>
                    <div style={sx('width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#ffc9a8,#f59ab5);')} />
                  </div>
                  <div style={sx('display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0;')}>
                    {[['Drafts', '8'], ['Scheduled', '24'], ['Published', '132']].map(([label, val]) => (
                      <div key={label} style={sx('border:1px solid #f0f0f6;border-radius:12px;padding:10px 12px;')}>
                        <div style={sx('font-size:10px;color:#8a8ca0;')}>{label}</div>
                        <div style={sx('font-size:20px;font-weight:800;margin-top:4px;')}>{val}</div>
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
                      <div style={{ ...sx('width:22px;height:22px;border-radius:6px;color:#fff;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center;'), background: p.bg }}>{p.short}</div>
                      <div style={sx('font-size:10px;font-weight:700;color:#5b4cf5;background:#efedff;padding:4px 9px;border-radius:999px;')}>Scheduled</div>
                    </div>
                  ))}
                </div>
              </div>

              <div ref={fARef} style={sx('position:absolute;right:2%;top:150px;width:200px;height:360px;border-radius:30px;background:#fff;padding:8px;box-shadow:0 40px 70px -18px rgba(40,30,120,.35);transform:translateZ(140px);')}>
                <div style={sx('position:relative;height:100%;border-radius:23px;overflow:hidden;background:linear-gradient(160deg,#b9a8ff 0%,#e7b4ec 55%,#ffd3c2 100%);')}>
                  <div style={sx('position:absolute;top:14px;left:14px;right:14px;display:flex;align-items:center;gap:7px;')}>
                    <span style={sx('width:22px;height:22px;border-radius:50%;background:#fff;')} />
                    <span style={sx('font-size:10px;font-weight:700;color:#fff;')}>northwind.studio</span>
                  </div>
                  <div className={caveat.className} style={sx('position:absolute;left:16px;top:90px;font-size:34px;line-height:1;color:#fff;')}>Good content,<br />brighter days</div>
                  <div style={sx('position:absolute;left:10px;right:10px;bottom:10px;background:rgba(255,255,255,.92);border-radius:14px;padding:10px;display:flex;align-items:center;gap:8px;')}>
                    <span style={sx('width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,#5b6cff,#9b5cf6);flex-shrink:0;')} />
                    <div><div style={sx('font-size:11px;font-weight:800;')}>Instagram preview</div><div style={sx('font-size:9px;color:#6b6d80;')}>Carousel · 4 slides</div></div>
                  </div>
                </div>
              </div>

              <div ref={fBRef} style={sx('position:absolute;left:-4%;top:10px;background:#fff;border-radius:16px;padding:12px 14px;box-shadow:0 24px 50px -14px rgba(40,30,120,.3);display:flex;align-items:center;gap:10px;transform:translateZ(200px);')}>
                <span style={sx('width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,#5b6cff,#c056f0);color:#fff;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;')}>AI</span>
                <div><div style={sx('font-size:12px;font-weight:800;')}>4 captions generated</div><div style={sx('font-size:10px;color:#8a8ca0;')}>LinkedIn · Facebook · Instagram · WhatsApp</div></div>
              </div>

              <div ref={fCRef} style={sx('position:absolute;left:18%;bottom:30px;background:#0f1020;color:#fff;border-radius:14px;padding:11px 14px;box-shadow:0 24px 50px -14px rgba(15,16,32,.45);display:flex;align-items:center;gap:10px;transform:translateZ(170px);')}>
                <span style={sx('width:8px;height:8px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 4px rgba(74,222,128,.2);')} />
                <span style={sx('font-size:12px;font-weight:600;')}>Scheduled · Thu, 10:00 AM</span>
              </div>

              <div ref={fDRef} style={sx('position:absolute;right:-5%;top:200px;display:flex;flex-direction:column;gap:10px;transform:translateZ(240px);')}>
                {platformTiles.map(k => (
                  <div key={k} style={{ ...sx('width:40px;height:40px;border-radius:12px;color:#fff;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;box-shadow:0 12px 24px -8px rgba(0,0,0,.35);'), background: P[k].bg }}>{P[k].short}</div>
                ))}
              </div>

              <div className={caveat.className} style={sx('position:absolute;right:6%;top:40px;font-size:26px;color:#5b5e72;transform:translateZ(80px) rotate(-8deg);')}>Idea to impact ↓</div>
              <div className={caveat.className} style={sx('position:absolute;right:26%;bottom:-6px;font-size:24px;color:#5b5e72;transform:translateZ(60px) rotate(-6deg);')}>Plan today, publish everywhere</div>
            </div>
          </div>
        </header>
      </div>

      {/* LOGO STRIP */}
      <div style={sx('max-width:1240px;margin:0 auto;padding:10px 28px 30px;')}>
        <div style={sx('display:flex;align-items:center;gap:20px;font-size:12px;letter-spacing:.24em;color:#6b6d80;font-weight:600;')}>
          <span style={sx('flex:1;height:1px;background:#e4e4ee;')} />PUBLISH AND CONNECT ACROSS<span style={sx('flex:1;height:1px;background:#e4e4ee;')} />
        </div>
        <div style={sx('display:flex;justify-content:space-around;flex-wrap:wrap;gap:28px;padding:28px 0;')}>
          {(['linkedin', 'facebook', 'instagram', 'whatsapp', 'canva'] as PlatformKey[]).map(k => (
            <div key={k} style={sx('display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;color:#2a2c3d;')}>
              <span style={{ ...sx('width:30px;height:30px;border-radius:9px;color:#fff;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;'), background: P[k].bg }}>{P[k].short}</span>
              {P[k].name}
            </div>
          ))}
        </div>
      </div>

      {/* WORKFLOW */}
      <section id="workflow" style={sx('max-width:1240px;margin:0 auto;padding:80px 28px;')}>
        <div style={sx('text-align:center;max-width:720px;margin:0 auto 56px;')}>
          <div style={sx('font-size:12px;letter-spacing:.24em;color:#5b4cf5;font-weight:700;')}>ONE WORKFLOW</div>
          <h2 style={sx('font-size:clamp(36px,4.6vw,56px);letter-spacing:-.035em;line-height:1.05;margin:16px 0;font-weight:800;')}>From idea to published, without switching tools.</h2>
          <p style={sx('font-size:18px;color:#4d5065;line-height:1.6;margin:0;')}>Six steps, one workspace. Every step keeps its state, so you can jump back at any point.</p>
        </div>
        <div
          style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:48px;align-items:center;')}
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

          <div style={sx('position:relative;height:460px;perspective:1600px;')}>
            <div ref={stackRef} style={sx('position:absolute;inset:0;transform-style:preserve-3d;transform:rotateX(8deg) rotateY(-20deg);')}>
              {STEPS.map(([label], i) => {
                const o = i - step;
                let tf: string; let op: number;
                if (o === 0) { tf = 'translate3d(0,0,0)'; op = 1; }
                else if (o > 0) { tf = `translate3d(${o * 34}px,${-o * 30}px,${-o * 110}px)`; op = Math.max(0, 1 - o * 0.22); }
                else { tf = 'translate3d(-60px,80px,160px) rotateX(-14deg)'; op = 0; }
                return (
                  <div key={label} style={{
                    ...sx('position:absolute;left:8%;top:60px;width:84%;height:330px;background:#fff;border-radius:22px;padding:22px;box-shadow:0 40px 80px -24px rgba(40,30,120,.3),0 0 0 1px rgba(20,20,60,.05);transition:transform .8s cubic-bezier(.2,.8,.2,1),opacity .6s;'),
                    transform: tf, opacity: op, zIndex: 20 - Math.abs(o), pointerEvents: o === 0 ? 'auto' : 'none',
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
                      <div style={sx('display:flex;gap:8px;margin-bottom:14px;font-size:12px;font-weight:700;')}>
                        <span style={sx('padding:6px 11px;border-radius:8px;background:#0a66c2;color:#fff;')}>LinkedIn</span>
                        <span style={sx('padding:6px 11px;border-radius:8px;background:#f1f0f8;')}>Facebook</span>
                        <span style={sx('padding:6px 11px;border-radius:8px;background:#f1f0f8;')}>Instagram</span>
                        <span style={sx('padding:6px 11px;border-radius:8px;background:#f1f0f8;')}>WhatsApp</span>
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
                            <span style={sx('width:18px;height:18px;border-radius:5px;background:linear-gradient(135deg,#5b6cff,#9b5cf6);')} />
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
      </section>

      {/* PLATFORMS */}
      <section id="platforms" style={sx('background:#fff;border-top:1px solid #efeff5;border-bottom:1px solid #efeff5;')}>
        <div style={sx('max-width:1240px;margin:0 auto;padding:96px 28px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr));gap:56px;align-items:center;')}>
          <div>
            <div style={sx('font-size:12px;letter-spacing:.24em;color:#5b4cf5;font-weight:700;')}>PLATFORM-SPECIFIC CONTENT</div>
            <h2 style={sx('font-size:clamp(34px,4.2vw,52px);letter-spacing:-.035em;line-height:1.06;margin:16px 0;font-weight:800;')}>One idea. Four versions that fit where they land.</h2>
            <p style={sx('font-size:18px;color:#4d5065;line-height:1.6;margin:0 0 30px;text-wrap:pretty;')}>SocialPulse writes a separate caption for each platform, with the right tone, length, and format. Preview the real layout before anything goes out.</p>
            <div style={sx('display:flex;gap:10px;flex-wrap:wrap;')}>
              {tabsList.map(k => (
                <button key={k} onClick={() => setTab(k)} style={{
                  ...sx('cursor:pointer;display:flex;align-items:center;gap:9px;padding:10px 16px 10px 10px;border-radius:12px;font-size:15px;font-weight:700;transition:all .2s;border:1px solid;'),
                  borderColor: tab === k ? '#0f1020' : '#e4e4ee', background: tab === k ? '#0f1020' : '#fff', color: tab === k ? '#fff' : '#2a2c3d',
                }}>
                  <span style={{ ...sx('width:26px;height:26px;border-radius:8px;color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;'), background: P[k].bg }}>{P[k].short}</span>
                  {P[k].name}
                </button>
              ))}
            </div>
            <div style={sx('margin-top:22px;font-size:14px;color:#6b6d80;display:flex;align-items:center;gap:8px;')}>
              <span style={sx('width:6px;height:6px;border-radius:50%;background:#5b4cf5;')} />{cur.meta}
            </div>
          </div>
          <div style={sx('position:relative;display:flex;justify-content:center;')}>
            <div style={sx('position:absolute;inset:8% 4%;border-radius:40px;background:linear-gradient(135deg,#ece8ff,#f7eefe);transform:rotate(-4deg);')} />
            <div style={sx('position:relative;width:100%;max-width:440px;background:#fff;border-radius:22px;box-shadow:0 40px 80px -24px rgba(40,30,120,.28),0 0 0 1px rgba(20,20,60,.05);overflow:hidden;')}>
              <div style={sx('display:flex;align-items:center;gap:11px;padding:16px 18px;border-bottom:1px solid #f2f2f7;')}>
                <span style={{ ...sx('width:38px;height:38px;border-radius:50%;color:#fff;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;'), background: cur.bg }}>{cur.short}</span>
                <div style={sx('flex:1;')}><div style={sx('font-size:15px;font-weight:800;')}>{cur.account}</div><div style={sx('font-size:12px;color:#8a8ca0;')}>{cur.sub}</div></div>
                <span style={sx('font-size:12px;font-weight:700;color:#6b6d80;')}>{cur.name}</span>
              </div>
              {!isWA ? (<>
                <div style={sx('padding:14px 18px;font-size:15px;line-height:1.55;color:#2a2c3d;')}>{cur.caption}</div>
                <div style={{ ...sx('height:220px;display:flex;align-items:flex-end;padding:18px;'), background: cur.img }}>
                  <span style={sx('font-size:24px;font-weight:800;letter-spacing:-.02em;color:#1d1f33;')}>{cur.overlay}</span>
                </div>
                <div style={sx('padding:13px 18px;font-size:13px;font-weight:600;color:#6b6d80;')}>{cur.actions}</div>
              </>) : (
                <div style={sx('background:#efeae2;padding:22px 18px;min-height:340px;display:flex;flex-direction:column;align-items:flex-end;gap:8px;')}>
                  <div style={sx('max-width:84%;background:#d9fdd3;border-radius:12px 12px 2px 12px;padding:8px;box-shadow:0 1px 1px rgba(0,0,0,.08);')}>
                    <div style={{ ...sx('height:150px;border-radius:8px;display:flex;align-items:flex-end;padding:12px;'), background: cur.img }}>
                      <span style={sx('font-size:17px;font-weight:800;color:#1d1f33;')}>{cur.overlay}</span>
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
                <span style={{ ...sx('width:40px;height:40px;border-radius:50%;color:#fff;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;'), background: cur.bg }}>{cur.short}</span>
                <div><div style={sx('font-size:15px;font-weight:800;')}>{cur.account}</div><div style={sx('font-size:12px;color:#8a8ca0;')}>{cur.sub}</div></div>
              </div>
              <div style={sx('padding:0 16px 14px;font-size:15px;line-height:1.55;')}>{cur.caption}</div>
              <div style={{ ...sx('height:260px;display:flex;align-items:flex-end;padding:18px;'), background: cur.img }}>
                <span style={sx('font-size:26px;font-weight:800;color:#1d1f33;')}>{cur.overlay}</span>
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
      <section id="scheduler" style={sx('max-width:1240px;margin:0 auto;padding:96px 28px;')}>
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
                    <span style={{ ...sx('width:26px;height:26px;border-radius:8px;color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;'), background: P[p.p].bg }}>{P[p.p].short}</span>
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
                    <span style={{ ...sx('width:26px;height:26px;border-radius:8px;color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;'), background: P[p.p].bg }}>{P[p.p].short}</span>
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
                    <span style={{ ...sx('width:26px;height:26px;border-radius:8px;color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;'), background: P[p.p].bg }}>{P[p.p].short}</span>
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
      <section id="features" style={sx('max-width:1240px;margin:0 auto;padding:40px 28px 96px;')}>
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
              {assets.map(([tag, img], i) => (
                <div key={i} style={{ ...sx('position:relative;aspect-ratio:1;border-radius:14px;'), background: img }}>
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
      <section id="start" style={sx('max-width:1240px;margin:0 auto;padding:0 28px 80px;')}>
        <div style={sx('position:relative;overflow:hidden;border-radius:32px;background:radial-gradient(700px 400px at 80% 50%,#3b2f9e 0%,rgba(59,47,158,0) 70%),#0f1020;color:#fff;padding:72px 56px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr));gap:40px;align-items:center;')}>
          <div style={sx('position:relative;z-index:2;')}>
            <h2 style={sx('font-size:clamp(40px,5vw,64px);letter-spacing:-.04em;line-height:1.02;margin:0 0 20px;font-weight:800;')}>
              Create. Brand.<br />Schedule.{' '}
              <span style={sx('background:linear-gradient(90deg,#7c9bff,#b18cff,#e08cf5);-webkit-background-clip:text;background-clip:text;color:transparent;')}>Grow.</span>
            </h2>
            <p style={sx('font-size:18px;line-height:1.6;color:#c9cadb;margin:0 0 32px;max-width:460px;')}>Bring your ideas, media, brand, and schedule into one workspace.</p>
            <div style={sx('display:flex;gap:14px;flex-wrap:wrap;')}>
              <Hover tag={Link} href="/login-signup?mode=signup" base="color:#0f1020;background:#fff;padding:17px 28px;border-radius:14px;font-weight:700;font-size:16px;display:inline-block;" hover="transform:translateY(-2px)">Get Started Free →</Hover>
              <Hover tag="a" href="#workflow" base="color:#fff;padding:17px 24px;border-radius:14px;font-weight:600;font-size:16px;border:1px solid rgba(255,255,255,.22);display:inline-block;" hover="border:1px solid rgba(255,255,255,.5)">See the workflow</Hover>
            </div>
          </div>
          <div style={sx('position:relative;height:340px;perspective:1100px;display:flex;align-items:center;justify-content:center;')}>
            <div style={sx('position:absolute;width:96px;height:96px;border-radius:28px;background:linear-gradient(135deg,#5b6cff,#9b5cf6);box-shadow:0 0 80px rgba(139,92,246,.6);display:flex;align-items:center;justify-content:center;z-index:1;')}>
              <PulseIcon size={50} strokeWidth={2.2} />
            </div>
            <div ref={ringRef} style={sx('position:absolute;width:64px;height:64px;transform-style:preserve-3d;transform:rotateX(-14deg);')}>
              {ringTiles.map((t, i) => (
                <div key={i} style={{ ...sx('position:absolute;inset:0;border-radius:18px;color:#fff;font-weight:800;font-size:18px;display:flex;align-items:center;justify-content:center;box-shadow:0 14px 30px rgba(0,0,0,.35);'), background: t.bg, transform: t.tf }}>{t.short}</div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer style={sx('max-width:1240px;margin:0 auto;padding:28px 28px 48px;display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap;border-top:1px solid #e7e7f1;font-size:14px;color:#6b6d80;')}>
        <div style={sx('display:flex;align-items:center;gap:10px;font-weight:800;color:#0f1020;font-size:16px;')}>
          <span style={sx('width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,#5b6cff,#9b5cf6);')} />SocialPulse
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
