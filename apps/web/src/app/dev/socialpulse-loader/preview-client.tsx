'use client';

import { useState } from 'react';
import SocialPulseAILoader from '@/app/_shell/socialpulse-ai-loader';

// DEVELOPMENT-ONLY visual preview for SocialPulseAILoader. Pure local state —
// no fetch, no AI calls, no navigation. Success/failure are simulated with
// local placeholders only.
type Phase = 'loading' | 'success' | 'error';
type Mode = 'image' | 'carousel';

const btn = (active: boolean): React.CSSProperties => ({
  padding: '10px 18px', borderRadius: 999, fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
  border: active ? 'none' : '1px solid #3a3a5c', cursor: 'pointer',
  background: active ? 'linear-gradient(135deg,#7C3AED,#8B5CF6)' : 'rgba(255,255,255,0.06)',
  color: '#fff', transition: 'all 0.18s',
});

export default function LoaderPreviewClient() {
  const [mode, setMode] = useState<Mode>('image');
  const [phase, setPhase] = useState<Phase>('loading');
  const [compact, setCompact] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const reset = () => { setPhase('loading'); setLeaving(false); };
  const switchMode = (m: Mode) => { setMode(m); reset(); };
  const simulateSuccess = () => {
    setLeaving(true);
    window.setTimeout(() => { setPhase('success'); setLeaving(false); }, 320);
  };
  const simulateFailure = () => { setPhase('error'); setLeaving(false); };

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(ellipse 70% 55% at 50% 34%, #141432 0%, #08081a 62%, #050510 100%)', color: '#fff', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px 60px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', color: '#8f8fb0' }}>DEV PREVIEW — NOT SHIPPED</div>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '10px 0 28px', letterSpacing: '-0.01em' }}>SocialPulse AI Loader</h1>

      <div style={{ minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: 560 }}>
        {phase === 'loading' && (
          <div style={{ opacity: leaving ? 0 : 1, transform: leaving ? 'scale(0.96)' : 'scale(1)', transition: 'opacity 320ms ease, transform 320ms ease' }}>
            <SocialPulseAILoader mode={mode} compact={compact} />
          </div>
        )}
        {phase === 'success' && (
          <div style={{ textAlign: 'center', animation: 'spPreviewIn 320ms ease' }} role="status">
            <style>{`@keyframes spPreviewIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }`}</style>
            <div style={{ width: 220, height: 220, maxWidth: '70vw', borderRadius: 24, margin: '0 auto',
              background: 'linear-gradient(135deg,#1c1c3a,#2b1a5e 55%,#3b1f6e)',
              border: '1px solid rgba(167,139,250,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 15, fontWeight: 700, color: '#cfc3ff' }}>
              {mode === 'image' ? 'Generated image placeholder' : 'Generated slides placeholder'}
            </div>
            <div style={{ marginTop: 14, fontSize: 14, fontWeight: 700, color: '#7df0b2' }}>✓ Preview ready (simulated)</div>
          </div>
        )}
        {phase === 'error' && (
          <div style={{ textAlign: 'center' }} role="alert">
            <div style={{ fontSize: 17, fontWeight: 800 }}>Generation failed</div>
            <div style={{ fontSize: 13, color: '#8f8fb0', marginTop: 6 }}>Please try again.</div>
            <button onClick={reset} style={{ ...btn(true), marginTop: 16 }}>Retry</button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 26, maxWidth: 560 }}>
        <button onClick={() => switchMode('image')} style={btn(mode === 'image' && phase !== 'error')}>Image Mode</button>
        <button onClick={() => switchMode('carousel')} style={btn(mode === 'carousel' && phase !== 'error')}>Carousel Mode</button>
        <button onClick={simulateSuccess} style={btn(false)}>Simulate Success</button>
        <button onClick={simulateFailure} style={btn(false)}>Simulate Failure</button>
        <button onClick={reset} style={btn(false)}>Reset</button>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 13, color: '#b9b9d6', cursor: 'pointer' }}>
        <input type="checkbox" checked={compact} onChange={e => setCompact(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#7c3aed' }} />
        Compact mode (48–64px)
      </label>
      <div style={{ marginTop: 22, fontSize: 11.5, color: '#5c5c80', textAlign: 'center', maxWidth: 520, lineHeight: 1.6 }}>
        Local visual preview only — no AI calls, no progress bars, no percentages. Not linked from any menu or sidebar.
      </div>
    </div>
  );
}
