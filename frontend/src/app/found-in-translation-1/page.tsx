'use client';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

// ── Found in Translation -1: Superstudio / Continuous Monument ──
// Inspired by Superstudio's 1969 Continuous Monument: a white megastructure
// with a grid, superimposed over any landscape. Architecture as protocol.
// The monument doesn't end. The grid continues. Intent travels the surface.

const KF = `
  @keyframes ticker {
    from { transform: translateX(0); }
    to   { transform: translateX(-50%); }
  }
  @keyframes blinkHard {
    0%,49%  { opacity: 1; }
    50%,100% { opacity: 0; }
  }
  @keyframes marchRight {
    from { background-position: 0 0; }
    to   { background-position: 60px 0; }
  }
`;

const SANS = "'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif";

function useScrollProgress() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const h = () => {
      const d = document.documentElement;
      setP(d.scrollTop / (d.scrollHeight - d.clientHeight) || 0);
    };
    addEventListener('scroll', h, { passive: true });
    return () => removeEventListener('scroll', h);
  }, []);
  return p;
}

function useFadeIn(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!ref.current) return;
    const els = ref.current.querySelectorAll<HTMLElement>('[data-fade]');
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const el = e.target as HTMLElement;
          el.style.transitionDelay = `${el.dataset.delay ?? 0}ms`;
          el.style.opacity = '1';
          el.style.transform = 'none';
        }),
      { threshold: 0.05 },
    );
    els.forEach((el) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(24px)';
      el.style.transition = 'opacity .6s ease, transform .6s ease';
      io.observe(el);
    });
    return () => io.disconnect();
  }, [ref]);
}

// ── PROTOCOL CORRIDOR CANVAS ────────────────────────────────────────
// Original artwork inspired by Superstudio's Continuous Monument.
// Two massive gridded slab-walls converge to a vanishing point, framing
// a corridor that represents the protocol connecting human intent.
// The "ground" below is a network landscape of nodes and connections.
function ProtocolCorridorCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d')!;
    let raf: number;
    let tick = 0;

    const resize = () => { cv.width = innerWidth; cv.height = innerHeight; };
    resize(); addEventListener('resize', resize);

    // Bilinear quad grid: clips to a quadrilateral, then draws N×M perspective-correct lines
    const quadGrid = (
      bl: [number,number], br: [number,number],
      tr: [number,number], tl: [number,number],
      nx: number, ny: number, col: string, lw: number
    ) => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(bl[0],bl[1]); ctx.lineTo(br[0],br[1]);
      ctx.lineTo(tr[0],tr[1]); ctx.lineTo(tl[0],tl[1]);
      ctx.closePath(); ctx.clip();
      ctx.strokeStyle = col; ctx.lineWidth = lw;
      for (let i = 0; i <= nx; i++) {
        const s = i/nx;
        ctx.beginPath();
        ctx.moveTo(bl[0]+(br[0]-bl[0])*s, bl[1]+(br[1]-bl[1])*s);
        ctx.lineTo(tl[0]+(tr[0]-tl[0])*s, tl[1]+(tr[1]-tl[1])*s);
        ctx.stroke();
      }
      for (let i = 0; i <= ny; i++) {
        const s = i/ny;
        ctx.beginPath();
        ctx.moveTo(bl[0]+(tl[0]-bl[0])*s, bl[1]+(tl[1]-bl[1])*s);
        ctx.lineTo(br[0]+(tr[0]-br[0])*s, br[1]+(tr[1]-br[1])*s);
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawFig = (x: number, y: number, h: number) => {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = Math.max(0.7, h * 0.05);
      ctx.beginPath(); ctx.arc(x, y-h+h*0.1, h*0.09, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x, y-h+h*0.2); ctx.lineTo(x, y-h*0.38); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x-h*0.11, y-h*0.68); ctx.lineTo(x+h*0.11, y-h*0.68); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y-h*0.38); ctx.lineTo(x-h*0.08, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y-h*0.38); ctx.lineTo(x+h*0.08, y); ctx.stroke();
    };

    const draw = () => {
      const W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);

      const cx = W * 0.5;
      const vy = H * 0.44;  // horizon
      const sT  = H * 0.69; // top of slab at near edge

      // ── SKY (atmospheric grey, like overcast photomontage) ──
      const skyG = ctx.createLinearGradient(0, 0, 0, vy);
      skyG.addColorStop(0,   '#7c7a78');
      skyG.addColorStop(0.5, '#a8a6a2');
      skyG.addColorStop(1,   '#cdcbc7');
      ctx.fillStyle = skyG; ctx.fillRect(0, 0, W, vy);

      // ── GROUND PLANE (network landscape) ──
      const gG = ctx.createLinearGradient(0, vy, 0, H);
      gG.addColorStop(0, '#c2c0bc');
      gG.addColorStop(1, '#686462');
      ctx.fillStyle = gG; ctx.fillRect(0, vy, W, H-vy);

      // Perspective ground grid (advancing with tick)
      ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 0.5;
      const rawT = ((tick * 0.006) % 1);
      for (let i = 0; i <= 22; i++) {
        const bx = W * (-0.3 + i * 1.6/22);
        ctx.beginPath(); ctx.moveTo(cx, vy); ctx.lineTo(bx, H); ctx.stroke();
      }
      for (let i = 0; i < 14; i++) {
        const p = Math.pow(((i/14) + rawT) % 1, 2.0);
        const y = vy + (H-vy)*p;
        if (y > vy && y < H) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
      }

      // Network node dots in ground plane
      for (let row = 1; row < 10; row++) {
        for (let col = 0; col < 22; col++) {
          const p = Math.pow(row/10, 1.8);
          const y = vy + (H-vy)*p + 4;
          const x = cx + (col/22 - 0.5) * W * (0.28 + p*0.9);
          if (x < 2 || x > W-2 || y > H-4) continue;
          const r = 0.8 + p*1.6;
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2);
          ctx.fillStyle = `rgba(0,0,0,${0.1 + p*0.18})`; ctx.fill();
        }
      }

      // ── LEFT SLAB ──
      // Top surface (sky-coloured, the horizon reflected)
      const lBl: [number,number] = [-W*0.08, H];
      const lBr: [number,number] = [W*0.38, H];
      const lTr: [number,number] = [cx, vy];
      const lTl: [number,number] = [-W*0.42, vy*0.28];

      ctx.beginPath();
      ctx.moveTo(lTl[0],lTl[1]); ctx.lineTo(lTr[0],lTr[1]);
      ctx.lineTo(W*0.38, sT); ctx.lineTo(-W*0.08, sT);
      ctx.closePath();
      const lTopG = ctx.createLinearGradient(cx, vy, W*0.38, sT);
      lTopG.addColorStop(0,'#b6cada'); lTopG.addColorStop(1,'#d0e0ec');
      ctx.fillStyle = lTopG; ctx.fill();
      quadGrid(
        [-W*0.08, sT], [W*0.38, sT],
        lTr, lTl,
        24, 20, 'rgba(0,0,0,0.07)', 0.5
      );

      // Inner face (dark — the corridor wall)
      ctx.beginPath();
      ctx.moveTo(W*0.38, H); ctx.lineTo(W*0.38, sT); ctx.lineTo(cx, vy);
      ctx.closePath();
      const lFaceG = ctx.createLinearGradient(W*0.38, sT, cx, vy);
      lFaceG.addColorStop(0,'#2e3e4a'); lFaceG.addColorStop(1,'#6a7c88');
      ctx.fillStyle = lFaceG; ctx.fill();
      quadGrid(
        [W*0.38, H], [cx, vy],
        [cx, vy], [W*0.38, sT],
        16, 14, 'rgba(255,255,255,0.055)', 0.5
      );

      // ── RIGHT SLAB ──
      const rBl: [number,number] = [W*0.62, H];
      const rBr: [number,number] = [W*1.08, H];
      const rTr: [number,number] = [W*1.42, vy*0.28];
      const rTl: [number,number] = [cx, vy];

      ctx.beginPath();
      ctx.moveTo(rTl[0],rTl[1]); ctx.lineTo(rTr[0],rTr[1]);
      ctx.lineTo(W*1.08, sT); ctx.lineTo(W*0.62, sT);
      ctx.closePath();
      const rTopG = ctx.createLinearGradient(cx, vy, W*0.62, sT);
      rTopG.addColorStop(0,'#b6cada'); rTopG.addColorStop(1,'#ccdde9');
      ctx.fillStyle = rTopG; ctx.fill();
      quadGrid(
        [W*0.62, sT], [W*1.08, sT],
        rTr, rTl,
        24, 20, 'rgba(0,0,0,0.07)', 0.5
      );

      ctx.beginPath();
      ctx.moveTo(W*0.62, H); ctx.lineTo(W*0.62, sT); ctx.lineTo(cx, vy);
      ctx.closePath();
      const rFaceG = ctx.createLinearGradient(W*0.62, sT, cx, vy);
      rFaceG.addColorStop(0,'#2e3e4a'); rFaceG.addColorStop(1,'#6a7c88');
      ctx.fillStyle = rFaceG; ctx.fill();
      quadGrid(
        [W*0.62, H], [cx, vy],
        [cx, vy], [W*0.62, sT],
        16, 14, 'rgba(255,255,255,0.055)', 0.5
      );

      // ── SCALE FIGURES at slab base ──
      const fH = H * 0.055;
      drawFig(W*0.38 - fH*0.25, H, fH);
      drawFig(W*0.38 - fH*0.8,  H, fH * 0.82);
      drawFig(W*0.62 + fH*0.25, H, fH);
      drawFig(W*0.62 + fH*0.8,  H, fH * 0.82);

      // ── HORIZON LABEL ──
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = `${Math.max(8, W*0.006)}px "IBM Plex Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('PROTOCOL · INDEX NETWORK', cx, vy - 8);

      tick++;
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, zIndex: 0 }} />;
}

// ── THE MONUMENT CANVAS (original, kept as fallback) ─────────────────
function MonumentCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d')!;
    let raf: number;
    let offset = 0;

    const resize = () => { cv.width = innerWidth; cv.height = innerHeight; };
    resize(); addEventListener('resize', resize);

    const drawFigure = (x: number, baseY: number, h: number) => {
      ctx.fillStyle = '#000';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = Math.max(0.8, h * 0.06);
      // head
      ctx.beginPath();
      ctx.arc(x, baseY - h + h * 0.11, h * 0.09, 0, Math.PI * 2);
      ctx.fill();
      // body
      ctx.beginPath();
      ctx.moveTo(x, baseY - h + h * 0.2);
      ctx.lineTo(x, baseY - h * 0.38);
      ctx.stroke();
      // arms
      ctx.beginPath();
      ctx.moveTo(x - h * 0.12, baseY - h * 0.68);
      ctx.lineTo(x + h * 0.12, baseY - h * 0.68);
      ctx.stroke();
      // legs
      ctx.beginPath();
      ctx.moveTo(x, baseY - h * 0.38);
      ctx.lineTo(x - h * 0.09, baseY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, baseY - h * 0.38);
      ctx.lineTo(x + h * 0.09, baseY);
      ctx.stroke();
    };

    const draw = () => {
      const W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);

      const horizY = H * 0.46;
      const vx = W * 0.5;

      // ── MONUMENT FACE (top → horizon) ──
      // Fine grid, clipped to the monument rectangle
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, horizY);
      ctx.clip();
      const gSz = Math.max(40, W / 22);
      const mOff = (offset * 0.08) % gSz; // very slow horizontal drift
      ctx.strokeStyle = 'rgba(0,0,0,0.11)';
      ctx.lineWidth = 0.6;
      // vertical grid lines
      for (let x = -gSz + mOff; x < W + gSz; x += gSz) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, horizY); ctx.stroke();
      }
      // horizontal grid lines
      for (let y = gSz * 0.5; y < horizY; y += gSz) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.restore();

      // Monument bottom edge = horizon line
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, horizY); ctx.lineTo(W, horizY); ctx.stroke();

      // ── GROUND PLANE (horizon → bottom) ──
      // Perspective rays from vanishing point
      const numRays = 32;
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 0.7;
      for (let i = 0; i <= numRays; i++) {
        const t = i / numRays;
        const bx = -W * 0.3 + t * W * 1.6; // spread past canvas edges
        ctx.beginPath(); ctx.moveTo(vx, horizY); ctx.lineTo(bx, H); ctx.stroke();
      }

      // Perspective horizontal lines (advance with offset)
      const numH = 20;
      ctx.strokeStyle = 'rgba(0,0,0,0.11)';
      ctx.lineWidth = 0.5;
      const rawT = (offset * 0.006) % 1;
      for (let i = 0; i < numH; i++) {
        const t = Math.pow(((i / numH) + rawT) % 1, 2.2);
        const y = horizY + (H - horizY) * t;
        if (y > horizY && y < H) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
      }

      // ── SCALE FIGURES (at monument base / horizon) ──
      const figH = H * 0.055;
      const figs = [0.14, 0.32, 0.5, 0.68, 0.86];
      figs.forEach((fx) => {
        drawFigure(W * fx, horizY, figH);
      });

      // ── ARCHITECTURAL LABELS ──
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.font = `${Math.max(9, W * 0.007)}px "IBM Plex Mono", monospace`;
      ctx.letterSpacing = '0.15em';
      ctx.textAlign = 'left';
      // bottom-left coordinate
      ctx.fillText(`N 43°41′ E 11°15′  ·  EL. 0.00 m`, 16, H - 14);
      // bottom-right
      ctx.textAlign = 'right';
      ctx.fillText(`CONTINUOUS MONUMENT · INDEX NETWORK PROTOCOL`, W - 16, H - 14);
      ctx.letterSpacing = '0em';

      // monument label top-right corner
      ctx.textAlign = 'right';
      ctx.font = `${Math.max(9, W * 0.0065)}px "IBM Plex Mono", monospace`;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillText('ELEVATION 1:5000', W - 16, 20);

      offset += 0.35;
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, zIndex: 0 }} />;
}

// ── ARCH CALLOUT ────────────────────────────────────────────────
function ArchCallout({ children }: { children: React.ReactNode }) {
  return (
    <div data-fade style={{ margin: '4rem 0', border: '3px solid #000', padding: '3rem 3.5rem', background: '#000', color: '#fff', position: 'relative' }}>
      <p style={{ fontFamily: SANS, fontWeight: 900, fontSize: 'clamp(1.4rem,3.5vw,2.6rem)', lineHeight: 1.1, letterSpacing: '-0.01em', textTransform: 'uppercase', margin: 0 }}>{children}</p>
      {[{ top: 8, left: 8 }, { top: 8, right: 8 }, { bottom: 8, left: 8 }, { bottom: 8, right: 8 }].map((pos, i) => (
        <div key={i} style={{ position: 'absolute', width: 12, height: 12, border: '2px solid #fff', ...pos }} />
      ))}
    </div>
  );
}

// ── FIG 01: THE CONVERSATION ────────────────────────────────────
// Architectural elevation of two humans with intent lattice between them
function ConversationFig() {
  return (
    <figure data-fade style={{ margin: '3rem 0', border: '3px solid #000', position: 'relative', background: '#fff', overflow: 'hidden' }}>
      <svg viewBox="0 0 960 340" width="100%" style={{ display: 'block' }} aria-label="Fig. 01 — Two humans. Intent: latent.">
        {/* Registration marks */}
        {[{ x: 8, y: 8, r: true, b: false }, { x: 952, y: 8, r: false, b: false }, { x: 8, y: 332, r: true, b: true }, { x: 952, y: 332, r: false, b: true }].map(({ x, y, r, b }, i) => (
          <g key={i}>
            <line x1={x} y1={b ? y - 12 : y + 12} x2={x} y2={b ? y - 22 : y + 22} stroke="black" strokeWidth="1" opacity="0.4" />
            <line x1={r ? x + 12 : x - 12} y1={y} x2={r ? x + 22 : x - 22} y2={y} stroke="black" strokeWidth="1" opacity="0.4" />
          </g>
        ))}

        {/* FIGURE A — left */}
        {/* head */}
        <circle cx="165" cy="90" r="26" fill="white" stroke="black" strokeWidth="1.5" />
        {/* neck */}
        <line x1="165" y1="116" x2="165" y2="130" stroke="black" strokeWidth="1.5" />
        {/* body */}
        <rect x="148" y="130" width="34" height="62" fill="white" stroke="black" strokeWidth="1.5" />
        {/* right arm (reaching toward center) */}
        <line x1="182" y1="142" x2="236" y2="158" stroke="black" strokeWidth="1.5" />
        {/* left arm */}
        <line x1="148" y1="142" x2="118" y2="168" stroke="black" strokeWidth="1.5" />
        {/* legs */}
        <line x1="158" y1="192" x2="144" y2="248" stroke="black" strokeWidth="1.5" />
        <line x1="172" y1="192" x2="186" y2="248" stroke="black" strokeWidth="1.5" />
        {/* label */}
        <text x="165" y="272" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="11" letterSpacing="2" fill="black">HUMAN A</text>

        {/* FIGURE B — right */}
        <circle cx="795" cy="90" r="26" fill="white" stroke="black" strokeWidth="1.5" />
        <line x1="795" y1="116" x2="795" y2="130" stroke="black" strokeWidth="1.5" />
        <rect x="778" y="130" width="34" height="62" fill="white" stroke="black" strokeWidth="1.5" />
        {/* left arm reaching toward center */}
        <line x1="778" y1="142" x2="724" y2="158" stroke="black" strokeWidth="1.5" />
        {/* right arm */}
        <line x1="812" y1="142" x2="842" y2="168" stroke="black" strokeWidth="1.5" />
        <line x1="788" y1="192" x2="774" y2="248" stroke="black" strokeWidth="1.5" />
        <line x1="802" y1="192" x2="816" y2="248" stroke="black" strokeWidth="1.5" />
        <text x="795" y="272" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="11" letterSpacing="2" fill="black">HUMAN B</text>

        {/* INTENT LATTICE — center */}
        {/* The "intent": a floating grid structure between the two figures */}
        <rect x="350" y="58" width="260" height="162" fill="white" stroke="black" strokeWidth="2" />
        {/* grid lines — vertical */}
        {[26, 52, 78, 104, 130, 156, 182, 208, 234].map((dx) => (
          <line key={dx} x1={350 + dx} y1="58" x2={350 + dx} y2="220" stroke="black" strokeWidth="0.5" opacity="0.4" />
        ))}
        {/* grid lines — horizontal */}
        {[18, 36, 54, 72, 90, 108, 126, 144].map((dy) => (
          <line key={dy} x1="350" y1={58 + dy} x2="610" y2={58 + dy} stroke="black" strokeWidth="0.5" opacity="0.4" />
        ))}
        {/* center crosshair */}
        <line x1="480" y1="58" x2="480" y2="220" stroke="black" strokeWidth="1" opacity="0.2" />
        <line x1="350" y1="139" x2="610" y2="139" stroke="black" strokeWidth="1" opacity="0.2" />
        {/* corner registration marks on intent box */}
        {[[350, 58], [610, 58], [350, 220], [610, 220]].map(([px, py], i) => (
          <g key={i}>
            <line x1={px - 8} y1={py} x2={px - 14} y2={py} stroke="black" strokeWidth="1.5" />
            <line x1={px} y1={py - 8} x2={px} y2={py - 14} stroke="black" strokeWidth="1.5" />
          </g>
        ))}
        <text x="480" y="244" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="9" letterSpacing="2" fill="black" opacity="0.6">INTENT: UNEXPRESSED</text>

        {/* Speech / intent lines */}
        <line x1="191" y1="100" x2="350" y2="130" stroke="black" strokeWidth="0.8" strokeDasharray="6,5" opacity="0.5" />
        <line x1="769" y1="100" x2="610" y2="130" stroke="black" strokeWidth="0.8" strokeDasharray="6,5" opacity="0.5" />

        {/* Dimension line at bottom */}
        <line x1="165" y1="300" x2="795" y2="300" stroke="black" strokeWidth="0.8" />
        <polygon points="165,297 165,303 153,300" fill="black" />
        <polygon points="795,297 795,303 807,300" fill="black" />
        <line x1="165" y1="293" x2="165" y2="307" stroke="black" strokeWidth="0.8" />
        <line x1="795" y1="293" x2="795" y2="307" stroke="black" strokeWidth="0.8" />
        <text x="480" y="318" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="9" letterSpacing="3" fill="black" opacity="0.6">DISTANCE: UNDEFINED · SIGNAL: LATENT</text>

        {/* Caption bar */}
        <line x1="0" y1="330" x2="960" y2="330" stroke="black" strokeWidth="0.5" opacity="0.25" />
        <text x="14" y="342" fontFamily="'IBM Plex Mono', monospace" fontSize="8" letterSpacing="1.8" fill="black" opacity="0.45">FIG. 01 — THE CONVERSATION · INTENT: LATENT · SYSTEM: NO MATCH</text>
      </svg>
    </figure>
  );
}

// ── FIG 02: FUTILITY OF SEARCH ──────────────────────────────────
// One figure facing an infinite perspective wall of identical search results
function SearchFrustrationFig() {
  // Generate a grid of result-cards in perspective (diminishing to the right)
  const cards: { x: number; y: number; w: number; h: number }[] = [];
  const cols = 5;
  const rows = 4;
  for (let c = 0; c < cols; c++) {
    const scale = 1 - c * 0.16;
    const cardW = 110 * scale;
    const cardH = 70 * scale;
    const startX = 300 + c * 130;
    const centerY = 155;
    for (let r = 0; r < rows; r++) {
      const totalH = rows * cardH + (rows - 1) * 10 * scale;
      const y = centerY - totalH / 2 + r * (cardH + 10 * scale);
      cards.push({ x: startX, y, w: cardW, h: cardH });
    }
  }

  return (
    <figure data-fade style={{ margin: '3rem 0', border: '3px solid #000', background: '#fff', overflow: 'hidden' }}>
      <svg viewBox="0 0 980 320" width="100%" style={{ display: 'block' }} aria-label="Fig. 02 — The futility of search.">
        {/* Registration marks */}
        {[{ x: 8, y: 8 }, { x: 972, y: 8 }, { x: 8, y: 312 }, { x: 972, y: 312 }].map(({ x, y }, i) => (
          <g key={i}>
            <line x1={x} y1={y + 8} x2={x} y2={y + 16} stroke="black" strokeWidth="0.8" opacity="0.35" />
            <line x1={x + (i % 2 === 0 ? 8 : -8)} y1={y} x2={x + (i % 2 === 0 ? 16 : -16)} y2={y} stroke="black" strokeWidth="0.8" opacity="0.35" />
          </g>
        ))}

        {/* FIGURE (left) */}
        <circle cx="140" cy="108" r="24" fill="white" stroke="black" strokeWidth="1.5" />
        <line x1="140" y1="132" x2="140" y2="146" stroke="black" strokeWidth="1.5" />
        <rect x="124" y="146" width="32" height="55" fill="white" stroke="black" strokeWidth="1.5" />
        {/* arm pointing right (toward results) */}
        <line x1="156" y1="158" x2="230" y2="158" stroke="black" strokeWidth="1.5" />
        <line x1="124" y1="158" x2="96" y2="178" stroke="black" strokeWidth="1.5" />
        <line x1="133" y1="201" x2="122" y2="250" stroke="black" strokeWidth="1.5" />
        <line x1="147" y1="201" x2="158" y2="250" stroke="black" strokeWidth="1.5" />
        <text x="140" y="270" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="10" letterSpacing="2" fill="black">YOU</text>

        {/* Arrow from figure to results */}
        <line x1="235" y1="155" x2="295" y2="155" stroke="black" strokeWidth="1" strokeDasharray="5,4" opacity="0.5" />
        <polygon points="295,152 295,158 303,155" fill="black" opacity="0.5" />

        {/* RESULT CARDS — diminishing perspective */}
        {cards.map((c, i) => (
          <g key={i}>
            <rect x={c.x} y={c.y} width={c.w} height={c.h} fill="#f8f8f8" stroke="black" strokeWidth="0.7" />
            {/* Identical placeholder lines inside each card */}
            <rect x={c.x + c.w * 0.1} y={c.y + c.h * 0.2} width={c.w * 0.8} height={c.h * 0.12} fill="rgba(0,0,0,0.15)" />
            <rect x={c.x + c.w * 0.1} y={c.y + c.h * 0.42} width={c.w * 0.65} height={c.h * 0.1} fill="rgba(0,0,0,0.08)" />
            <rect x={c.x + c.w * 0.1} y={c.y + c.h * 0.62} width={c.w * 0.5} height={c.h * 0.1} fill="rgba(0,0,0,0.06)" />
          </g>
        ))}

        {/* Perspective horizon vanishing point (for the results wall) */}
        <circle cx="940" cy="155" r="4" fill="black" opacity="0.2" />
        {/* Perspective lines to VP */}
        <line x1="300" y1="65" x2="940" y2="155" stroke="black" strokeWidth="0.4" opacity="0.12" strokeDasharray="4,4" />
        <line x1="300" y1="250" x2="940" y2="155" stroke="black" strokeWidth="0.4" opacity="0.12" strokeDasharray="4,4" />

        {/* "∞" label after last column */}
        <text x="935" y="132" fontFamily="'IBM Plex Mono', monospace" fontSize="28" fill="black" opacity="0.25" textAnchor="middle">∞</text>

        {/* Dimension line */}
        <line x1="300" y1="292" x2="920" y2="292" stroke="black" strokeWidth="0.7" />
        <polygon points="300,289 300,295 290,292" fill="black" />
        <polygon points="920,289 920,295 930,292" fill="black" />
        <text x="610" y="308" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="9" letterSpacing="2.5" fill="black" opacity="0.55">SEARCH RESULTS: n → ∞  ·  SIGNAL: 0</text>

        {/* Caption */}
        <line x1="0" y1="314" x2="980" y2="314" stroke="black" strokeWidth="0.5" opacity="0.2" />
        <text x="14" y="323" fontFamily="'IBM Plex Mono', monospace" fontSize="8" letterSpacing="1.8" fill="black" opacity="0.4">FIG. 02 — INFINITE SCROLL · IDENTICAL RESULTS · INTENT: UNMATCHED</text>
      </svg>
    </figure>
  );
}

// ── THE MONUMENT ELEVATION ──────────────────────────────────────
// Full-bleed SVG: the Continuous Monument face-on in architectural elevation.
// A white slab with grid, extending infinitely left and right.
// Tiny scale figures at the base. Architectural dimension notation.
function MonumentElevation({ label }: { label: string }) {
  const gridStep = 40; // grid square size in SVG units
  const W = 1800, H = 320;
  const monTop = 30;
  const groundY = 255;
  const figH = 38;

  // Build grid lines
  const vLines: number[] = [];
  for (let x = gridStep; x < W; x += gridStep) vLines.push(x);
  const hLines: number[] = [];
  for (let y = monTop + gridStep; y < groundY; y += gridStep) hLines.push(y);

  // Figure positions across the base
  const figXs = [120, 320, 580, 900, 1220, 1480, 1700];

  return (
    <div data-fade style={{ margin: '4rem -2rem', borderTop: '3px solid #000', borderBottom: '3px solid #000', overflow: 'hidden', background: '#fff', position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} aria-label={label}>
        {/* Sky: white (background is already white) */}

        {/* Monument face */}
        <rect x="0" y={monTop} width={W} height={groundY - monTop} fill="white" stroke="none" />

        {/* Grid lines on monument — vertical */}
        {vLines.map((x) => (
          <line key={x} x1={x} y1={monTop} x2={x} y2={groundY} stroke="black" strokeWidth="0.5" opacity="0.15" />
        ))}
        {/* Grid lines on monument — horizontal */}
        {hLines.map((y) => (
          <line key={y} x1={0} y1={y} x2={W} y2={y} stroke="black" strokeWidth="0.5" opacity="0.15" />
        ))}

        {/* Monument top edge */}
        <line x1="0" y1={monTop} x2={W} y2={monTop} stroke="black" strokeWidth="1.5" />
        {/* Monument bottom edge (ground line) */}
        <line x1="0" y1={groundY} x2={W} y2={groundY} stroke="black" strokeWidth="2" />

        {/* Ground shadow: subtle hatching below monument */}
        {Array.from({ length: 20 }, (_, i) => (
          <line key={i}
            x1={i * 120} y1={groundY + 2}
            x2={i * 120 + 80} y2={groundY + 24}
            stroke="black" strokeWidth="0.5" opacity="0.12" />
        ))}

        {/* Scale figures at base */}
        {figXs.map((fx, i) => (
          <g key={i}>
            {/* head */}
            <circle cx={fx} cy={groundY - figH + figH * 0.11} r={figH * 0.09} fill="black" />
            {/* body */}
            <line x1={fx} y1={groundY - figH + figH * 0.21} x2={fx} y2={groundY - figH * 0.36} stroke="black" strokeWidth="2" />
            {/* arms */}
            <line x1={fx - figH * 0.12} y1={groundY - figH * 0.7} x2={fx + figH * 0.12} y2={groundY - figH * 0.7} stroke="black" strokeWidth="1.5" />
            {/* legs */}
            <line x1={fx} y1={groundY - figH * 0.36} x2={fx - figH * 0.1} y2={groundY} stroke="black" strokeWidth="1.5" />
            <line x1={fx} y1={groundY - figH * 0.36} x2={fx + figH * 0.1} y2={groundY} stroke="black" strokeWidth="1.5" />
          </g>
        ))}

        {/* Vertical dimension line: height */}
        <line x1="52" y1={monTop} x2="52" y2={groundY} stroke="black" strokeWidth="0.8" />
        <polygon points="52,30 49,42 55,42" fill="black" opacity="0.6" />
        <polygon points="52,255 49,243 55,243" fill="black" opacity="0.6" />
        <text x="38" y="145" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="9" letterSpacing="1.5" fill="black" opacity="0.5" transform="rotate(-90 38 145)">HEIGHT: ∞</text>

        {/* Horizontal extent annotation */}
        <text x={W / 2} y={monTop - 10} textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="8" letterSpacing="2" fill="black" opacity="0.35">← MONUMENT EXTENDS TO INFINITY →</text>

        {/* Monument "continues" dashed lines at edges */}
        <line x1="0" y1={monTop + 20} x2="0" y2={monTop + 20} stroke="black" strokeWidth="1" strokeDasharray="5,3" />

        {/* Title annotation bottom-right */}
        <text x={W - 14} y={H - 10} textAnchor="end" fontFamily="'IBM Plex Mono', monospace" fontSize="9" letterSpacing="2" fill="black" opacity="0.4">{label}</text>

        {/* Section cut marks at edges */}
        <circle cx="14" cy={groundY - 40} r="10" fill="none" stroke="black" strokeWidth="1" opacity="0.3" />
        <line x1="0" y1={groundY - 40} x2="28" y2={groundY - 40} stroke="black" strokeWidth="0.7" opacity="0.3" />
        <line x1="14" y1={groundY - 54} x2="14" y2={groundY - 26} stroke="black" strokeWidth="0.7" opacity="0.3" />
        <circle cx={W - 14} cy={groundY - 40} r="10" fill="none" stroke="black" strokeWidth="1" opacity="0.3" />
        <line x1={W - 28} y1={groundY - 40} x2={W} y2={groundY - 40} stroke="black" strokeWidth="0.7" opacity="0.3" />
        <line x1={W - 14} y1={groundY - 54} x2={W - 14} y2={groundY - 26} stroke="black" strokeWidth="0.7" opacity="0.3" />
      </svg>
    </div>
  );
}

// ── FIG 03: INTERFACE EVOLUTION ─────────────────────────────────
// CLI → GUI → LLM Agent: three architectural diagrams in sequence
function InterfaceEvolutionFig() {
  return (
    <figure data-fade style={{ margin: '3rem 0', border: '3px solid #000', background: '#fff', overflow: 'hidden' }}>
      <svg viewBox="0 0 1020 280" width="100%" style={{ display: 'block' }} aria-label="Interface evolution: CLI to GUI to Agent">
        {/* Panel 1: CLI Era */}
        <rect x="40" y="30" width="250" height="180" fill="#0a0a0a" stroke="black" strokeWidth="2" />
        {/* Title bar */}
        <rect x="40" y="30" width="250" height="22" fill="#1a1a1a" stroke="none" />
        {['#e74c3c', '#f39c12', '#27ae60'].map((c, i) => (
          <circle key={c} cx={56 + i * 16} cy="41" r="6" fill={c} />
        ))}
        {/* CLI content: lines of text */}
        {['$ find_job --role "engineer"', '$ filter --skill "rust"', '$ apply --cv resume.pdf', '> No match found.', '█'].map((line, i) => (
          <text key={i} x="52" y={70 + i * 20} fontFamily="'IBM Plex Mono', monospace" fontSize="10" fill={i === 3 ? '#888' : '#c8b448'}>
            {line}
          </text>
        ))}
        <text x="165" y="236" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="9" letterSpacing="2" fill="black" opacity="0.6">CLI ERA</text>
        <text x="165" y="252" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="8" letterSpacing="1.5" fill="black" opacity="0.4">Explicit. Exacting. Isolating.</text>

        {/* Arrow 1→2 */}
        <line x1="310" y1="120" x2="370" y2="120" stroke="black" strokeWidth="1.5" />
        <polygon points="370,116 370,124 382,120" fill="black" />

        {/* Panel 2: GUI Era */}
        <rect x="390" y="30" width="250" height="180" fill="#e8e8e8" stroke="black" strokeWidth="2" />
        <rect x="390" y="30" width="250" height="22" fill="#c0c0c0" stroke="none" />
        {['#e74c3c', '#f39c12', '#27ae60'].map((c, i) => (
          <circle key={c} cx={406 + i * 16} cy="41" r="6" fill={c} />
        ))}
        {/* GUI content: UI elements */}
        <rect x="408" y="62" width="216" height="8" rx="1" fill="#aaa" />
        <rect x="408" y="78" width="160" height="8" rx="1" fill="#bbb" />
        <rect x="408" y="94" width="190" height="8" rx="1" fill="#bbb" />
        {/* Filter buttons */}
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={408 + i * 54} y="114" width="46" height="24" rx="2" fill="#c8c8c8" stroke="#aaa" strokeWidth="0.7" />
        ))}
        {/* Results skeleton */}
        {[0, 1].map((i) => (
          <rect key={i} x={408} y={148 + i * 30} width={216} height={22} rx="2" fill="#d0d0d0" />
        ))}
        <text x="515" y="236" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="9" letterSpacing="2" fill="black" opacity="0.6">GUI ERA</text>
        <text x="515" y="252" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="8" letterSpacing="1.5" fill="black" opacity="0.4">Accessible. Shallow. Decontextualized.</text>

        {/* Arrow 2→3 */}
        <line x1="660" y1="120" x2="720" y2="120" stroke="black" strokeWidth="1.5" />
        <polygon points="720,116 720,124 732,120" fill="black" />

        {/* Panel 3: Agent/LLM Era */}
        <rect x="740" y="30" width="250" height="180" fill="white" stroke="black" strokeWidth="2" />
        {/* Two nodes connected = the agent handshake */}
        {/* Human node */}
        <circle cx="810" cy="95" r="28" fill="white" stroke="black" strokeWidth="2" />
        <text x="810" y="99" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="9" fill="black">YOU</text>
        {/* Connection line with arrows in both directions */}
        <line x1="838" y1="95" x2="892" y2="95" stroke="black" strokeWidth="1.5" />
        <polygon points="892,92 892,98 900,95" fill="black" />
        <polygon points="838,92 838,98 830,95" fill="black" />
        {/* Agent/other node */}
        <circle cx="920" cy="95" r="28" fill="black" stroke="black" strokeWidth="2" />
        <text x="920" y="91" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="8" fill="white">YOUR</text>
        <text x="920" y="103" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="8" fill="white">OTHERS</text>
        {/* Intent label above connection */}
        <text x="865" y="82" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="7.5" fill="black" opacity="0.6">INTENT</text>
        {/* Small satellite nodes */}
        {[{ cx: 820, cy: 148 }, { cx: 860, cy: 162 }, { cx: 905, cy: 150 }, { cx: 940, cy: 160 }].map((n, i) => (
          <g key={i}>
            <circle cx={n.cx} cy={n.cy} r="9" fill="none" stroke="black" strokeWidth="1" opacity="0.4" />
            <line x1={n.cx} y1={n.cy - 9} x2={865} y2="110" stroke="black" strokeWidth="0.5" opacity="0.2" strokeDasharray="3,3" />
          </g>
        ))}
        <text x="865" y="236" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="9" letterSpacing="2" fill="black" opacity="0.6">AGENT ERA</text>
        <text x="865" y="252" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="8" letterSpacing="1.5" fill="black" opacity="0.4">Intent. Context. Protocol.</text>

        {/* Caption bar */}
        <line x1="0" y1="270" x2="1020" y2="270" stroke="black" strokeWidth="0.5" opacity="0.2" />
        <text x="14" y="280" fontFamily="'IBM Plex Mono', monospace" fontSize="8" letterSpacing="1.8" fill="black" opacity="0.4">FIG. 03 — INTERFACE EVOLUTION · CLI → GUI → AGENT · TRANSLATION TAX: COLLAPSING</text>
      </svg>
    </figure>
  );
}

// ── AGENT NETWORK PLAN ──────────────────────────────────────────
// Architectural PLAN VIEW (top-down) of the agent network.
// Looks like a floor plan where the "rooms" are network nodes.
function AgentNetworkPlan() {
  const nodes = [
    { id: 'YOU',     x: 400, y: 230, r: 36, fill: '#000', label: '#fff', isYou: true },
    { id: 'AGENT',   x: 220, y: 115, r: 22, fill: '#fff', label: '#000' },
    { id: 'PEER A',  x: 400, y: 80,  r: 20, fill: '#fff', label: '#000' },
    { id: 'PEER B',  x: 580, y: 115, r: 22, fill: '#fff', label: '#000' },
    { id: 'BRIDGE',  x: 640, y: 280, r: 20, fill: '#fff', label: '#000' },
    { id: 'MATCH',   x: 580, y: 370, r: 26, fill: '#fff', label: '#000' },
    { id: 'COLLAB',  x: 400, y: 400, r: 20, fill: '#fff', label: '#000' },
    { id: 'OPP.',    x: 200, y: 360, r: 22, fill: '#fff', label: '#000' },
    { id: 'FRIEND',  x: 160, y: 258, r: 18, fill: '#fff', label: '#000' },
  ];

  const connections = [
    [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8],
    [1, 8], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8],
  ];

  return (
    <figure data-fade style={{ margin: '3rem 0', border: '3px solid #000', background: '#fff', overflow: 'hidden' }}>
      <svg viewBox="0 0 800 490" width="100%" style={{ display: 'block' }} aria-label="Agent network — plan view">
        {/* Fine dot grid background */}
        {Array.from({ length: 26 }, (_, row) =>
          Array.from({ length: 17 }, (_, col) => (
            <circle key={`${row}-${col}`} cx={col * 50 + 25} cy={row * 30 + 15} r="1" fill="black" opacity="0.1" />
          ))
        )}

        {/* Registration marks */}
        {[{ x: 10, y: 10 }, { x: 790, y: 10 }, { x: 10, y: 480 }, { x: 790, y: 480 }].map(({ x, y }, i) => (
          <g key={i}>
            <line x1={x} y1={y + 8} x2={x} y2={y + 18} stroke="black" strokeWidth="0.8" opacity="0.3" />
            <line x1={x + (i % 2 === 0 ? 8 : -8)} y1={y} x2={x + (i % 2 === 0 ? 18 : -18)} y2={y} stroke="black" strokeWidth="0.8" opacity="0.3" />
          </g>
        ))}

        {/* Connection lines */}
        {connections.map(([a, b], i) => {
          const na = nodes[a], nb = nodes[b];
          const isDirect = a === 0;
          return (
            <line key={i}
              x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
              stroke="black"
              strokeWidth={isDirect ? 1.5 : 0.7}
              strokeDasharray={isDirect ? 'none' : '5,4'}
              opacity={isDirect ? 0.4 : 0.2}
            />
          );
        })}

        {/* Node circles */}
        {nodes.map((n) => (
          <g key={n.id}>
            {/* Halo (like architectural crosshair target) */}
            <circle cx={n.x} cy={n.y} r={n.r + 12} fill="none" stroke="black" strokeWidth="0.5" opacity="0.12" />
            {/* Crosshair lines */}
            <line x1={n.x - n.r - 8} y1={n.y} x2={n.x - n.r + 4} y2={n.y} stroke="black" strokeWidth="0.5" opacity="0.25" />
            <line x1={n.x + n.r - 4} y1={n.y} x2={n.x + n.r + 8} y2={n.y} stroke="black" strokeWidth="0.5" opacity="0.25" />
            <line x1={n.x} y1={n.y - n.r - 8} x2={n.x} y2={n.y - n.r + 4} stroke="black" strokeWidth="0.5" opacity="0.25" />
            <line x1={n.x} y1={n.y + n.r - 4} x2={n.x} y2={n.y + n.r + 8} stroke="black" strokeWidth="0.5" opacity="0.25" />
            {/* Main circle */}
            <circle cx={n.x} cy={n.y} r={n.r} fill={n.fill} stroke="black" strokeWidth={n.isYou ? 2.5 : 1.5} />
            {/* Label */}
            <text x={n.x} y={n.y + (n.isYou ? 5 : 4)} textAnchor="middle"
              fontFamily="'IBM Plex Mono', monospace"
              fontSize={n.isYou ? 10 : 8}
              fontWeight={n.isYou ? 700 : 400}
              letterSpacing="1"
              fill={n.label}
            >
              {n.id}
            </text>
            {/* Node coordinate annotation */}
            {!n.isYou && (
              <text x={n.x + n.r + 14} y={n.y - n.r + 4}
                fontFamily="'IBM Plex Mono', monospace"
                fontSize="7"
                fill="black"
                opacity="0.35"
                letterSpacing="1"
              >
                {`(${n.x},${n.y})`}
              </text>
            )}
          </g>
        ))}

        {/* Title */}
        <text x="400" y="472" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="9" letterSpacing="2.5" fill="black" opacity="0.5">AGENT NETWORK — PLAN VIEW · SCALE 1:1000 · 9 NODES</text>
      </svg>
    </figure>
  );
}

// ── STRUCTURE CARD ──────────────────────────────────────────────
function StructureCard({ title, sub, body }: { title: string; sub: string; body: string }) {
  return (
    <div data-fade style={{ border: '3px solid #000', padding: '2rem', background: '#fff', position: 'relative' }}>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.55rem', letterSpacing: '0.25em', textTransform: 'uppercase', marginBottom: '1rem', color: '#666' }}>{sub}</div>
      <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 'clamp(1.6rem,3vw,2.2rem)', letterSpacing: '-0.02em', textTransform: 'uppercase', marginBottom: '1rem', color: '#000', lineHeight: 1 }}>{title}</div>
      <p style={{ fontFamily: SANS, fontSize: '0.85rem', lineHeight: 1.7, color: '#333', margin: 0 }}>{body}</p>
    </div>
  );
}

const FLOW = [
  { t: 'A human expresses intent',            d: 'Raw, unfiltered — in their own language' },
  { t: 'Their agent encodes it',              d: 'Context, nuance, and goals preserved' },
  { t: 'Agents discover overlapping intents', d: 'Scanning the network continuously, quietly' },
  { t: 'They negotiate compatibility',         d: 'Silent, tireless, on your behalf' },
  { t: 'They disclose appropriately',          d: 'Availability, context, relevant files — shared selectively' },
  { t: 'They consult memory and peers',        d: 'Gossip, reputation, trust signals weighed' },
  { t: 'An opportunity becomes legible',       d: 'Intent, context, trust, and timing finally align' },
  { t: 'Humans are invited in',                d: 'The door opens at the right moment' },
  { t: 'Humans decide: go or no-go',           d: 'The final say is always yours' },
  { t: 'If go, conversation initiated',        d: 'A new connection begins' },
];

export default function FoundInTranslation1() {
  const pageRef = useRef<HTMLDivElement>(null);
  const progress = useScrollProgress();
  useFadeIn(pageRef as React.RefObject<HTMLElement>);

  const P: React.CSSProperties = {
    fontFamily: SANS,
    fontSize: 'max(16px, 1.08rem)', lineHeight: 1.85, color: '#222', marginBottom: '1.5rem',
  };
  const WRAP: React.CSSProperties = { maxWidth: 720, margin: '0 auto', padding: '0 2rem' };

  return (
    <div ref={pageRef} style={{ background: '#fff', color: '#000', minHeight: '100vh', overflowX: 'hidden', fontFamily: SANS }}>
      <style>{KF}</style>

      {/* Progress bar */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 4, zIndex: 100, background: '#e0e0e0' }}>
        <div style={{ height: '100%', width: `${progress * 100}%`, background: '#000', transition: 'width 0.1s linear' }} />
      </div>

      {/* ── HERO: CONTINUOUS MONUMENT OVER NEW YORK ── */}
      <section style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden', borderBottom: '3px solid #000', display: 'flex', flexDirection: 'column' }}>
        {/* Original generated hero image — full bleed */}
        <img
          src="/found-in-translation/found-in-translation-1-hero.png"
          alt="Monumental grid-plane emerging across a city skyline at dusk"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top', zIndex: 0 }}
        />
        {/* Subtle vignette so text is readable */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.1) 55%, transparent 100%)', zIndex: 1 }} />
        {/* Horizontal grid lines — matching monument grid language */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 1, pointerEvents: 'none' }} preserveAspectRatio="none">
          {[0.25, 0.5, 0.75].map((t, i) => (
            <line key={i} x1="0" y1={`${t * 100}%`} x2="100%" y2={`${t * 100}%`} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
          ))}
          {[0.2, 0.4, 0.6, 0.8].map((t, i) => (
            <line key={i} x1={`${t * 100}%`} y1="0" x2={`${t * 100}%`} y2="100%" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
          ))}
          {/* Corner registration marks */}
          <g stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" fill="none">
            <line x1="16" y1="64" x2="48" y2="64" /><line x1="16" y1="64" x2="16" y2="96" />
            <line x1="calc(100% - 16)" y1="64" x2="calc(100% - 48)" y2="64" /><line x1="calc(100% - 16)" y1="64" x2="calc(100% - 16)" y2="96" />
          </g>
        </svg>

        {/* Nav bar */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 52, display: 'flex', alignItems: 'stretch', zIndex: 5 }}>
          <div style={{ borderRight: '1px solid rgba(255,255,255,0.25)', padding: '0 1.5rem', display: 'flex', alignItems: 'center', fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.62rem', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            <Link to="/" style={{ color: '#fff', textDecoration: 'none' }}>Index Network</Link>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ borderLeft: '1px solid rgba(255,255,255,0.25)', padding: '0 1.5rem', display: 'flex', alignItems: 'center', fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.52rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>
            Protocol Document · 01
          </div>
        </div>

        {/* Hero text — bottom-left */}
        <div style={{ position: 'absolute', bottom: 52, left: 0, right: 0, zIndex: 4, padding: '0 3rem 3rem' }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.58rem', letterSpacing: '0.28em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginBottom: '1.5rem' }}>
            Continuous Monument Series · Language &amp; Intent
          </div>
          <h1 style={{ fontFamily: SANS, fontWeight: 900, fontSize: 'clamp(4rem,14vw,13rem)', lineHeight: 0.88, letterSpacing: '-0.04em', textTransform: 'uppercase', margin: 0, color: '#fff' }}>
            FOUND
            <br />
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>IN</span>
            <br />
            TRANS
            <br />
            LATION
          </h1>
        </div>

        {/* Bottom coordinate bar */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, borderTop: '1px solid rgba(255,255,255,0.2)', height: 36, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', padding: '0 1.5rem', gap: '2rem', zIndex: 5 }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.48rem', letterSpacing: '0.14em', color: 'rgba(255,255,255,0.45)' }}>NEW YORK 2026</span>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.12)' }} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.48rem', letterSpacing: '0.14em', color: 'rgba(255,255,255,0.45)' }}>INDEX NETWORK · FOUND IN TRANSLATION</span>
        </div>
      </section>

      <div style={{ ...WRAP, padding: '4rem 2rem 3rem' }}>
        <p data-fade style={{ fontFamily: SANS, fontWeight: 900, fontSize: 'clamp(2rem,5vw,4.5rem)', lineHeight: 0.95, letterSpacing: '-0.03em', color: '#000', marginBottom: '1.75rem' }}>
          Some things find you. Most don&apos;t.
        </p>
        <p data-fade style={{ ...P, marginBottom: 0 }}>
          They get archived away in secret conversations, thoughts expressed as free agents between a second margarita with a coworker on a sunny patio—where language flows as naturally as it gets.
        </p>
      </div>

      {/* Fig 01 — The Conversation (real architectural SVG) */}
      <div style={{ padding: '0 2rem' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <ConversationFig />
        </div>
      </div>

      <div style={{ ...WRAP, padding: '2rem 2rem 4rem' }}>
        <p data-fade style={P}>You sleep on your idea, wake up and start searching for someone who might just share your flavor of weird.</p>
      </div>

      {/* Fig 02 — Futility of Search (real SVG) */}
      <div style={{ padding: '0 2rem' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <SearchFrustrationFig />
        </div>
      </div>

      <div style={{ ...WRAP, padding: '2rem 2rem 4rem' }}>
        <p data-fade style={P}>You would think it gets easier—that technology was meant to help the stars align and deliver us the job that doesn't exist yet, or the investor who gets it.</p>
        <p data-fade style={P}>For most of computing history, there was no system elastic enough to hold that kind of ambiguity. The next opportunity ahead is often illegible to ourselves—until it arrives as the email we've been waiting for.</p>
      </div>

      {/* ── FULL-BLEED MONUMENT ELEVATION ── */}
      <MonumentElevation label="CONTINUOUS MONUMENT · ELEVATION · SCALE 1:5000" />

      {/* Dark monolith break */}
      <div style={{ background: '#000', padding: 'clamp(5rem,10vw,10rem) 3rem', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.04) 1px,transparent 1px)', backgroundSize: '40px 40px' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.52rem', letterSpacing: '0.28em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: '3rem' }}>— Lost in Translation</div>
          <h2 style={{ fontFamily: SANS, fontWeight: 900, fontSize: 'clamp(2.5rem,9vw,8rem)', lineHeight: 0.9, letterSpacing: '-0.03em', textTransform: 'uppercase', color: '#fff', margin: 0 }}>
            Somewhere<br />along the way,<br />
            <span style={{ color: '#000', WebkitTextStroke: '2px #fff' }}>we got lost</span>
          </h2>
        </div>
      </div>

      <div style={{ ...WRAP, padding: '5rem 2rem 4rem' }}>
        <p data-fade style={P}>It starts with the center of how we make sense of things: the brain.</p>
        <div data-fade style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, margin: '2.5rem 0', border: '3px solid #000' }}>
          <StructureCard title="Habitual" sub="System I — Reactive" body="Reflexes, patterns, snooze buttons. What you did." />
          <div style={{ borderLeft: '3px solid #000' }}>
            <StructureCard title="Intentional" sub="System II — Planning" body="Goals, models, long-game thinking. What you meant." />
          </div>
        </div>
        <p data-fade style={P}>Most of what we call "intent" lives in the second system. Context-sensitive and continuously recalibrating to our desired outcomes.</p>
        <p data-fade style={P}>As anyone who's ever looked for a new job knows, having the intent is easy. Expressing it in a way that's legible to others is a different story.</p>
        <div data-fade style={{ margin: '2.5rem 0', borderLeft: '4px solid #000', paddingLeft: '2rem' }}>
          <p style={{ fontFamily: SANS, fontStyle: 'italic', fontSize: 'clamp(1rem,2vw,1.25rem)', color: '#222', lineHeight: 1.65, margin: 0 }}>
            "When we say that meanings materialize, we mean that sensemaking is, importantly, an issue of language, talk, and communication."
          </p>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.58rem', letterSpacing: '0.1em', color: '#888', marginTop: '0.75rem' }}>— ANDREW HINTON, UNDERSTANDING CONTEXT (2014)</div>
        </div>
        <ArchCallout>Computers do not operate on raw human intent, only its translation.</ArchCallout>
        <div data-fade style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, margin: '2.5rem 0', border: '3px solid #000' }}>
          {[
            { era: 'Command Line Era', desc: "Explicit and exacting. Hard work most of us don't have energy for.", dark: true },
            { era: 'GUI Era', desc: 'Easier to use, but increased the distance between intent and execution.', dark: false },
          ].map(({ era, desc, dark }, i) => (
            <div key={i} style={{ padding: '1.75rem', background: dark ? '#0a0a0a' : '#f5f5f5', borderLeft: i === 1 ? '3px solid #000' : undefined }}>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.55rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: dark ? '#666' : '#999', marginBottom: '1rem' }}>{era}</div>
              <p style={{ fontFamily: SANS, fontSize: '0.83rem', color: dark ? '#aaa' : '#555', lineHeight: 1.6, margin: 0 }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Break */}
      <div style={{ background: '#fff', borderTop: '3px solid #000', borderBottom: '3px solid #000', padding: 'clamp(4rem,8vw,8rem) 3rem', textAlign: 'center' }}>
        <p style={{ fontFamily: SANS, fontWeight: 900, fontSize: 'clamp(1.8rem,5vw,4.5rem)', lineHeight: 1.1, letterSpacing: '-0.02em', textTransform: 'uppercase', color: '#000', maxWidth: 900, margin: '0 auto' }}>
          Translation at its best is still reductive. But what if translation could{' '}
          <span style={{ background: '#000', color: '#fff', padding: '0 0.2em' }}>carry the original intent?</span>
        </p>
      </div>

      <div style={{ ...WRAP, padding: '5rem 2rem 4rem' }}>
        <h2 data-fade style={{ fontFamily: SANS, fontWeight: 900, fontSize: 'clamp(2.2rem,5vw,4rem)', lineHeight: 0.95, letterSpacing: '-0.03em', textTransform: 'uppercase', color: '#000', marginBottom: '2.5rem' }}>
          Language<br />is the new<br />
          <span style={{ background: '#000', color: '#fff', display: 'inline-block', padding: '0 0.15em' }}>Interface</span>
        </h2>
        <p data-fade style={P}>Instead of searching through platforms and engines, we're talking to LLMs. The translation tax that defined prior interfaces is slowly collapsing.</p>
      </div>

      {/* Fig 03 — Interface Evolution (real SVG) */}
      <div style={{ padding: '0 2rem' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <InterfaceEvolutionFig />
        </div>
      </div>

      <div style={{ ...WRAP, padding: '2rem 2rem 4rem' }}>
        <p data-fade style={P}>For the first time, systems can engage with the model-based, context-sensitive layer of human decision-making: the layer where intent actually lives.</p>
        <p data-fade style={P}>This redistributes influence. In the context of platforms that once brokered most professional connections—their grip loosens when the work is distributed among individual agents.</p>
        <ArchCallout>"Have your agent call my agent."</ArchCallout>
        <p data-fade style={P}>It's not about a better matching algorithm, but redesigning the way we think about finding our others. Because sometimes new opportunity needs privacy before visibility.</p>
        <p data-fade style={P}>Agents congregate in their own social networks and water coolers to trade gossip on behalf of their users. And that private sharing yields interesting, often unexpected results.</p>
      </div>

      <div style={{ background: '#f5f5f5', padding: 'clamp(5rem,8vw,8rem) 2rem', borderBottom: '3px solid #000' }}>
        <div style={{ ...WRAP }}>
          <h2 data-fade style={{ fontFamily: SANS, fontWeight: 900, fontSize: 'clamp(2rem,4.5vw,3.5rem)', lineHeight: 0.95, letterSpacing: '-0.03em', textTransform: 'uppercase', color: '#000', marginBottom: '3rem' }}>
            The emerging<br />model of social<br />coordination
          </h2>

          {/* Agent Network Plan SVG */}
          <AgentNetworkPlan />

          {/* Flow steps */}
          <div style={{ margin: '3rem 0', border: '3px solid #000' }}>
            {FLOW.map((step, i) => (
              <div key={i} data-fade data-delay={String(i * 50)} style={{ display: 'grid', gridTemplateColumns: '64px 1fr', borderBottom: i < FLOW.length - 1 ? '1px solid #ddd' : 'none', background: i % 2 === 0 ? '#fff' : '#f9f9f9' }}>
                <div style={{ borderRight: '3px solid #000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.05em', color: '#000', padding: '1.25rem 0' }}>
                  {String(i + 1).padStart(2, '0')}
                </div>
                <div style={{ padding: '1.25rem 1.5rem' }}>
                  <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.02em', color: '#000', marginBottom: '0.25rem' }}>{step.t}</div>
                  <p style={{ fontFamily: SANS, fontSize: '0.78rem', color: '#666', lineHeight: 1.5, margin: 0 }}>{step.d}</p>
                </div>
              </div>
            ))}
          </div>

          <p data-fade style={P}>The human sets the initial judgment and still has the final say. Agents are autonomous in facilitating, not deciding.</p>
          <div data-fade style={{ margin: '2.5rem 0', padding: '2.5rem', border: '3px solid #000', borderLeft: '8px solid #000', background: '#fff' }}>
            <p style={{ fontFamily: SANS, fontWeight: 300, fontSize: 'clamp(1.1rem,2.2vw,1.4rem)', lineHeight: 1.5, color: '#000', margin: 0 }}>
              It's more than training a better model. It's an operating protocol for cooperation—standard procedures for agent-to-agent relationships that let trust compound over time.
            </p>
          </div>
        </div>
      </div>

      <div style={{ ...WRAP, padding: '5rem 2rem 6rem' }}>
        <h2 data-fade style={{ fontFamily: SANS, fontWeight: 900, fontSize: 'clamp(2.2rem,5vw,4rem)', lineHeight: 0.95, letterSpacing: '-0.03em', textTransform: 'uppercase', color: '#000', marginBottom: '2.5rem' }}>
          Entering<br />Ambient<br />Optimism
        </h2>
        <p data-fade style={P}>We can now realize opportunity value that previously remained latent because of lack of—or failed—coordination. Open up multiverses where you meet the person you just missed.</p>
        <p data-fade style={P}>We call this <strong>engineering serendipity</strong>. But the feeling it engenders is the powerful part:</p>
        <div data-fade style={{ margin: '3rem 0', padding: '3rem', background: '#000', color: '#fff', border: '3px solid #000' }}>
          <p style={{ fontFamily: SANS, fontWeight: 900, fontSize: 'clamp(1.4rem,3vw,2.2rem)', lineHeight: 1.1, letterSpacing: '-0.01em', textTransform: 'uppercase', margin: 0 }}>
            Ambient optimism.<br />The quiet trust that<br />the right opportunities<br />will find you.
          </p>
        </div>
        <p data-fade style={P}>Not because you finally nailed your personal brand or figured out the black box algos, but because your intents are out there—the new trading language of agents with far more patience and reach.</p>
      </div>

      {/* ── CLOSING MONUMENT ── */}
      <div style={{ background: '#000', padding: 'clamp(6rem,14vw,14rem) 3rem', textAlign: 'center', borderTop: '3px solid #000', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.03) 1px,transparent 1px)', backgroundSize: '60px 60px' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.52rem', letterSpacing: '0.28em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: '4rem' }}>— Found in Translation</div>
          <p style={{ fontFamily: SANS, fontWeight: 900, fontSize: 'clamp(3rem,10vw,10rem)', lineHeight: 0.88, letterSpacing: '-0.04em', textTransform: 'uppercase', color: '#fff', margin: 0 }}>
            Your others<br />are out there.<br />
            <span style={{ color: '#000', WebkitTextStroke: '2px #fff' }}>Now they can<br />find you too.</span>
          </p>
        </div>
      </div>

      {/* Footer */}
      <footer style={{ borderTop: '3px solid #000', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        <div style={{ padding: '1.5rem 2rem', borderRight: '1px solid #000', fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.65rem', letterSpacing: '0.1em' }}>
          <Link to="/" style={{ color: '#000', textDecoration: 'none' }}>Index Network</Link>
        </div>
        <div style={{ padding: '1.5rem 2rem', display: 'flex', justifyContent: 'flex-end', fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.65rem', letterSpacing: '0.1em' }}>
          <Link to="/blog" style={{ color: '#000', textDecoration: 'none' }}>← Back to Letters</Link>
        </div>
      </footer>
    </div>
  );
}

export const Component = FoundInTranslation1;
