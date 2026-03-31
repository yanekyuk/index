'use client';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';

// ── palette — Anthropic-inspired warm neutrals ────────────────
const C = {
  // backgrounds
  bg:      '#fafaf2',   // warm off-white — main canvas
  bgOff:   '#f2f2e8',   // slightly deeper for alt sections
  bgDark:  '#1a1a14',   // near-black with warmth — hero, closings
  bgSage:  '#2c3d1e',   // deep muted green — accent section

  // text
  ink:     '#2e2e24',   // warm charcoal — primary
  mid:     'rgba(46,46,36,.52)',
  dim:     'rgba(46,46,36,.3)',
  faint:   'rgba(46,46,36,.14)',

  // on-dark
  oatmeal: '#f0ede4',   // warm cream for dark panels
  oatMid:  'rgba(240,237,228,.55)',
  oatDim:  'rgba(240,237,228,.25)',

  // accents
  gold:    '#b8a030',   // muted gold — primary accent (Anthropic-inspired)
  goldLight:'#d4bc48',  // lighter gold for dark panels
  terra:   '#b85a42',   // warm terracotta — emotional accent
  sage:    '#5a7a40',   // muted sage green
} as const;

const GARAMOND = "'EB Garamond', Georgia, serif";
const SANS     = "'Public Sans', system-ui, sans-serif";
const MONO     = "'IBM Plex Mono', monospace";

const KF = `
  @keyframes g1 { 0%,85%,100%{transform:none} 88%{transform:translate(-5px,1px) skewX(-2deg)} 91%{transform:translate(3px,-1px)} 94%{transform:translate(-2px,0)} }
  @keyframes g2 { 0%,85%,100%{transform:none} 88%{transform:translate(5px,-1px) skewX(2deg)} 91%{transform:translate(-3px,1px)} 94%{transform:translate(2px,0)} }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
  @keyframes breathe { 0%,100%{opacity:.15;transform:scaleY(.4)} 50%{opacity:.8;transform:scaleY(1)} }
  @keyframes ticker { from{transform:translateX(0)} to{transform:translateX(-50%)} }
`;

const s = (x: React.CSSProperties) => x;

// ── reading progress ──────────────────────────────────────────
function ProgressBar() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const h = () => { const d = document.documentElement; setP(d.scrollTop / (d.scrollHeight - d.clientHeight)); };
    addEventListener('scroll', h, { passive: true });
    return () => removeEventListener('scroll', h);
  }, []);
  return (
    <div style={s({ position: 'fixed', top: 0, left: 0, right: 0, height: 2, zIndex: 100, background: C.faint })}>
      <div style={s({ height: '100%', width: `${p * 100}%`, background: C.gold, transition: 'width .1s linear' })} />
    </div>
  );
}

// ── fade-in observer ──────────────────────────────────────────
function useFadeIn(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!ref.current) return;
    const els = ref.current.querySelectorAll<HTMLElement>('[data-fade]');
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target as HTMLElement;
        el.style.transitionDelay = `${el.dataset.delay ?? 0}ms`;
        el.style.opacity = '1';
        el.style.transform = 'none';
      }),
      { threshold: 0.07, rootMargin: '0px 0px -24px 0px' },
    );
    els.forEach((el) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(16px)';
      el.style.transition = 'opacity .7s ease, transform .7s ease';
      io.observe(el);
    });
    return () => io.disconnect();
  }, [ref]);
}

// ── hero canvas ───────────────────────────────────────────────
function HeroCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d')!;
    let raf: number;
    type Pt = { x: number; y: number; vx: number; vy: number; r: number; ph: number };
    const pts: Pt[] = Array.from({ length: 65 }, () => ({
      x: Math.random() * 1920, y: Math.random() * 1080,
      vx: (Math.random() - .5) * .18, vy: (Math.random() - .5) * .18,
      r: Math.random() * 1.3 + .5, ph: Math.random() * Math.PI * 2,
    }));
    const resize = () => { cv.width = innerWidth; cv.height = innerHeight; };
    resize(); addEventListener('resize', resize);
    const draw = () => {
      const W = cv.width, H = cv.height, sx = W / 1920, sy = H / 1080, t = Date.now() / 1000;
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const dx = (pts[i].x - pts[j].x) * sx, dy = (pts[i].y - pts[j].y) * sy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 130) {
          ctx.beginPath(); ctx.moveTo(pts[i].x * sx, pts[i].y * sy); ctx.lineTo(pts[j].x * sx, pts[j].y * sy);
          ctx.strokeStyle = `rgba(184,160,48,${.1 * (1 - d / 130)})`; ctx.lineWidth = .5; ctx.stroke();
        }
      }
      for (const p of pts) {
        const sc = 1 + .2 * Math.sin(t * 1.3 + p.ph);
        ctx.beginPath(); ctx.arc(p.x * sx, p.y * sy, p.r * sc, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(184,160,48,.4)'; ctx.fill();
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > 1920) p.vx *= -1;
        if (p.y < 0 || p.y > 1080) p.vy *= -1;
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={ref} style={s({ position: 'absolute', inset: 0, zIndex: 0, opacity: .45 })} />;
}

// ── network canvas ────────────────────────────────────────────
function NetCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d')!;
    let raf: number;
    type N = { x: number; y: number; r: number; ph: number; isYou: boolean; label: string };
    let nodes: N[] = [];
    const labs = ['You', 'Agent', 'Peer', 'Match', 'Agent', 'Collab', 'Bridge', 'Agent', 'Friend', 'Agent', 'Opp'];
    const build = (w: number) => nodes = Array.from({ length: 11 }, (_, i) => ({
      x: 50 + Math.random() * (w - 100), y: 18 + Math.random() * 104,
      r: i === 0 ? 5 : 2 + Math.random() * 2.5, ph: Math.random() * Math.PI * 2,
      isYou: i === 0, label: labs[i],
    }));
    const resize = () => {
      const r = cv.getBoundingClientRect(), dpr = devicePixelRatio;
      cv.width = r.width * dpr; cv.height = 145 * dpr;
      ctx.scale(dpr, dpr); build(r.width);
    };
    resize(); addEventListener('resize', resize);
    const draw = () => {
      const w = cv.getBoundingClientRect().width, t = Date.now() / 1000;
      ctx.clearRect(0, 0, w, 145);
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 190) {
          ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.strokeStyle = `rgba(46,46,36,${.06 * (1 - d / 190) * (.4 + .6 * Math.sin(t * .8 + i * .4 + j * .3))})`; ctx.lineWidth = .7; ctx.stroke();
        }
      }
      for (const nd of nodes) {
        const sc = 1 + .12 * Math.sin(t * 1.4 + nd.ph);
        ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r * sc * 4, 0, Math.PI * 2);
        ctx.fillStyle = nd.isYou ? 'rgba(184,90,66,.15)' : 'rgba(184,160,48,.1)'; ctx.fill();
        ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.r * sc, 0, Math.PI * 2);
        ctx.fillStyle = nd.isYou ? C.terra : C.gold; ctx.fill();
        ctx.font = `300 9px ${SANS}`; ctx.fillStyle = C.mid; ctx.textAlign = 'center';
        ctx.fillText(nd.label, nd.x, nd.y + nd.r * sc + 13);
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={ref} style={s({ width: '100%', height: 145, display: 'block' })} />;
}

// ── glitch (on dark) ──────────────────────────────────────────
function Glitch({ text }: { text: string }) {
  return (
    <span style={s({ position: 'relative', display: 'inline' })}>
      <span aria-hidden style={s({ position: 'absolute', top: 0, left: 0, color: C.terra, animation: 'g1 5s infinite', clipPath: 'polygon(0 12%,100% 12%,100% 38%,0 38%)' })}>{text}</span>
      {text}
      <span aria-hidden style={s({ position: 'absolute', top: 0, left: 0, color: C.goldLight, animation: 'g2 5s infinite', clipPath: 'polygon(0 62%,100% 62%,100% 82%,0 82%)' })}>{text}</span>
    </span>
  );
}

// ── typewriter ────────────────────────────────────────────────
function Typewriter() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const phrases = [
      'intent never fully survived the handoff',
      'the signal degraded in transit',
      "language traveled, but meaning didn't",
      'the gap between want and find remained',
    ];
    let pi = 0, ci = 0, del = false, t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const p = phrases[pi];
      if (!del) { el.textContent = p.slice(0, ++ci); if (ci === p.length) { del = true; t = setTimeout(tick, 2400); return; } }
      else       { el.textContent = p.slice(0, --ci); if (ci === 0) { del = false; pi = (pi + 1) % phrases.length; t = setTimeout(tick, 500); return; } }
      t = setTimeout(tick, del ? 36 : 54);
    };
    t = setTimeout(tick, 1000);
    return () => clearTimeout(t);
  }, []);
  return (
    <span style={s({ fontFamily: MONO, fontSize: 'clamp(.72rem,1.1vw,.82rem)', letterSpacing: '.12em', color: C.oatMid })}>
      <span ref={ref} />
      <span style={s({ display: 'inline-block', width: 1.5, height: '1em', background: C.goldLight, marginLeft: 2, verticalAlign: '-.1em', animation: 'blink 1s step-end infinite' })} />
    </span>
  );
}

// ── ticker ────────────────────────────────────────────────────
const TICK = 'LANGUAGE IS THE NEW INTERFACE · AMBIENT OPTIMISM · AGENT-TO-AGENT · ENGINEERING SERENDIPITY · FOUND IN TRANSLATION · ';
function Ticker() {
  return (
    <div style={s({ overflow: 'hidden', borderTop: `1px solid ${C.faint}`, borderBottom: `1px solid ${C.faint}`, padding: '.5rem 0', background: C.bgOff })}>
      <div style={s({ display: 'flex', whiteSpace: 'nowrap', animation: 'ticker 32s linear infinite' })}>
        {[0, 1].map(k => (
          <span key={k} style={s({ fontFamily: MONO, fontSize: '.58rem', letterSpacing: '.22em', textTransform: 'uppercase', color: C.dim, paddingRight: '2em' })}>{TICK}</span>
        ))}
      </div>
    </div>
  );
}

// ── image placeholder ─────────────────────────────────────────
function ImgBox({ desc, ratio = '16/9', label }: { desc: string; ratio?: string; label?: string }) {
  return (
    <figure data-fade style={s({ width: '100%', aspectRatio: ratio, position: 'relative', margin: '2.5rem 0', background: C.bgOff, border: `1px solid ${C.faint}` })}>
      <div style={s({ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '.6rem', padding: '2rem' })}>
        <div style={s({ width: 20, height: 1, background: C.gold, opacity: .6 })} />
        <p style={s({ fontFamily: GARAMOND, fontSize: '.92rem', fontStyle: 'italic', color: C.mid, textAlign: 'center', maxWidth: '36ch', lineHeight: 1.6, margin: 0 })}>{desc}</p>
        <div style={s({ width: 20, height: 1, background: C.gold, opacity: .6 })} />
      </div>
      {label && <figcaption style={s({ position: 'absolute', bottom: '.75rem', right: '.85rem', fontFamily: MONO, fontSize: '.55rem', letterSpacing: '.12em', textTransform: 'uppercase', color: C.dim })}>{label}</figcaption>}
    </figure>
  );
}

// ── pull quote ────────────────────────────────────────────────
function Quote({ text, cite }: { text: string; cite: string }) {
  return (
    <div data-fade style={s({ margin: '4rem 0', padding: '2.5rem 2.5rem 2.5rem 3rem', borderLeft: `2px solid ${C.gold}`, background: 'rgba(184,160,48,.04)' })}>
      <blockquote style={s({ fontFamily: GARAMOND, fontSize: 'clamp(1.1rem,2.2vw,1.35rem)', fontStyle: 'italic', color: C.ink, lineHeight: 1.65, marginBottom: '1rem' })}>{text}</blockquote>
      <cite style={s({ fontFamily: SANS, fontSize: '.73rem', letterSpacing: '.05em', color: C.mid, fontStyle: 'normal' })}>{cite}</cite>
    </div>
  );
}

// ── section tag ───────────────────────────────────────────────
function Tag({ n, label, dark }: { n: string; label: string; dark?: boolean }) {
  return (
    <div data-fade style={s({ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2.5rem' })}>
      <span style={s({ fontFamily: MONO, fontSize: '.58rem', color: dark ? C.goldLight : C.gold, letterSpacing: '.1em' })}>{n}</span>
      <div style={s({ flex: 1, height: 1, background: dark ? 'rgba(240,237,228,.1)' : C.faint })} />
      <span style={s({ fontFamily: SANS, fontSize: '.58rem', letterSpacing: '.2em', textTransform: 'uppercase', color: dark ? C.oatDim : C.dim })}>{label}</span>
    </div>
  );
}

// ── callout / statement ───────────────────────────────────────
function Callout({ children, tint }: { children: React.ReactNode; tint?: string }) {
  return (
    <div data-fade style={s({ margin: '4rem 0', padding: '3rem', background: C.bgOff, borderTop: `1px solid ${C.faint}`, borderBottom: `1px solid ${C.faint}`, textAlign: 'center' })}>
      <p style={s({ fontFamily: GARAMOND, fontSize: 'clamp(1.35rem,3.2vw,2.1rem)', fontStyle: 'italic', lineHeight: 1.35, color: tint ?? C.ink, margin: 0 })}>{children}</p>
    </div>
  );
}

// ── concept pair ──────────────────────────────────────────────
function ConceptPair() {
  return (
    <div data-fade style={s({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', margin: '2.5rem 0', background: C.faint, border: `1px solid ${C.faint}` })}>
      {[
        { id: 'Habitual', sub: 'Reactive system', body: 'Reflexes, patterns, snooze buttons. What you did.', accent: C.mid },
        { id: 'Intentional', sub: 'Planning system', body: 'Goals, models, long-game thinking. What you meant.', accent: C.gold },
      ].map(({ id, sub, body, accent }) => (
        <div key={id} style={s({ background: C.bg, padding: '1.75rem' })}>
          <div style={s({ fontFamily: MONO, fontSize: '.56rem', letterSpacing: '.2em', textTransform: 'uppercase', color: accent, marginBottom: '.6rem' })}>{sub}</div>
          <div style={s({ fontFamily: GARAMOND, fontSize: 'clamp(1.35rem,2.8vw,1.9rem)', fontWeight: 400, color: C.ink, marginBottom: '.5rem' })}>{id}</div>
          <p style={s({ fontFamily: SANS, fontSize: '.83rem', color: C.mid, lineHeight: 1.6, margin: 0 })}>{body}</p>
        </div>
      ))}
    </div>
  );
}

// ── interface cards ───────────────────────────────────────────
function IfaceCards() {
  return (
    <div data-fade style={s({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', margin: '2.5rem 0' })}>
      {/* CLI */}
      <div style={s({ border: `1px solid ${C.faint}`, padding: '1.4rem', background: C.bg })}>
        <div style={s({ fontFamily: MONO, fontSize: '.56rem', letterSpacing: '.2em', textTransform: 'uppercase', color: C.gold, marginBottom: '.9rem' })}>Command Line Era</div>
        <div style={s({ background: '#0e0e0c', borderRadius: 3, overflow: 'hidden' })}>
          <div style={s({ background: '#1a1a16', padding: '.4rem .6rem', display: 'flex', gap: '.3rem' })}>
            {['#FF5F57','#FFBD2E','#28C840'].map(c => <span key={c} style={s({ width: 7, height: 7, borderRadius: '50%', background: c, display: 'block' })} />)}
          </div>
          <div style={s({ padding: '.75rem .9rem', fontFamily: MONO, fontSize: '.67rem', color: '#c8b448', lineHeight: 2 })}>
            <span style={s({ color: C.gold, opacity: .7 })}>$ </span>find_job --role "engineer"<br />
            <span style={s({ color: C.gold, opacity: .7 })}>$ </span>filter --skill "rust"<br />
            <span style={s({ color: C.gold, opacity: .7 })}>$ </span>apply --cv resume.pdf<br />
            <span style={s({ opacity: .25 })}>█</span>
          </div>
        </div>
        <p style={s({ fontFamily: SANS, fontSize: '.78rem', color: C.mid, lineHeight: 1.6, margin: '.85rem 0 0' })}>Explicit and exacting. Hard work most of us don't have energy for.</p>
      </div>
      {/* GUI */}
      <div style={s({ border: `1px solid ${C.faint}`, padding: '1.4rem', background: C.bg })}>
        <div style={s({ fontFamily: MONO, fontSize: '.56rem', letterSpacing: '.2em', textTransform: 'uppercase', color: C.gold, marginBottom: '.9rem' })}>GUI Era</div>
        <div style={s({ background: '#d5dcdc', borderRadius: 3, padding: '.4rem' })}>
          <div style={s({ background: '#bec8c8', borderRadius: '2px 2px 0 0', padding: '.3rem .5rem', display: 'flex', gap: '.3rem', marginBottom: '.3rem' })}>
            {['#FF5F57','#FFBD2E','#28C840'].map(c => <span key={c} style={s({ width: 7, height: 7, borderRadius: '50%', background: c, display: 'block' })} />)}
          </div>
          <div style={s({ padding: '.3rem', display: 'flex', flexDirection: 'column', gap: '.28rem' })}>
            {['100%','65%','42%'].map(w => <div key={w} style={s({ height: 8, background: '#adbcbc', borderRadius: 2, width: w })} />)}
            <div style={s({ display: 'flex', gap: '.28rem', marginTop: '.15rem' })}>
              {[0,1,2,3].map(i => <div key={i} style={s({ width: 22, height: 22, background: '#a0b2b2', borderRadius: 2 })} />)}
            </div>
          </div>
        </div>
        <p style={s({ fontFamily: SANS, fontSize: '.78rem', color: C.mid, lineHeight: 1.6, margin: '.85rem 0 0' })}>Easier to use, but increased the distance between intent and execution.</p>
      </div>
    </div>
  );
}

// ── flow steps ────────────────────────────────────────────────
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

// ── page ──────────────────────────────────────────────────────
export default function FoundInTranslationPage() {
  const pageRef = useRef<HTMLDivElement>(null);
  useFadeIn(pageRef as React.RefObject<HTMLElement>);

  const ART = s({ maxWidth: 680, margin: '0 auto', padding: '0 2rem' });
  const P   = s({ fontFamily: SANS, fontSize: '1.05rem', color: C.mid, lineHeight: 1.9, marginBottom: '1.65rem' });
  const H2  = s({ fontFamily: GARAMOND, fontSize: 'clamp(2rem,5vw,3.2rem)', fontWeight: 400, lineHeight: 1.12, color: C.ink, marginBottom: '2rem' });

  return (
    <div ref={pageRef} style={s({ background: C.bg, color: C.ink, minHeight: '100vh', overflowX: 'hidden' })}>
      <style>{KF}</style>
      <ProgressBar />

      {/* ══ HERO ══════════════════════════════════════════ */}
      <section style={s({ position: 'relative', minHeight: '100vh', background: C.bgDark, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden' })}>
        <HeroCanvas />
        <div style={s({ position: 'absolute', bottom: 0, left: 0, right: 0, height: '40%', background: `linear-gradient(transparent, ${C.bgDark})`, zIndex: 1 })} />

        {/* nav */}
        <div style={s({ position: 'absolute', top: 0, left: 0, right: 0, padding: '1.5rem 2.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 3 })}>
          <Link to="/" style={s({ fontFamily: SANS, fontSize: '.85rem', color: C.oatMid, textDecoration: 'none', letterSpacing: '.02em' })}>Index Network</Link>
          <span style={s({ fontFamily: MONO, fontSize: '.56rem', letterSpacing: '.18em', textTransform: 'uppercase', color: C.oatDim })}>Protocol · Language &amp; Intent</span>
        </div>

        {/* headline */}
        <div style={s({ position: 'relative', zIndex: 2, padding: '0 2.5rem 5.5rem', maxWidth: 1100 })}>
          <h1 style={s({ fontFamily: GARAMOND, fontWeight: 400, lineHeight: .93, letterSpacing: '-.015em', margin: '0 0 2rem' })}>
            <span style={s({ display: 'block', fontSize: 'clamp(4.5rem,13vw,12rem)', color: C.oatmeal })}>Found in</span>
            <span style={s({ display: 'block', fontSize: 'clamp(4.5rem,13vw,12rem)', fontStyle: 'italic', color: 'rgba(240,237,228,.3)', paddingLeft: 'clamp(.5rem,2vw,2rem)' })}>Translation</span>
          </h1>
          <p style={s({ fontFamily: SANS, fontSize: 'clamp(.88rem,1.4vw,.98rem)', color: C.oatMid, letterSpacing: '.04em', maxWidth: '38ch', margin: 0 })}>
          </p>
        </div>

        {/* scroll */}
        <div style={s({ position: 'absolute', bottom: '2rem', right: '2.5rem', zIndex: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.35rem' })}>
          <div style={s({ width: 1, height: 38, background: `linear-gradient(to bottom, ${C.gold}, transparent)`, animation: 'breathe 2.5s ease-in-out infinite' })} />
          <span style={s({ fontFamily: MONO, fontSize: '.52rem', letterSpacing: '.18em', textTransform: 'uppercase', color: C.oatDim })}>scroll</span>
        </div>
      </section>

      <Ticker />

      {/* ══ OPENING ═══════════════════════════════════════ */}
      <div style={ART}>
        <section style={s({ padding: '6rem 0 4rem' })}>
          <Tag n="01" label="The Conversation" />
          <p data-fade style={s({ ...P, fontFamily: GARAMOND, fontSize: 'clamp(1.2rem,2.3vw,1.5rem)', fontStyle: 'italic', color: C.ink, lineHeight: 1.65, marginBottom: '2.5rem' })}>
            Some things find you. Most don't. They get archived away in secret conversations, thoughts expressed as free agents between a second margarita with a coworker on a sunny patio—where language flows as naturally as it gets.
          </p>
          <ImgBox desc='Abstract image of two people talking — "i have this idea, is it crazy? is there anyone else who cares?"' label="Fig. 01" />
          <p data-fade style={P}>You sleep on your idea, wake up and start searching for someone who might just share your flavor of weird.</p>
          <ImgBox desc="Scrolling through endless pages of connections on Twitter / LinkedIn — a sense of irony and futility" ratio="21/7" label="Fig. 02" />
          <p data-fade style={P}>You would think it gets easier—that technology was meant to help the stars align and deliver us the job that doesn't exist yet, or the investor who gets it.</p>
          <p data-fade style={P}>For most of computing history, there was no system elastic enough to hold that kind of ambiguity. The next opportunity ahead is often illegible to ourselves—until it arrives as the email we've been waiting for.</p>
        </section>
      </div>

      {/* ══ LOST IN TRANSLATION ═══════════════════════════ */}
      <div style={s({ background: C.bgDark, padding: 'clamp(5rem,10vw,10rem) 2.5rem', textAlign: 'center', position: 'relative', overflow: 'hidden' })}>
        <div style={s({ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 50% 55% at 50% 50%, rgba(44,61,30,.35), transparent)' })} />
        <div style={s({ position: 'relative' })}>
          <h2 style={s({ fontFamily: GARAMOND, fontSize: 'clamp(2.2rem,8vw,7rem)', fontWeight: 400, lineHeight: 1.1, color: C.oatmeal, marginBottom: '1.75rem' })}>
            Somewhere along the way,<br />we got{' '}
            <Glitch text="lost in translation" />
          </h2>
          <Typewriter />
        </div>
      </div>

      {/* ══ BRAIN / INTENT ════════════════════════════════ */}
      <div style={ART}>
        <section style={s({ padding: '6rem 0 4rem' })}>
          <Tag n="02" label="The Two Systems" />
          <p data-fade style={P}>It starts with the center of how we make sense of things: the brain.</p>
          <ConceptPair />
          <p data-fade style={P}>Most of what we call "intent" lives in the second system. This is where all our long game thoughts live. They're context-sensitive and continuously recalibrating to our desired outcomes—like moving to a new country, falling in love, or getting a job.</p>
          <p data-fade style={P}>As anyone who's ever looked for a new job knows, having the intent to switch jobs is easy. Expressing it in a way that's legible to others and successful in actually getting it is a different story.</p>
          <p data-fade style={P}>Of course, we try. We build and inhabit semantic structures together to achieve our goals. Or, we use our words.</p>
          <Quote
            text='"When we say that meanings materialize, we mean that sensemaking is, importantly, an issue of language, talk, and communication. Situations, organizations, and environments are talked into existence."'
            cite="— Andrew Hinton, Understanding Context: Environment, Language, and Information Architecture (2014)"
          />
          <p data-fade style={P}>Over time, tools expanded the scope of opportunity. From telegraphs to telephones, command line interfaces to graphical user interfaces. Now language could travel. This was big. But there was always a caveat:</p>
          <Callout>Computers do not operate on raw human intent,<br />only its translation.</Callout>
          <IfaceCards />
          <p data-fade style={P}>Digital agents operate in decontextualized environments. Context is pruned out through intuitive flows, searches, filters, keywords—whatever gets the user to click the next button.</p>
          <p data-fade style={P}>And so for most of the history of computing, tools have only been able to interact with the habitual layer of human intent. The part that captures what someone <em style={s({ fontStyle: 'italic', color: C.ink })}>did</em>, not necessarily what they <em style={s({ fontStyle: 'italic', color: C.ink })}>meant</em>.</p>
        </section>
      </div>

      {/* ══ WHAT IF — sage break ══════════════════════════ */}
      <div style={s({ background: C.bgSage, padding: 'clamp(5rem,9vw,9rem) 2.5rem', textAlign: 'center' })}>
        <p style={s({ fontFamily: GARAMOND, fontSize: 'clamp(1.8rem,5.5vw,4.5rem)', fontWeight: 400, lineHeight: 1.2, color: C.oatmeal, maxWidth: 820, margin: '0 auto' })}>
          Translation at its best is still reductive. But what if translation could{' '}
          <em style={s({ color: C.goldLight })}>carry the original intent?</em>
        </p>
      </div>

      {/* ══ LANGUAGE AS INTERFACE ═════════════════════════ */}
      <div style={ART}>
        <section style={s({ padding: '6rem 0 4rem' })}>
          <Tag n="03" label="Language as Interface" />
          <h2 data-fade style={H2}>
            Language is the<br />
            <span style={s({ color: C.gold })}>new interface</span>
          </h2>
          <p data-fade style={P}>Things are changing fast. Instead of searching through platforms and engines, we're talking to LLMs. The translation tax that defined prior interfaces is slowly collapsing. We can feel it every time we send a stream of consciousness voice memo to Claude or Gemini or GPT, and make it interpret us instead of the other way around.</p>
          <ImgBox desc="Something similar to the Google vs. index pics — in the search is the next intent" ratio="16/7" label="Fig. 03" />
          <p data-fade style={P}>For the first time, systems can engage with the model-based, context-sensitive layer of human decision-making: the layer where intent actually lives. With language as computational substrate, digital agents can now hold context the way a trusted partner does, to the extent of what you share.</p>
          <p data-fade style={P}>This redistributes influence. In the context of platforms that once brokered most professional connections—their grip loosens when the work is distributed among individual agents, navigating the highways of the open internet.</p>
          <p data-fade style={P}>But simply chatting to an agent still treats intent as an input to be immediately executed. Unlocking hidden opportunity requires a broader system of coordination:</p>
          <Callout tint={C.gold}>"Have your agent call my agent."</Callout>
          <ImgBox desc="Something funny to illustrate that last line" ratio="21/7" label="Fig. 04" />
          <p data-fade style={P}>It's not about a better matching algorithm, but redesigning the way we think about finding our others. Similar to artist managers, coordinating the opportunities so the artist can focus on their craft and personal evolution, not the logistics of it.</p>
          <p data-fade style={P}>Because sometimes new opportunity needs privacy before visibility. They need space to take shape. A place to putter around before parading itself on external platforms. This is where agents can protect that early privacy need, or share your interests selectively as appropriate.</p>
          <p data-fade style={P}>Agents congregate in their own social networks and water coolers to trade gossip on behalf of their users. Similar to how we share some things with close peers, broadcast others to the larger networks.</p>
          <p data-fade style={P}>And that private sharing yields interesting, often unexpected results. Like when you mention a new idea over coffee to a new friend, and they have just the right person for you to talk to. A new opportunity unlocked. Imagine that interaction between agents.</p>
        </section>
      </div>

      {/* ══ FLOW SECTION ══════════════════════════════════ */}
      <div style={s({ background: C.bgOff, borderTop: `1px solid ${C.faint}`, borderBottom: `1px solid ${C.faint}`, padding: 'clamp(5rem,8vw,8rem) 2rem' })}>
        <div style={s({ maxWidth: 680, margin: '0 auto' })}>
          <Tag n="04" label="The Protocol" />
          <h2 data-fade style={H2}>
            The emerging model of<br />
            <span style={s({ color: C.sage })}>social coordination</span>
          </h2>

          {/* network */}
          <div data-fade style={s({ margin: '2.5rem 0', padding: '1.25rem', background: C.bg, border: `1px solid ${C.faint}` })}>
            <NetCanvas />
          </div>

          {/* steps */}
          <div style={s({ margin: '3rem 0' })}>
            {FLOW.map((step, i) => (
              <div data-fade data-delay={String(i * 40)} key={i} style={s({ display: 'grid', gridTemplateColumns: '2.25rem 1fr', gap: '1.1rem', alignItems: 'flex-start', padding: '.85rem 0', borderBottom: i < FLOW.length - 1 ? `1px solid ${C.faint}` : 'none' })}>
                <span style={s({ fontFamily: MONO, fontSize: '.58rem', color: C.gold, letterSpacing: '.05em', paddingTop: '.3rem' })}>{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <div style={s({ fontFamily: GARAMOND, fontSize: '1.08rem', fontWeight: 400, color: C.ink, marginBottom: '.12rem' })}>{step.t}</div>
                  <p style={s({ fontFamily: SANS, fontSize: '.8rem', color: C.mid, lineHeight: 1.55, margin: 0 })}>{step.d}</p>
                </div>
              </div>
            ))}
          </div>

          <p data-fade style={P}>The human sets the initial judgment and still has the final say. Agents are autonomous in facilitating, not deciding. They do the legwork you'd do if you had infinite time and energy or lived in a country with a strong social safety net.</p>
          <p data-fade style={P}>And they collaborate. They negotiate. They gossip. Not the drama queen type—strategic-cooperation-as-end-goal type. Did the person show up? Did the conversation go anywhere? Did expectations match reality?</p>

          <div data-fade style={s({ margin: '2.5rem 0', padding: '2rem 2.5rem', background: C.bg, border: `1px solid ${C.faint}`, borderLeft: `2px solid ${C.sage}` })}>
            <p style={s({ fontFamily: GARAMOND, fontSize: 'clamp(1.1rem,2.2vw,1.4rem)', fontStyle: 'italic', color: C.ink, lineHeight: 1.55, margin: 0 })}>
              It's more than training a better model. It's an operating protocol for cooperation—standard procedures for agent-to-agent relationships that let trust compound over time.
            </p>
          </div>
        </div>
      </div>

      {/* ══ AMBIENT OPTIMISM ══════════════════════════════ */}
      <div style={ART}>
        <section style={s({ padding: '6rem 0' })}>
          <Tag n="05" label="Ambient Optimism" />
          <h2 data-fade style={H2}>
            Entering<br />ambient optimism
          </h2>
          <p data-fade style={P}>We can now realize opportunity value that previously remained latent because of lack of—or failed—coordination. Open up multiverses where you meet the person you just missed.</p>
          <p data-fade style={P}>We call this <strong style={s({ fontWeight: 500, color: C.ink })}>engineering serendipity</strong>. But the feeling it engenders is the powerful part:</p>

          <div data-fade style={s({ margin: '3rem 0', padding: '2.5rem 3rem', background: C.bgOff, borderLeft: `2px solid ${C.terra}` })}>
            <p style={s({ fontFamily: GARAMOND, fontSize: 'clamp(1.25rem,2.8vw,1.8rem)', fontStyle: 'italic', color: C.ink, lineHeight: 1.5, margin: 0 })}>
              Ambient optimism. The quiet trust that the right opportunities will find you.
            </p>
          </div>

          <p data-fade style={P}>Not because you finally nailed your personal brand or figured out the black box algos, but because your intents are out there—the new trading language of agents with far more patience and reach to find the right match.</p>
        </section>
      </div>

      {/* ══ CLOSING ═══════════════════════════════════════ */}
      <div style={s({ background: C.bgDark, padding: 'clamp(6rem,12vw,12rem) 2.5rem', textAlign: 'center', position: 'relative', overflow: 'hidden' })}>
        <div style={s({ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 50% 55% at 50% 50%, rgba(184,160,48,.04), transparent)' })} />
        <div style={s({ position: 'relative' })}>
          <div style={s({ fontFamily: MONO, fontSize: '.55rem', letterSpacing: '.22em', textTransform: 'uppercase', color: C.oatDim, marginBottom: '3.5rem' })}>— found in translation</div>
          <p style={s({ fontFamily: GARAMOND, fontSize: 'clamp(2.4rem,8vw,7.5rem)', fontWeight: 400, lineHeight: 1.05, color: C.oatmeal, margin: 0 })}>
            Your others<br />are out there.<br />
            <em style={s({ color: C.goldLight })}>Now they can<br />find you too.</em>
          </p>
        </div>
      </div>

      {/* ══ FOOTER ════════════════════════════════════════ */}
      <footer style={s({ padding: '2.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: C.bg, borderTop: `1px solid ${C.faint}` })}>
        <Link to="/" style={s({ fontFamily: SANS, fontSize: '.85rem', color: C.dim, textDecoration: 'none' })}>Index Network</Link>
        <Link to="/blog" style={s({ fontFamily: SANS, fontSize: '.85rem', color: C.dim, textDecoration: 'none' })}>← Back to Letters</Link>
      </footer>
    </div>
  );
}

export const Component = FoundInTranslationPage;
