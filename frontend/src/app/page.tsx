"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import ClientLayout from "@/components/ClientLayout";
import { useAuthContext } from "@/contexts/AuthContext";
import InboxContent from "@/components/InboxContent";

function LandingPage() {
  const discoveryVisualRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [subscribeStatus, setSubscribeStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  
  // Waitlist modal state
  const [isWaitlistOpen, setIsWaitlistOpen] = useState(false);
  const [waitlistForm, setWaitlistForm] = useState({
    name: "",
    email: "",
    whatYouDo: "",
    whoToMeet: "",
  });
  const [waitlistStatus, setWaitlistStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  
  // Retro modal state (easter egg)
  const [isRetroModalOpen, setIsRetroModalOpen] = useState(false);

  // Close modals on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isWaitlistOpen && waitlistStatus !== "loading") {
          setIsWaitlistOpen(false);
        }
        if (isRetroModalOpen) {
          setIsRetroModalOpen(false);
        }
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isWaitlistOpen, waitlistStatus, isRetroModalOpen]);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    
    setSubscribeStatus("loading");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, type: "newsletter" }),
      });
      if (res.ok) {
        setSubscribeStatus("success");
        setEmail("");
      } else {
        setSubscribeStatus("error");
      }
    } catch {
      setSubscribeStatus("error");
    }
  };

  const handleWaitlistSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waitlistForm.email || !waitlistForm.name) return;
    
    setWaitlistStatus("loading");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: waitlistForm.email,
          type: "waitlist",
          name: waitlistForm.name,
          whatYouDo: waitlistForm.whatYouDo,
          whoToMeet: waitlistForm.whoToMeet,
        }),
      });
      if (res.ok) {
        setWaitlistStatus("success");
      } else {
        setWaitlistStatus("error");
      }
    } catch {
      setWaitlistStatus("error");
    }
  };

  useEffect(() => {
    const container = discoveryVisualRef.current;
    if (!container) return;

    const nodeCount = 30;
    const minDist = 12;
    const activationMinDist = 25;
    const nodes: Array<{
      el: HTMLDivElement;
      wrapper: HTMLDivElement;
      bubble: HTMLDivElement;
      x: number;
      y: number;
      bx: number;
      by: number;
      bw: number;
      bh: number;
    }> = [];
    const positions: Array<{ x: number; y: number }> = [];

    const intents = [
      "Building a CPG company with someone who also hates performative hustle",
      "Having like-minded peers to think through an early startup idea",
      "Looking for a co-founder or partner who shares my growth principles",
      "Finding a technical co-founder who shares my vision for climate tech",
      "Looking for a thoughtful design partner",
      "Finding collaborators who share my passion for sustainable innovation",
      "I want to build something but I don't have an idea",
      "Seeking someone to collaborate on AI infrastructure",
      "Looking for an advisor with fintech experience",
      "Finding early believers for a dev tools startup",
    ];

    const bubbleW = 200,
      bubbleH = 100;

    for (let i = 0; i < nodeCount; i++) {
      let x: number,
        y: number,
        valid: boolean,
        attempts = 0;
      do {
        x = 5 + Math.random() * 90;
        y = 5 + Math.random() * 90;
        valid = positions.every((p) => {
          const dx = p.x - x,
            dy = p.y - y;
          return Math.sqrt(dx * dx + dy * dy) >= minDist;
        });
        attempts++;
      } while (!valid && attempts < 100);

      positions.push({ x, y });

      const wrapper = document.createElement("div");
      wrapper.className = "node-wrapper";
      wrapper.style.cssText = `position: absolute; left: ${x}%; top: ${y}%;`;

      const node = document.createElement("div");
      node.className = "discovery-node";
      wrapper.appendChild(node);

      const bubble = document.createElement("div");
      bubble.className = "intent-bubble";
      bubble.innerHTML =
        '<span class="dot"></span>' + intents[i % intents.length];

      const containerW = container.offsetWidth || 500;
      const containerH = container.offsetHeight || 500;
      const nodeX = (x / 100) * containerW;
      const nodeY = (y / 100) * containerH;

      let bx: number, by: number;

      if (nodeX + 15 + bubbleW > containerW - 10) {
        bubble.style.right = "12px";
        bx = x - (bubbleW / containerW) * 100;
      } else {
        bubble.style.left = "12px";
        bx = x + 3;
      }

      if (nodeY + 10 + bubbleH > containerH - 10) {
        bubble.style.bottom = "12px";
        by = y - (bubbleH / containerH) * 100;
      } else {
        bubble.style.top = "-4px";
        by = y;
      }

      wrapper.appendChild(bubble);
      container.appendChild(wrapper);
      nodes.push({
        el: node,
        wrapper,
        bubble,
        x,
        y,
        bx,
        by,
        bw: (bubbleW / containerW) * 100,
        bh: (bubbleH / containerH) * 100,
      });
    }

    function dist(
      a: { x: number; y: number },
      b: { x: number; y: number }
    ) {
      const dx = a.x - b.x,
        dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function bubblesOverlap(
      a: { bx: number; by: number; bw: number; bh: number },
      b: { bx: number; by: number; bw: number; bh: number }
    ) {
      return !(
        a.bx + a.bw < b.bx ||
        b.bx + b.bw < a.bx ||
        a.by + a.bh < b.by ||
        b.by + b.bh < a.by
      );
    }

    let timeoutId: ReturnType<typeof setTimeout>;

    function activateSequence() {
      const count = 2 + Math.floor(Math.random() * 2);
      const available = nodes.filter(
        (n) => !n.el.classList.contains("active")
      );
      const toActivate: typeof nodes = [];

      for (let i = available.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [available[i], available[j]] = [available[j], available[i]];
      }

      for (const candidate of available) {
        if (toActivate.length >= count) break;
        const farEnough = toActivate.every(
          (n) => dist(n, candidate) >= activationMinDist
        );
        const noOverlap = toActivate.every(
          (n) => !bubblesOverlap(n, candidate)
        );
        if (farEnough && noOverlap) {
          toActivate.push(candidate);
        }
      }

      toActivate.forEach((node) => {
        node.el.classList.add("active");
        node.bubble.classList.add("visible");
      });

      setTimeout(() => {
        toActivate.forEach((node) => {
          node.el.classList.remove("active");
          node.bubble.classList.remove("visible");
        });
      }, 2200);
    }

    function loop() {
      activateSequence();
      timeoutId = setTimeout(loop, 2600 + Math.random() * 400);
    }

    const initTimeout = setTimeout(() => loop(), 500);

    return () => {
      clearTimeout(initTimeout);
      clearTimeout(timeoutId);
      // Clean up created elements
      nodes.forEach((n) => n.wrapper.remove());
    };
  }, []);

  return (
    <ClientLayout hideFeedback>
      <style jsx global>{`
        .landing-page {
          font-family: 'Hanken Grotesk', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        .landing-page p.text-lg {
          font-family: 'Hanken Grotesk', -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 14px;
        }

        /* Floating Ideas in Background */
        .floating-ideas {
          position: relative;
          width: 100%;
          height: 500px;
          z-index: 1;
          background: radial-gradient(ellipse at center, rgba(1, 119, 255, 0.04) 0%, rgba(1, 119, 255, 0.01) 40%, transparent 70%);
          overflow: hidden;
        }

        /* Discovery Nodes */
        .discovery-node {
          width: 8px;
          height: 8px;
          background: #aab5c4;
          border-radius: 50%;
          opacity: 0.4;
          transition: all 0.4s ease;
        }

        .discovery-node.active {
          width: 24px;
          height: 24px;
          margin: -8px 0 0 -8px;
          opacity: 1;
          background: #0177FF;
          border-radius: 50%;
          box-shadow: 0 0 16px rgba(1, 119, 255, 0.6);
        }

        /* Intent Bubbles */
        .intent-bubble {
          position: absolute;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 0.75rem;
          color: #222222;
          background: rgba(255, 255, 255, 0.95);
          border: 1px solid rgba(1, 119, 255, 0.3);
          padding: 0.6rem 0.85rem;
          border-radius: 3px;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.3s ease;
          z-index: 10;
          width: 200px;
          white-space: normal;
          line-height: 1.4;
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
        }

        .intent-bubble.visible { opacity: 1; }

        .intent-bubble .dot {
          display: inline-block;
          width: 6px;
          height: 6px;
          background: #0177FF;
          border-radius: 50%;
          margin-right: 8px;
          vertical-align: middle;
          box-shadow: 0 0 6px rgba(1, 119, 255, 0.5);
        }

        /* Agents */
        .agent-container {
          position: absolute;
          width: 40px;
          height: 40px;
          filter: drop-shadow(0 0 12px rgba(1, 119, 255, 0.5));
        }

        .agent-core {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 12px;
          height: 12px;
          background: #0177FF;
          border-radius: 50%;
          box-shadow: 0 0 16px rgba(1, 119, 255, 0.6);
          animation: agentPulse 1.5s ease-in-out infinite;
        }

        .agent-ring {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          border: 2px solid rgba(1, 119, 255, 0.6);
          border-radius: 50%;
          animation: agentRing 2s ease-out infinite;
        }

        .agent-1 { animation: agentMove1 14s ease-in-out infinite; }
        .agent-2 { animation: agentMove2 18s ease-in-out infinite; }
        .agent-3 { animation: agentMove3 11s ease-in-out infinite; }

        @keyframes agentPulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1); }
          50% { transform: translate(-50%, -50%) scale(1.4); }
        }

        @keyframes agentRing {
          0% { width: 12px; height: 12px; opacity: 0.8; }
          100% { width: 62px; height: 62px; opacity: 0; }
        }

        @keyframes agentMove1 {
          0%, 100% { left: 8%; top: 18%; }
          20% { left: 25%; top: 55%; }
          40% { left: 55%; top: 25%; }
          60% { left: 75%; top: 60%; }
          80% { left: 40%; top: 75%; }
        }

        @keyframes agentMove2 {
          0%, 100% { left: 85%; top: 25%; }
          25% { left: 60%; top: 70%; }
          50% { left: 20%; top: 45%; }
          75% { left: 45%; top: 15%; }
        }

        @keyframes agentMove3 {
          0%, 100% { left: 50%; top: 80%; }
          17% { left: 15%; top: 35%; }
          33% { left: 70%; top: 20%; }
          50% { left: 90%; top: 55%; }
          67% { left: 35%; top: 65%; }
          83% { left: 65%; top: 40%; }
        }

        /* Button Style */
        .btn-modern {
          background-color: black !important;
          color: white !important;
          border: none !important;
          border-radius: 2px !important;
          padding: 12px 20px !important;
          font-weight: 600 !important;
          font-size: 14px !important;
          display: inline-flex !important;
          align-items: center !important;
          gap: 8px !important;
          transition: all 0.2s ease !important;
          text-decoration: none !important;
          cursor: pointer !important;
        }

        .btn-modern:hover {
          background-color: #333 !important;
          transform: translateY(-1px);
        }

        .btn-modern::after {
          content: '';
          width: 16px;
          height: 16px;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='white' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M13 7l5 5m0 0l-5 5m5-5H6'/%3E%3C/svg%3E");
          background-size: contain;
          background-repeat: no-repeat;
          background-position: center;
          display: inline-block;
          flex-shrink: 0;
        }

        /* Link-style button */
        .btn-link {
          background-color: transparent !important;
          color: #0078FF !important;
          border: none !important;
          border-radius: 0 !important;
          padding: 0 !important;
          font-weight: 600 !important;
          font-size: 14px !important;
          display: inline-flex !important;
          align-items: center !important;
          gap: 8px !important;
          transition: all 0.2s ease !important;
          text-decoration: underline !important;
          text-underline-offset: 4px !important;
          cursor: pointer !important;
        }

        .btn-link:hover {
          color: #0066DD !important;
        }

        .btn-link::after {
          content: '';
          width: 16px;
          height: 16px;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%230078FF' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14'/%3E%3C/svg%3E");
          background-size: contain;
          background-repeat: no-repeat;
          background-position: center;
          display: inline-block;
          flex-shrink: 0;
          transition: all 0.2s ease;
        }

        .btn-link:hover::after {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%230066DD' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14'/%3E%3C/svg%3E");
        }

        @media (max-width: 768px) {
          .floating-ideas {
            height: 300px !important;
          }
          .intent-bubble {
            width: 160px;
            font-size: 0.65rem;
          }
        }

        /* Retro Modal Styles */
        .retro-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
        }

        .retro-modal {
          background: #C0C0C0;
          border: 2px outset #C0C0C0;
          box-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
          min-width: 320px;
          max-width: 400px;
        }

        .retro-title-bar {
          background: #0000FF;
          color: white;
          padding: 4px 8px;
          font-weight: bold;
          font-size: 11px;
          border-bottom: 1px solid #000;
          display: flex;
          align-items: center;
          height: 20px;
          box-shadow: inset -1px -1px 0 #000080, inset 1px 1px 0 #8080FF;
        }

        .retro-title-text {
          text-shadow: 1px 1px 0 rgba(0, 0, 0, 0.3);
          letter-spacing: 0.5px;
        }

        .retro-content {
          background: #C0C0C0;
          padding: 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
        }

        .retro-icon {
          width: 32px;
          height: 32px;
          background: #FFFF00;
          border: 2px solid #000;
          border-radius: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 24px;
          color: #000;
          box-shadow: inset -2px -2px 0 #808000, inset 2px 2px 0 #FFFF80;
          align-self: flex-start;
          margin-left: 8px;
        }

        .retro-message {
          font-size: 13px;
          color: #000;
          text-align: left;
          line-height: 1.4;
          width: 100%;
          padding: 0 8px;
        }

        .retro-button {
          background: #C0C0C0;
          border: 2px outset #C0C0C0;
          padding: 4px 16px;
          font-size: 11px;
          font-weight: bold;
          color: #000;
          cursor: pointer;
          box-shadow: inset -1px -1px 0 #808080, inset 1px 1px 0 #FFFFFF;
          outline: 2px dotted #000;
          outline-offset: 2px;
        }

        .retro-button:hover {
          background: #D4D4D4;
        }

        .retro-button:active {
          border: 2px inset #C0C0C0;
          box-shadow: inset 1px 1px 0 #808080, inset -1px -1px 0 #FFFFFF;
        }

        /* Break out of parent container to be full width */
        .landing-page {
          width: 100vw;
          margin-left: calc(-50vw + 50%);
          margin-right: calc(-50vw + 50%);
        }
      `}</style>

      <div className="landing-page flex flex-col min-h-screen -mt-16">
        {/* Waitlist Modal */}
        {isWaitlistOpen && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="waitlist-modal-title"
            onClick={() => waitlistStatus !== "loading" && setIsWaitlistOpen(false)}
          >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />
            
            {/* Modal */}
            <div 
              className="relative bg-white w-full max-w-md p-8 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <button
                onClick={() => setIsWaitlistOpen(false)}
                className="absolute top-4 right-4 text-gray-400 hover:text-black transition-colors"
                disabled={waitlistStatus === "loading"}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {waitlistStatus === "success" ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-[#0177FF] rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 id="waitlist-modal-title" className="text-2xl font-garamond text-black mb-2">You&apos;re on the list!</h3>
                  <p className="text-gray-600 text-[15px]">We&apos;ll be in touch when we&apos;re ready for you.</p>
                  <button
                    onClick={() => {
                      setIsWaitlistOpen(false);
                      setWaitlistStatus("idle");
                      setWaitlistForm({ name: "", email: "", whatYouDo: "", whoToMeet: "" });
                    }}
                    className="mt-6 text-[#0177FF] hover:underline text-sm font-medium"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <>
                  <h3 id="waitlist-modal-title" className="text-2xl font-garamond text-black mb-2">Join the waitlist</h3>
                  <p className="text-gray-600 text-[15px] mb-6">
                    Tell us a bit about yourself! We&apos;ll let you know when we&apos;re live and keep you posted on updates.
                  </p>

                  <form onSubmit={handleWaitlistSubmit} className="space-y-4">
                    <div>
                      <label htmlFor="waitlist-name" className="block text-sm font-medium text-black mb-1.5">
                        Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        id="waitlist-name"
                        value={waitlistForm.name}
                        onChange={(e) => setWaitlistForm({ ...waitlistForm, name: e.target.value })}
                        className="w-full border border-gray-300 px-3 py-2.5 text-[15px] text-black focus:outline-none focus:border-[#0177FF] transition-colors rounded-sm"
                        required
                        disabled={waitlistStatus === "loading"}
                      />
                    </div>

                    <div>
                      <label htmlFor="waitlist-email" className="block text-sm font-medium text-black mb-1.5">
                        Email <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        id="waitlist-email"
                        value={waitlistForm.email}
                        onChange={(e) => setWaitlistForm({ ...waitlistForm, email: e.target.value })}
                        className="w-full border border-gray-300 px-3 py-2.5 text-[15px] text-black focus:outline-none focus:border-[#0177FF] transition-colors rounded-sm"
                        required
                        disabled={waitlistStatus === "loading"}
                      />
                    </div>

                    <div>
                      <label htmlFor="waitlist-whatYouDo" className="block text-sm font-medium text-black mb-1.5">
                        What do you do?
                      </label>
                      <p className="text-xs text-gray-500 mb-1.5">Just to understand you a bit better.</p>
                      <input
                        type="text"
                        id="waitlist-whatYouDo"
                        value={waitlistForm.whatYouDo}
                        onChange={(e) => setWaitlistForm({ ...waitlistForm, whatYouDo: e.target.value })}
                        className="w-full border border-gray-300 px-3 py-2.5 text-[15px] text-black focus:outline-none focus:border-[#0177FF] transition-colors rounded-sm"
                        disabled={waitlistStatus === "loading"}
                      />
                    </div>

                    <div>
                      <label htmlFor="waitlist-whoToMeet" className="block text-sm font-medium text-black mb-1.5">
                        Who do you want to meet?
                      </label>
                      <p className="text-xs text-gray-500 mb-1.5">
                        E.g., &quot;Founders building in climate tech,&quot; &quot;Someone who&apos;s scaled a consumer AI product&quot;
                      </p>
                      <textarea
                        id="waitlist-whoToMeet"
                        value={waitlistForm.whoToMeet}
                        onChange={(e) => setWaitlistForm({ ...waitlistForm, whoToMeet: e.target.value })}
                        rows={3}
                        className="w-full border border-gray-300 px-3 py-2.5 text-[15px] text-black focus:outline-none focus:border-[#0177FF] transition-colors rounded-sm resize-none"
                        disabled={waitlistStatus === "loading"}
                      />
                    </div>

                    {waitlistStatus === "error" && (
                      <p className="text-red-500 text-sm">Something went wrong. Please try again.</p>
                    )}

                    <button
                      type="submit"
                      disabled={waitlistStatus === "loading"}
                      className="w-full bg-black text-white py-3 text-sm font-semibold uppercase tracking-wider hover:bg-[#333] transition-colors disabled:opacity-50 rounded-sm"
                    >
                      {waitlistStatus === "loading" ? "Submitting..." : "Join the waitlist"}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        )}

        {/* Hero Section */}
        <section
          className="hero-section relative px-6 lg:px-12 pt-24 lg:pt-4 pb-8 lg:pb-0 min-h-[auto] lg:min-h-[90vh] overflow-hidden w-full"
        >
          <div className="max-w-[960px] mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-24 items-center">
            {/* Main content */}
            <div className="hero-content relative z-10 text-center lg:text-left max-w-full lg:max-w-[520px] mx-auto lg:mx-0 order-1">
              <h1
                className="text-[40px] md:text-[52px] lg:text-[60px] leading-none text-black mb-4 lg:mb-6 font-garamond mx-auto lg:mx-0"
                style={{ fontWeight: 200, letterSpacing: "0.25px", width: "fit-content" }}
              >
                Meet your next <br />idea partner
              </h1>

              <p
                className="text-[16px] leading-relaxed text-black/80 mb-8 lg:mb-10 max-w-[480px] mx-auto lg:mx-0 font-normal"
                style={{ fontFamily: "'Hanken Grotesk', -apple-system, BlinkMacSystemFont, sans-serif" }}
              >
                You know that moment when you meet the right person and your next move clicks into place? That sense of magic? It&apos;s time to find your others without having to try so hard.
              </p>

              <div
                className="btn-container flex gap-0 mb-6 max-w-[450px] bg-[#F4F7F6] mx-auto lg:mx-0"
                style={{ width: "fit-content" }}
              >
                <button
                  onClick={() => setIsWaitlistOpen(true)}
                  className="btn-modern whitespace-nowrap uppercase tracking-wider no-underline"
                  style={{ boxShadow: "none" }}
                >
                  Join the waitlist
                </button>
              </div>
            </div>

            {/* Illustration */}
            <div className="hero-illustration relative z-10 flex items-center justify-center w-full h-full min-h-[300px] lg:min-h-[700px] order-2">
              <Image
                src="/collab.png"
                alt="Collaboration illustration"
                width={600}
                height={600}
                className="w-full max-w-[320px] lg:max-w-full h-auto object-contain lg:scale-105"
              />
            </div>
          </div>
        </section>

        {/* Ambient Discovery Demo Section */}
        <section className="demo-section py-12 lg:py-24 px-6 lg:px-12 bg-[#F4F7F6] relative overflow-hidden">
          <div className="max-w-[960px] mx-auto">
            <h2
              className="text-[32px] md:text-[36px] font-garamond font-normal text-black mb-4 leading-tight text-center"
            >
              Ambient discovery that works for you
            </h2>
            <p
              className="text-center text-black/80 mb-6 text-[16px] leading-relaxed font-normal max-w-[560px] mx-auto"
              style={{ fontFamily: "'Hanken Grotesk', -apple-system, BlinkMacSystemFont, sans-serif" }}
            >
              Share your intent privately, sit back, fiddle with it, and let people surface when their wavelength aligns with yours. No searching or filtering needed.
            </p>

            {/* Timeline visualization */}
            <div className="ambient-timeline relative">
              {/* Timeline line */}
              <div className="timeline-line absolute left-6 md:left-8 top-0 bottom-0 w-px bg-gradient-to-b from-[#E5E5E5] via-[#0177FF] to-[#E5E5E5]"></div>

              {/* Step 1: You share intent */}
              <div className="timeline-item flex gap-4 md:gap-6 mb-4 relative">
                <div className="timeline-dot flex-shrink-0 w-12 md:w-16 flex items-center justify-center">
                  <div className="w-3 h-3 rounded-full bg-[#0177FF]"></div>
                </div>
                <div className="flex-1 pb-2">
                  <div className="text-[11px] uppercase tracking-widest text-[#999] font-mono mb-2">3 days ago</div>
                  <div className="bg-white border border-[#E5E5E5] rounded-md p-4">
                    <div className="flex items-center gap-3 mb-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop&crop=face"
                        alt="You"
                        className="w-10 h-10 rounded-full object-cover"
                      />
                      <div className="text-[14px] text-[#666] font-sans">
                        <span className="font-medium text-black">You</span> shared an intent
                      </div>
                    </div>
                    <p className="text-[15px] leading-relaxed text-[#333] font-sans">
                      ready to build something again. spent the last 4 years scaling ops from 5 to 50, learned a lot about what actually works. looking for founders who needs an ops leader who&apos;s been in the trenches.
                    </p>
                    <div className="flex items-center gap-2 bg-[#F4F7F6] border border-[#E5E5E5] rounded mt-1 p-1 w-fit">
                      <svg className="w-4 h-4 text-[#666]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                      <span className="text-[13px] text-[#666] font-mono">deck.pdf</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Step 2: Agent working in background */}
              <div className="timeline-item flex gap-2 md:gap-6 mb-4 relative">
                <div className="timeline-dot flex-shrink-0 w-12 md:w-16 flex items-center justify-center">
                  <div className="w-3 h-3 rounded-full bg-[#E5E5E5]"></div>
                </div>
                <div className="flex-1 pb-2">
                  <div className="text-[11px] uppercase tracking-widest text-[#999] font-mono mb-2">In the background</div>
                  <div className="text-[15px] text-[#888] italic font-sans">
                    Agents continuously compare intents across the network, looking for semantic resonance...
                  </div>
                </div>
              </div>

              {/* Step 3: Someone else shares */}
              <div className="timeline-item flex gap-4 md:gap-6 mb-4 relative">
                <div className="timeline-dot flex-shrink-0 w-12 md:w-16 flex items-center justify-center">
                  <div className="w-3 h-3 rounded-full bg-[#E5E5E5]"></div>
                </div>
                <div className="flex-1 pb-2">
                  <div className="text-[11px] uppercase tracking-widest text-[#999] font-mono mb-2">Yesterday</div>
                  <div className="text-[14px] text-[#666] font-sans mb-2">
                    <span className="font-medium text-black">Someone in the network</span> shared an intent
                  </div>
                  <div className="text-[15px] text-[#888] italic font-sans">
                    &quot;need someone who&apos;s scaled ops for series A-C before. i&apos;m not looking for pedigree, just tried and true expertise. also not a consultant or advisor, but someone who wants to get in the weeds again FT. so many things breaking as we grow.&quot;
                  </div>
                </div>
              </div>

              {/* Step 4: Match surfaces */}
              <div className="timeline-item flex gap-4 md:gap-6 relative">
                <div className="timeline-dot flex-shrink-0 w-12 md:w-16 flex items-center justify-center">
                  <div className="w-5 h-5 rounded-full bg-[#0177FF] flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                </div>
                <div className="flex-1">
                  <div className="text-[11px] uppercase tracking-widest text-[#999] font-mono mb-2">WAITING FOR ACTION</div>
                  <div className="bg-white border border-[#E5E5E5] rounded-md px-4 py-4 shadow-sm">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
                      <div className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=100&h=100&fit=crop&crop=face"
                          alt="Nicole"
                          className="w-10 h-10 rounded-full object-cover"
                        />
                        <div>
                          <div className="text-[14px] font-bold text-black font-mono">Nicole Ng</div>
                          <div className="text-[12px] text-[#666] font-mono">1 mutual intent</div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => setIsRetroModalOpen(true)}
                          className="bg-black text-white px-3 py-1.5 rounded-sm text-[12px] font-medium hover:bg-[#333] transition-colors font-mono"
                        >
                          Start a conversation
                        </button>
                        <div className="relative group">
                          <button className="bg-[#F4F7F6] border border-[#E5E5E5] text-black px-3 py-1.5 rounded-sm text-[12px] font-medium hover:bg-[#F5F5F5] transition-colors font-mono">
                            Skip
                          </button>
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-black text-white text-[11px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none font-mono">
                            It&apos;s the other button 👀
                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-black"></div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <p className="text-[15px] leading-relaxed text-[#333] font-sans">
                      You want out of big company politics and back to building. Nicole just closed series A for a warehouse robotics company and is hitting the growing pains you know too well. She wants someone who&apos;s already scaled a hardware ops team from 5 to 50. Your last four years were exactly that.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Manifesto Section */}
        <section
          className="py-12 lg:py-16 px-6 lg:px-12 relative overflow-hidden"
        >
          <div className="max-w-[960px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center">
            {/* Graph */}
            <div className="order-2 lg:order-1">
              <div className="floating-ideas" ref={discoveryVisualRef}>
                <div className="agent-container agent-1">
                  <div className="agent-core"></div>
                  <div className="agent-ring"></div>
                </div>
                <div className="agent-container agent-2">
                  <div className="agent-core"></div>
                  <div className="agent-ring"></div>
                </div>
                <div className="agent-container agent-3">
                  <div className="agent-core"></div>
                  <div className="agent-ring"></div>
                </div>
              </div>
            </div>
            {/* Text */}
            <div className="order-1 lg:order-2 text-left">
              <h2
                className="text-[32px] md:text-[36px] font-garamond font-normal text-black mb-8 leading-tight"
              >
                They&apos;re closer than you think
              </h2>
              <div className="mb-8">
                <p
                  className="text-[16px] leading-relaxed text-black/80 mb-6 font-normal"
                  style={{ fontFamily: "'Hanken Grotesk', -apple-system, BlinkMacSystemFont, sans-serif" }}
                >
                  You&apos;ve been here before. Something new is brewing inside you—maybe it&apos;s just an inkling, maybe it&apos;s a full-fledged idea. Either way, you need others to help it take shape. Others who can be your teammates and patrons, whetstones and cheerleaders.
                </p>

                <p
                  className="text-[16px] leading-relaxed text-black/80 mb-6 font-normal"
                  style={{ fontFamily: "'Hanken Grotesk', -apple-system, BlinkMacSystemFont, sans-serif" }}
                >
                  You&apos;ve got platforms to post, share, search, and shout. But despite the flood of tools, you&apos;re still stuck trying to meet someone who shares your flavor of weird. How is it still this hard to find your others?
                </p>

                <p
                  className="text-[16px] leading-relaxed text-black/80 font-normal"
                  style={{ fontFamily: "'Hanken Grotesk', -apple-system, BlinkMacSystemFont, sans-serif" }}
                >
                  Meet Index. Instead of shouting into the void, now you can just say the word, and LLM-enabled agents will run ambient discovery based on the shape of what you meant. It&apos;s not that the people you&apos;re looking for don&apos;t exist. They do, and they&apos;re closer than you think.
                </p>
              </div>

              <div className="mt-5">
                <a href="https://blog.index.network" target="_blank" rel="noopener noreferrer" className="btn-link uppercase tracking-wider font-mono">
                  Read the story
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Community + Testimonial Section */}
        <section className="py-20 lg:py-28 px-6 lg:px-12 relative overflow-hidden bg-[#F4F7F6]">
          <div className="max-w-[960px] mx-auto relative z-10">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
              {/* Left: Community CTA */}
              <div className="flex flex-col justify-center">
                <h2
                  className="text-[32px] md:text-[36px] font-garamond font-normal text-black mb-8 leading-tight"
                >
                  Build a community where the magic compounds
                </h2>

                <p
                  className="text-[16px] leading-relaxed text-black/80 mb-8 font-normal"
                  style={{ fontFamily: "'Hanken Grotesk', -apple-system, BlinkMacSystemFont, sans-serif" }}
                >
                  Are you a community or ecosystem leader? We&apos;re opening early access to leaders looking to engineer serendipity.
                </p>

                <div>
                  <button
                    onClick={() => setIsWaitlistOpen(true)}
                    className="btn-modern no-underline uppercase tracking-wider font-mono"
                  >
                    Get in touch
                  </button>
                </div>
              </div>

              {/* Right: Testimonial */}
              <div className="flex gap-5 items-start lg:border-l lg:border-[#E5E5E5] lg:pl-12">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="vivek.jpg"
                  alt="Vivek Singh"
                  className="w-[70px] h-[85px] md:w-[90px] md:h-[110px] object-cover flex-shrink-0"
                />
                <div>
                  <p
                    className="text-[17px] md:text-[19px] lg:text-[21px] leading-[1.4] text-black font-garamond mb-4"
                    style={{ fontWeight: 400 }}
                  >
                    &quot;The challenge with social discovery today is that you have to believe that the system is working in your favor — that you will be better for having experienced it.&quot;
                  </p>
                  <div className="text-[13px] font-semibold text-black">Vivek Singh</div>
                  <div className="text-[12px] text-[#666]">Director, Kernel</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Open Source Section */}
        <section
          className="w-full py-16 px-6 lg:px-12 relative overflow-hidden"
        >
          <div className="max-w-[960px] mx-auto text-center">
            <h2
              className="text-[32px] md:text-[36px] font-garamond font-normal text-black mb-8 leading-tight"
            >
              We&apos;re building in the open
            </h2>
            <p
              className="text-[16px] leading-relaxed text-black/80 mb-8 font-normal max-w-[700px] mx-auto"
              style={{ fontFamily: "'Hanken Grotesk', -apple-system, BlinkMacSystemFont, sans-serif" }}
            >
              Index is an open-source social protocol. No permission required.
            </p>
            <div className="flex items-center justify-center gap-6 flex-wrap">
              <a
                href="https://github.com/indexnetwork/index"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-3 bg-[#2D2D2D] hover:bg-[#3D3D3D] text-white px-4 py-2.5 rounded-sm transition-all duration-300"
              >
                <svg className="w-5 h-5" fill="#9CA3AF" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                <span className="text-sm font-normal">@indexnetwork</span>
              </a>
              <a
                href="https://github.com/indexnetwork/index"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#555] hover:text-black transition-colors font-mono text-[13px] uppercase tracking-wider"
              >
                Contribute →
              </a>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer
          className="text-white py-8 px-6 lg:px-12 border-t-4 border-black relative overflow-hidden"
          style={{ backgroundColor: "#0a0a0a" }}
        >
          <div className="max-w-[1200px] mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Left Column: Logo + Links */}
              <div>
                <div className="mb-6">
                  <a href="/" aria-label="Index Network Home">
                    <Image
                      src="/logo.svg"
                      alt="Index Network"
                      width={100}
                      height={24}
                      className="h-6 brightness-0 invert object-contain"
                      style={{ width: "auto" }}
                    />
                  </a>
                </div>
                <nav className="flex gap-12" aria-label="Footer navigation">
                  <div>
                    <ul className="list-none p-0 m-0">
                      <li className="mb-3">
                        <a href="https://blog.index.network" className="text-[#CCC] no-underline text-[14px] transition-colors font-normal hover:text-white">
                          Blog
                        </a>
                      </li>
                    </ul>
                  </div>
                  <div>
                    <ul className="list-none p-0 m-0 flex gap-4 items-center">
                      <li>
                        <a
                          href="https://x.com/indexnetwork_"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#CCC] hover:text-white transition-colors"
                          aria-label="Follow us on Twitter"
                        >
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                          </svg>
                        </a>
                      </li>
                      <li>
                        <a
                          href="https://linkedin.com/company/indexnetwork"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#CCC] hover:text-white transition-colors"
                          aria-label="Follow us on LinkedIn"
                        >
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                          </svg>
                        </a>
                      </li>
                      <li>
                        <a
                          href="https://github.com/indexnetwork/index"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#CCC] hover:text-white transition-colors"
                          aria-label="View our GitHub repository"
                        >
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              fillRule="evenodd"
                              d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </a>
                      </li>
                      <li>
                        <a
                          href="mailto:hello@index.network"
                          className="text-[#CCC] hover:text-white transition-colors"
                          aria-label="Send us an email"
                        >
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M1.5 8.67v8.58a3 3 0 003 3h15a3 3 0 003-3V8.67l-8.928 5.493a3 3 0 01-3.144 0L1.5 8.67z" />
                            <path d="M22.5 6.908V6.75a3 3 0 00-3-3h-15a3 3 0 00-3 3v.158l9.714 5.978a1.5 1.5 0 001.572 0L22.5 6.908z" />
                          </svg>
                        </a>
                      </li>
                    </ul>
                  </div>
                </nav>
              </div>

              {/* Right Column: Newsletter */}
              <div className="md:text-right">
                <h2 className="text-[13px] font-bold text-white mb-2 uppercase tracking-wider font-garamond">
                  Get updates
                </h2>
                <p className="text-[14px] text-[#CCC] mb-4 leading-relaxed">Notes from the frontier</p>
                <form className="flex flex-col gap-3 items-start md:items-end" aria-label="Newsletter subscription" onSubmit={handleSubscribe}>
                  <label htmlFor="newsletter-email" className="sr-only">
                    Email address
                  </label>
                  <input
                    type="email"
                    id="newsletter-email"
                    name="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-transparent border border-[#333] text-white px-4 py-2.5 text-[14px] focus:outline-none focus:border-white transition-colors placeholder:text-[#666] w-full md:w-64 rounded-sm"
                    required
                    aria-required="true"
                    disabled={subscribeStatus === "loading"}
                  />
                  <button
                    type="submit"
                    disabled={subscribeStatus === "loading"}
                    className="bg-white text-black hover:bg-[#F5F5F5] active:bg-[#E5E5E5] uppercase tracking-wider text-xs px-4 py-2.5 w-full md:w-64 rounded-sm transition-colors font-mono border-none disabled:opacity-50"
                  >
                    {subscribeStatus === "loading" ? "Subscribing..." : subscribeStatus === "success" ? "Subscribed!" : "Subscribe"}
                  </button>
                  {subscribeStatus === "error" && (
                    <p className="text-red-400 text-[12px]">Something went wrong. Try again.</p>
                  )}
                </form>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
              <div className="text-[13px] text-[#999]">
                <p>© Index Network Inc. 2026</p>
              </div>
            </div>
          </div>
        </footer>

        {/* Retro Modal Easter Egg */}
        {isRetroModalOpen && (
          <div 
            className="retro-modal-overlay"
            onClick={() => setIsRetroModalOpen(false)}
          >
            <div 
              className="retro-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="retro-title-bar">
                <span className="retro-title-text">Success</span>
              </div>
              <div className="retro-content">
                <div className="retro-icon">!</div>
                <div className="retro-message">
                  A few coffees and one offer later, you care about Mondays again.
                </div>
                <button 
                  onClick={() => setIsRetroModalOpen(false)}
                  className="retro-button"
                >
                  That was easy!
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ClientLayout>
  );
}

export default function RootPage() {
  const { isAuthenticated, isLoading } = useAuthContext();

  // Show loading state while checking auth
  if (isLoading) {
    return null; // AuthContext handles loading UI
  }

  // Show inbox for authenticated users, landing page for unauthenticated
  if (isAuthenticated) {
    return <InboxContent />;
  }

  return <LandingPage />;
}
