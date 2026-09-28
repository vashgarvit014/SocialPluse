'use client';

import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// AiImageLoader — gated "Thinking" particle field for AI image generation.
//
// Visual: near-black (#05070B) with hundreds of glowing blue dots on a
// regular grid, displaced by sine waves + sweeping bright band + radial
// center glow. Depth-based size, edge fade, halo+core rendering.
// No per-frame React state — progress text updates only when integer changes.
//
// Gate rule: image appears ONLY after progress hits 100%:
//   0→60 quickly, 60→90 gradually, 90→97 slowly, hold 99 until ready,
//   then 99→100 sprint + brighten + 450ms fade + 0.97→1.00 scale.
// ---------------------------------------------------------------------------

export type AiGateStatus = 'working' | 'ready' | 'error';

interface AiImageLoaderProps {
  status: AiGateStatus;
  aspect?: string;
  overlay?: boolean;
  finishing?: boolean;
  durationMs?: number;
  onReveal?: () => void;
  onRetry?: () => void;
  canRetry?: boolean;
}

const DEEP: [number, number, number] = [37, 99, 235];
const BRIGHT: [number, number, number] = [59, 130, 246];
const CYAN: [number, number, number] = [96, 165, 250];
const DEFAULT_DURATION = 14000;

interface Dot {
  bx: number;
  by: number;
  seed: number;
  depth: number;
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export default function AiImageLoader({
  status, aspect, overlay, finishing, durationMs, onReveal, onRetry, canRetry,
}: AiImageLoaderProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const statusRef = useRef<AiGateStatus>(status);
  statusRef.current = status;
  const finishingRef = useRef(!!finishing);
  finishingRef.current = !!finishing;
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [faded, setFaded] = useState(false);
  useEffect(() => {
    if (!finishing) {
      setFaded(false);
      return;
    }
    const t = setTimeout(() => setFaded(true), 200);
    return () => clearTimeout(t);
  }, [finishing]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const duration = Math.max(3000, durationMs || DEFAULT_DURATION);
    const startOffset = !finishing && statusRef.current === 'ready' ? duration * 0.7 : 0;
    const t0 = performance.now() - startOffset;

    let dots: Dot[] = [];
    let w = 0;
    let h = 0;
    let raf = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    let last = performance.now();
    let revealed = false;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const build = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      w = Math.max(1, Math.floor(rect.width));
      h = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      let spacing = w < 480 ? 17 : w < 900 ? 15 : 14;
      let cols = Math.max(8, Math.floor(w / spacing));
      let rows = Math.max(8, Math.floor(h / spacing));
      while (cols * rows > 1500) {
        spacing += 1;
        cols = Math.max(8, Math.floor(w / spacing));
        rows = Math.max(8, Math.floor(h / spacing));
      }
      const ox = (w - (cols - 1) * spacing) / 2;
      const oy = (h - (rows - 1) * spacing) / 2;
      dots = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          dots.push({ bx: ox + c * spacing, by: oy + r * spacing, seed: Math.random() * Math.PI * 2, depth: Math.random() });
        }
      }
      if (reduced) drawStatic();
    };

    const advance = (dt: number, now: number) => {
      const st = statusRef.current;
      if (finishingRef.current) {
        const next = progressRef.current + (100 - progressRef.current) * Math.min(1, dt * 9);
        const done = 100 - next < 0.5 ? 100 : next;
        if (Math.floor(done) !== Math.floor(progressRef.current)) setProgress(Math.floor(done));
        progressRef.current = done;
        return;
      }
      if (st === 'error') return;
      const cur = progressRef.current;
      const e = Math.min(1, Math.max(0, (now - t0) / duration));
      const target = 97 * (1 - Math.pow(1 - e, 3));
      let next: number;
      if (st === 'ready' && e >= 1) {
        next = cur + (100 - cur) * Math.min(1, dt * 8);
        if (100 - next < 0.5) {
          next = 100;
          if (!revealed) {
            revealed = true;
            onRevealRef.current?.();
          }
        }
      } else {
        next = Math.max(cur, Math.min(target, 97));
        next = Math.min(next, cur + Math.max(2, dt * 40));
      }
      if (Math.floor(next) !== Math.floor(cur)) setProgress(Math.floor(next));
      progressRef.current = next;
    };

    const draw = (t: number, boost: number, timeScale: number, dim: number) => {
      ctx.fillStyle = '#05070B';
      ctx.fillRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const maxD = Math.hypot(cx, cy) || 1;
      const band = ((t * 0.09) % 1.6) - 0.3;
      const breathe = 1 + 0.05 * Math.sin(t * 0.5);
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        const nx = d.bx / w;
        const px = cx + (d.bx - cx) * breathe;
        const py = cy + (d.by - cy) * breathe;
        const dx = Math.sin(d.by * 0.02 + t * 0.7 * timeScale + d.seed) * 10 + Math.sin((d.bx + d.by) * 0.008 - t * 0.4 * timeScale) * 8;
        const dy = Math.cos(d.bx * 0.018 - t * 0.6 * timeScale + d.seed) * 10 + Math.cos(d.by * 0.01 + t * 0.5 * timeScale) * 6;
        const x = px + dx;
        const y = py + dy;
        const dc = Math.hypot(nx - 0.5, (d.by / h) - 0.5);
        const center = Math.exp(-(dc * dc) / 0.16);
        const bandD = nx - band;
        const sweep = Math.exp(-(bandD * bandD) / 0.06);
        let intensity = (0.22 + 0.5 * center + 0.55 * sweep + 0.12 * Math.sin(t * 2 * timeScale + d.seed * 3)) * dim + boost;
        if (intensity < 0.03) continue;
        if (intensity > 1) intensity = 1;
        const edge = Math.max(0, 1 - Math.hypot(x - cx, y - cy) / (maxD * 1.02));
        const alpha = intensity * (0.25 + 0.75 * edge);
        if (alpha < 0.02) continue;
        let col = mix(DEEP, BRIGHT, Math.min(1, intensity * 1.2));
        if (intensity > 0.72) col = mix(col, CYAN, (intensity - 0.72) / 0.28);
        const r = 0.8 + 1.9 * intensity * (0.6 + 0.4 * d.depth);
        const [cr, cg, cb] = col.map(v => Math.round(v));
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${(alpha * 0.22).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, r * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const drawStatic = () => {
      ctx.fillStyle = '#05070B';
      ctx.fillRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const maxD = Math.hypot(cx, cy) || 1;
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        const dc = Math.hypot(d.bx / w - 0.5, d.by / h - 0.5);
        const intensity = Math.min(1, 0.25 + 0.55 * Math.exp(-(dc * dc) / 0.16));
        const edge = Math.max(0, 1 - Math.hypot(d.bx - cx, d.by - cy) / (maxD * 1.02));
        const alpha = intensity * (0.25 + 0.75 * edge);
        if (alpha < 0.03) continue;
        const col = mix(DEEP, BRIGHT, intensity);
        const [cr, cg, cb] = col.map(v => Math.round(v));
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(d.bx, d.by, 0.9 + 1.6 * intensity, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    if (reduced) {
      build();
      timer = setInterval(() => advance(0.4, performance.now()), 400);
    } else {
      build();
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        if (document.hidden) {
          last = now;
          return;
        }
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const t = (now - t0) / 1000;
        advance(dt, now);
        const st = statusRef.current;
        if (finishingRef.current) draw(t, 0.45, 1, 1);
        else if (st === 'error') draw(t, 0, 0.15, 0.4);
        else if (st === 'ready' && progressRef.current >= 97) draw(t, 0.12 + 0.06 * Math.sin(t * 2.5), 1, 1);
        else draw(t, 0, 1, 1);
      };
      raf = requestAnimationFrame(frame);
    }

    const ro = new ResizeObserver(() => build());
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      if (timer) clearInterval(timer);
      ro.disconnect();
    };
  }, []);

  const aspectStyle = !overlay && aspect && aspect.includes(':') ? aspect.replace(':', ' / ') : undefined;
  const label = status === 'error' ? 'Generation failed' : 'Thinking';

  return (
    <div
      ref={wrapRef}
      className={reducedMotion ? 'sp-ai-pulse' : undefined}
      style={{
        position: overlay ? 'absolute' : 'relative',
        inset: overlay ? 0 : undefined,
        height: overlay ? '100%' : undefined,
        aspectRatio: overlay ? undefined : aspectStyle || '16 / 9',
        minHeight: overlay ? undefined : 260,
        backgroundColor: '#05070B',
        borderRadius: overlay ? 0 : 16,
        overflow: 'hidden',
        opacity: finishing && faded ? 0 : 1,
        transition: 'opacity 450ms ease',
      }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
      <div style={{ position: 'absolute', top: 12, left: 14, fontSize: 13, fontWeight: 600, color: status === 'error' ? '#FCA5A5' : 'rgba(255,255,255,0.82)', letterSpacing: '0.01em' }}>
        {label}
      </div>
      {status !== 'error' && (
        <div style={{ position: 'absolute', right: 12, bottom: 12, fontSize: 12, fontWeight: 800, color: '#fff', backgroundColor: 'rgba(5,7,11,0.72)', border: '1px solid rgba(255,255,255,0.14)', padding: '5px 13px', borderRadius: 999, fontVariantNumeric: 'tabular-nums' }}>
          {progress}%
        </div>
      )}
      {status === 'error' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <button
            onClick={onRetry}
            disabled={!canRetry}
            title={canRetry ? 'Try generating again with the same prompt' : 'Add content first'}
            style={{
              padding: '11px 26px', borderRadius: 11, fontSize: 13, fontWeight: 800, border: 'none',
              background: canRetry ? 'linear-gradient(135deg,#3B82F6,#2563EB)' : 'rgba(255,255,255,0.12)',
              color: '#fff', cursor: canRetry ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
              boxShadow: canRetry ? '0 6px 20px rgba(37,99,235,0.45)' : 'none',
            }}
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
