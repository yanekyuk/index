'use client';

import { useState, useEffect, useRef } from 'react';

export interface TypewriterResult {
  /** The portion of content revealed so far. */
  text: string;
  /** True while characters are still being revealed (streaming or catch-up). */
  isAnimating: boolean;
}

/**
 * Streaming-compatible typewriter hook.
 *
 * Reveals `content` character-by-character at `speed` ms per char while
 * streaming is active.  When streaming ends the typewriter keeps going at
 * an accelerated pace (`catchUpSpeed`) so the remaining buffer drains
 * smoothly instead of appearing all at once.
 *
 * Historical messages (mounted with isActive=false) render in full instantly.
 */
export function useTypewriter(
  content: string,
  isActive: boolean,
  speed: number = 22,
  catchUpSpeed: number = 8, // faster drain after stream ends
): TypewriterResult {
  const [displayedLength, setDisplayedLength] = useState(() =>
    isActive ? 0 : content.length,
  );

  const hasAnimated = useRef(isActive);
  const targetLengthRef = useRef(content.length);
  const isActiveRef = useRef(isActive);

  // Keep refs in sync
  useEffect(() => { targetLengthRef.current = content.length; }, [content.length]);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);
  useEffect(() => { if (isActive) hasAnimated.current = true; }, [isActive]);

  // Single interval that runs while there are characters to reveal.
  // Adapts its pace: normal speed while streaming, catchUpSpeed after.
  useEffect(() => {
    if (!hasAnimated.current) return;

    const id = setInterval(() => {
      setDisplayedLength((prev) => {
        const target = targetLengthRef.current;
        if (prev >= target) return prev;
        return prev + 1;
      });
    }, isActive ? speed : catchUpSpeed);

    return () => clearInterval(id);
  }, [isActive, speed, catchUpSpeed]);

  // Historical messages — never streamed, show full content.
  if (!hasAnimated.current && !isActive) {
    return { text: content, isAnimating: false };
  }

  return {
    text: content.slice(0, displayedLength),
    isAnimating: displayedLength < content.length,
  };
}
