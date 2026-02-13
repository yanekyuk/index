'use client';

import { BlogPost } from '@/lib/blog';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import Footer from '@/components/Footer';

export default function BlogPage() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  
  // Waitlist modal state
  const [isWaitlistOpen, setIsWaitlistOpen] = useState(false);
  const [waitlistForm, setWaitlistForm] = useState({
    name: "",
    email: "",
    whatYouDo: "",
    whoToMeet: "",
  });
  const [waitlistStatus, setWaitlistStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  useEffect(() => {
    fetch('/api/blog/posts')
      .then(res => res.json())
      .then(data => setPosts(data));
  }, []);

  // Listen for custom event from header button
  useEffect(() => {
    const handleOpenWaitlistModal = () => {
      setIsWaitlistOpen(true);
    };
    window.addEventListener('openWaitlistModal', handleOpenWaitlistModal);
    return () => window.removeEventListener('openWaitlistModal', handleOpenWaitlistModal);
  }, []);

  // Close modal on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isWaitlistOpen && waitlistStatus !== "loading") {
        setIsWaitlistOpen(false);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isWaitlistOpen, waitlistStatus]);

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

  return (
    <div className="flex flex-col flex-1">
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
                <div className="w-16 h-16 bg-[#4091BB] rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 id="waitlist-modal-title" className="text-2xl font-garamond text-black mb-2">You&apos;re on the list!</h3>
                <p className="text-gray-600 text-[15px]">Check your inbox for your welcome email.</p>
                <button
                  onClick={() => {
                    setIsWaitlistOpen(false);
                    setWaitlistStatus("idle");
                    setWaitlistForm({ name: "", email: "", whatYouDo: "", whoToMeet: "" });
                  }}
                  className="mt-6 text-[#4091BB] hover:underline text-sm font-medium"
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
                      className="w-full border border-gray-300 px-3 py-2.5 text-[15px] text-black focus:outline-none focus:border-[#4091BB] transition-colors rounded-sm"
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
                      className="w-full border border-gray-300 px-3 py-2.5 text-[15px] text-black focus:outline-none focus:border-[#4091BB] transition-colors rounded-sm"
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
                      className="w-full border border-gray-300 px-3 py-2.5 text-[15px] text-black focus:outline-none focus:border-[#4091BB] transition-colors rounded-sm"
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
                      className="w-full border border-gray-300 px-3 py-2.5 text-[15px] text-black focus:outline-none focus:border-[#4091BB] transition-colors rounded-sm resize-none"
                      disabled={waitlistStatus === "loading"}
                    />
                  </div>

                  {waitlistStatus === "error" && (
                    <p className="text-red-500 text-sm">Something went wrong. Please try again.</p>
                  )}

                  <button
                    type="submit"
                    disabled={waitlistStatus === "loading"}
                    className="w-full bg-[#041729] text-white py-3 text-sm font-semibold uppercase tracking-wider hover:bg-[#0a2d4a] transition-colors disabled:opacity-50 rounded-sm"
                  >
                    {waitlistStatus === "loading" ? "Submitting..." : "Join the waitlist"}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

    <div className="flex-1 flex flex-col">
      <div className="max-w-3xl w-full mx-auto px-4 py-16">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-garamond font-medium text-black">
            Letters from Index
          </h1>
        </div>

        {posts.length === 0 ? (
          <p className="text-black font-sans">No posts yet. Check back soon!</p>
        ) : (
          <div className="space-y-2 mt-8">
            {posts.map((post) => (
              <article key={post.slug}>
                <div className="flex gap-2 items-center">
                  <time className="text-black italic shrink-0 w-28 text-base font-sans">
                    {new Date(post.date).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    }).replace(',', '')}
                  </time>
                  <div className="flex-1">
                    <Link href={`/blog/${post.slug}`} className="text-black font-garamond text-lg font-bold underline">
                      {post.title}
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
    <Footer />
    </div>
  );
}
