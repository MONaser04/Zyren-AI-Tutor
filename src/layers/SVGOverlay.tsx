/**
 * SVGOverlay — Transparent SVG layer for animated Arabic handwriting.
 *
 * This is the upper rendering layer in the Two-Layer UI architecture.
 * It sits as a transparent overlay above the Canvas (Rough.js) layer.
 *
 * Animation Technique:
 * - Each word is a filled <path> element (static glyph) clipped by a <clipPath>
 * - The clipPath contains a reveal mask path with stroke-dashoffset animation
 * - Animation is driven imperatively via JS (no CSS transitions)
 * - The seek(time) method is called every rAF frame by the Sync Engine
 *
 * Architecture Constraint Compliance:
 * - Handwriting animation is ONLY in SVG (never in Canvas)
 * - stroke-dashoffset is applied to the MASK, not the glyph itself
 */
import React, { useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import { ArabicShaper } from './ArabicShaper';
import type { HandwritingPayload, WordAnimation } from '../types';

// ─── Public API (Imperative Handle) ───────────────────────────

export interface SVGOverlayHandle {
  /** Add a word to the animation timeline */
  addWord(payload: HandwritingPayload): void;
  /** Seek all animations to a specific audio time */
  seek(audioTime: number): void;
  /** Freeze the current animation state (for barge-in) */
  freezeCurrentAnimation(): void;
  /** Remove all uncommitted (partial) glyphs */
  removePartialGlyphs(): void;
  /** Clear all words from the overlay */
  clear(): void;
  /** Get the number of words currently in the timeline */
  getWordCount(): number;
  /** Restore all words onto the overlay and reveal them fully */
  setWords(payloads: HandwritingPayload[]): void;
}

interface SVGOverlayProps {
  width: number;
  height: number;
  fontUrl: string;
  fontSize?: number;
  textColor?: string;
  maskStrokeWidth?: number;
  viewBox?: string;  // SVG viewBox for zoom — per SVG 2 spec (w3.org TR/SVG2 June 2026)
  onViewBoxChange?: (viewBox: string) => void;
}

/**
 * SVGOverlay React component with imperative API.
 *
 * Usage:
 * ```tsx
 * const svgRef = useRef<SVGOverlayHandle>(null);
 *
 * // In the Sync Engine rAF loop:
 * svgRef.current?.seek(audioClock.currentTime);
 *
 * // When a new word arrives from the server:
 * svgRef.current?.addWord(handwritingPayload);
 * ```
 */
export const SVGOverlay = forwardRef<SVGOverlayHandle, SVGOverlayProps>(
  function SVGOverlay(
    { width, height, fontUrl, fontSize = 48, textColor = '#e0e0e0', maskStrokeWidth = 120, viewBox, onViewBoxChange },
    ref
  ) {
    const svgRef = useRef<SVGSVGElement>(null);
    const shaperRef = useRef<ArabicShaper | null>(null);
    const timelineRef = useRef<Map<string, WordAnimation>>(new Map());
    const wordCounterRef = useRef(0);
    const frozenRef = useRef(false);
    const committedWordsRef = useRef<Set<string>>(new Set());
    const prevDimRef = useRef({ width: 0, height: 0 });

    // Initialize the Arabic shaper
    useEffect(() => {
      const shaper = new ArabicShaper(fontUrl);
      shaperRef.current = shaper;
      shaper.loadFont().then(() => {
        onViewBoxChange?.(`0 0 ${width} ${height}`);
      }).catch((err) => {
        console.error('[SVGOverlay] Font loading failed:', err);
      });
    }, [fontUrl, width, height, onViewBoxChange]);

    /**
     * Adds a word to the SVG overlay with its timing data.
     * Creates the SVG elements (glyph path + clip mask) imperatively.
     */
    const addWord = useCallback(
      (payload: HandwritingPayload) => {
        const svg = svgRef.current;
        const shaper = shaperRef.current;
        if (!svg || !shaper || !shaper.isLoaded) {
          console.warn('[SVGOverlay] Not ready — SVG or font not loaded');
          return;
        }

        const effectiveFontSize = payload.fontSize ?? (
          payload.style === 'title' ? 44 :
          payload.style === 'annotation' ? 22 :
          24
        );

        const words = shaper.shapeToSVGPaths(payload.text, effectiveFontSize);
        const spaceWidth = effectiveFontSize * 0.35;
        const totalWidth = words.reduce((sum, w) => sum + w.totalWidth, 0) + Math.max(0, words.length - 1) * spaceWidth;
        let yCursor = payload.position.y;

        // Determine alignment
        const isRtl = payload.direction === 'rtl';
        let align = payload.align;
        if (!align) {
          align = payload.style === 'annotation' ? 'center' : (isRtl ? 'right' : 'left');
        }

        // Calculate starting anchor xOffset
        let xCursor = payload.position.x;
        if (align === 'center') {
          xCursor = isRtl ? (payload.position.x + totalWidth / 2) : (payload.position.x - totalWidth / 2);
        } else if (align === 'right') {
          xCursor = isRtl ? payload.position.x : (payload.position.x - totalWidth);
        } else { // 'left'
          xCursor = isRtl ? (payload.position.x + totalWidth) : payload.position.x;
        }

        // Calculate bounded line-wrapping limit based on horizontal domain
        const isTitle = payload.style === 'title';
        const startX = payload.position.x;
        let wrapLimitX = 1850;
        if (!isTitle) {
          if (startX < 920) {
            // Left column/branch: keep strictly on the left half of the board
            const maxW = Math.min(620, Math.max(380, 900 - startX));
            wrapLimitX = startX + maxW;
          } else {
            // Right column/branch: keep strictly in the right half
            const maxW = Math.min(620, Math.max(380, 1850 - startX));
            wrapLimitX = startX + maxW;
          }
        }

        // Distribute character timings across words
        let charIndex = 0;
        let wordIndex = 0;

        for (const word of words) {
          const wordId = `word-${wordCounterRef.current++}`;

          // Skip any leading spaces/whitespace in charTimings before this word
          while (charIndex < payload.charTimings.length && /\s/.test(payload.charTimings[charIndex].char)) {
            charIndex++;
          }

          // Calculate timing for this word
          const wordCharCount = [...word.text].filter((c) => {
            const code = c.charCodeAt(0);
            return !(code >= 0x064B && code <= 0x065F); // skip tashkeel
          }).length;

          const wordTimings = payload.charTimings.slice(charIndex, charIndex + wordCharCount);
          charIndex += wordCharCount;

          const startTime = wordTimings.length > 0 ? wordTimings[0].start : 0;
          const endTime = wordTimings.length > 0 ? wordTimings[wordTimings.length - 1].end : 0;

          // Check if word would exceed column wrapping boundary
          if (!isRtl && (xCursor + word.totalWidth > wrapLimitX) && (xCursor > payload.position.x)) {
            yCursor += effectiveFontSize * 1.35;
            xCursor = payload.position.x;
          }

          // For RTL: move cursor left by word width
          let wordX = xCursor;
          if (isRtl) {
            xCursor -= word.totalWidth;
            wordX = xCursor;
            xCursor -= spaceWidth;
          } else {
            wordX = xCursor;
            xCursor += word.totalWidth + spaceWidth;
          }

          // Create SVG elements
          const effectiveColor = payload.color || textColor;
          const dynamicMaskStrokeWidth = Math.max(60, Math.round(effectiveFontSize * 2.8));
          const { group, maskElement, totalLength, unmask } = createWordSVG(
            svg,
            wordId,
            word.combinedPath,
            word.revealMaskPath,
            wordX,
            yCursor,
            effectiveColor,
            dynamicMaskStrokeWidth
          );

          // Natural wall-clock reveal animation
          const wordDuration = Math.max(220, Math.min(600, word.text.length * 40));
          const wordDelay = wordIndex * 70;
          const animStartTime = performance.now() + wordDelay;

          // Register in timeline
          const animRecord: WordAnimation = {
            wordId,
            startTime,
            endTime,
            maskElement,
            totalLength,
            completed: false,
          };
          timelineRef.current.set(wordId, animRecord);

          // Smooth autonomous rAF reveal with guaranteed completion
          let animFrameId: number;
          const animateStep = (now: number) => {
            if (frozenRef.current) return;
            if (now < animStartTime) {
              animFrameId = requestAnimationFrame(animateStep);
              return;
            }
            const elapsed = now - animStartTime;
            const progress = Math.min(1, elapsed / wordDuration);

            if (progress >= 0.98) {
              animRecord.completed = true;
              committedWordsRef.current.add(wordId);
              unmask();
            } else {
              const eased = easeOutCubic(progress);
              maskElement.style.strokeDashoffset = `${(totalLength * (1 - eased)).toFixed(1)}`;
              animFrameId = requestAnimationFrame(animateStep);
            }
          };
          animFrameId = requestAnimationFrame(animateStep);

          // Absolute safety timeout: Guarantee complete unmasking
          setTimeout(() => {
            animRecord.completed = true;
            committedWordsRef.current.add(wordId);
            unmask();
          }, wordDelay + wordDuration + 150);

          wordIndex++;
        }

        // Visual accent underline strictly for handwritten Main Topic Titles at header zone
        if (payload.style === 'title' || (payload.position.y <= 110 && payload.position.x < 450)) {
          const underlineId = `title-underline-${wordCounterRef.current++}`;
          const lineY = yCursor + fontSize * 0.35;
          const lineX1 = align === 'center' ? payload.position.x - totalWidth / 2 : payload.position.x;
          const lineX2 = lineX1 + totalWidth;

          const lineElem = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          lineElem.setAttribute('x1', `${lineX1}`);
          lineElem.setAttribute('y1', `${lineY}`);
          lineElem.setAttribute('x2', `${lineX2}`);
          lineElem.setAttribute('y2', `${lineY}`);
          lineElem.setAttribute('stroke', '#4ECDC4');
          lineElem.setAttribute('stroke-width', '3');
          lineElem.setAttribute('stroke-linecap', 'round');
          lineElem.setAttribute('class', 'word-group title-accent-line');
          lineElem.setAttribute('data-word-id', underlineId);

          const lineLength = Math.abs(lineX2 - lineX1);
          lineElem.style.strokeDasharray = `${lineLength}`;
          lineElem.style.strokeDashoffset = `${lineLength}`;
          lineElem.style.transition = 'stroke-dashoffset 0.35s ease-out';

          svg.appendChild(lineElem);

          setTimeout(() => {
            lineElem.style.strokeDashoffset = '0';
          }, Math.max(200, words.length * 70 + 200));
        }
      },
      [fontSize, textColor, maskStrokeWidth]
    );

    /**
     * Seeks all word animations to the given audio time.
     * Called every rAF frame from the Sync Engine.
     */
    const seek = useCallback((audioTime: number) => {
      if (frozenRef.current) return;

      for (const [, anim] of timelineRef.current) {
        if (anim.completed) continue;

        const duration = anim.endTime - anim.startTime;

        if (audioTime >= anim.endTime || duration <= 0 || (anim.startTime > 0 && audioTime - anim.startTime > 1.5)) {
          // Fully revealed — unmask immediately so zero letter clipping occurs
          anim.maskElement.style.strokeDashoffset = '0';
          anim.completed = true;
          committedWordsRef.current.add(anim.wordId);
          const group = svgRef.current?.querySelector(`[data-word-id="${anim.wordId}"]`);
          if (group) {
            group.removeAttribute('mask');
          }
        }
      }
    }, []);

    const freezeCurrentAnimation = useCallback(() => {
      frozenRef.current = true;
    }, []);

    const removePartialGlyphs = useCallback(() => {
      const svg = svgRef.current;
      if (!svg) return;

      // Remove words that haven't been fully committed
      for (const [wordId] of timelineRef.current) {
        if (!committedWordsRef.current.has(wordId)) {
          // Remove SVG elements
          const group = svg.querySelector(`[data-word-id="${wordId}"]`);
          if (group) group.remove();

          const clip = svg.querySelector(`#mask-${wordId}`) || svg.querySelector(`#clip-${wordId}`);
          if (clip) clip.remove();

          timelineRef.current.delete(wordId);
        }
      }

      frozenRef.current = false;
    }, []);

    const clear = useCallback(() => {
      const svg = svgRef.current;
      if (!svg) return;

      // Remove all word groups, masks, and clip paths
      const defs = svg.querySelector('defs');
      if (defs) defs.innerHTML = '';

      const groups = svg.querySelectorAll('.word-group');
      groups.forEach((g) => g.remove());

      timelineRef.current.clear();
      committedWordsRef.current.clear();
      frozenRef.current = false;
    }, []);

    // Note: We do NOT clear SVG overlay on dimension change/resize
    // to preserve all written handwriting during zoom and window resizing.
    useEffect(() => {
      prevDimRef.current = { width, height };
    }, [width, height]);

    const getWordCount = useCallback(() => timelineRef.current.size, []);

    const setWords = useCallback(
      (payloads: HandwritingPayload[]) => {
        clear();
        for (const p of payloads) {
          addWord(p);
        }
        seek(9999999);

        // Ensure all restored word groups have masks removed for clean rendering
        const svg = svgRef.current;
        if (svg) {
          const groups = svg.querySelectorAll('.word-group');
          groups.forEach((g) => g.removeAttribute('mask'));
        }
      },
      [clear, addWord, seek]
    );

    // Expose imperative handle
    useImperativeHandle(
      ref,
      () => ({
        addWord,
        seek,
        freezeCurrentAnimation,
        removePartialGlyphs,
        clear,
        getWordCount,
        setWords,
      }),
      [addWord, seek, freezeCurrentAnimation, removePartialGlyphs, clear, getWordCount, setWords]
    );

    return (
      <svg
        ref={svgRef}
        className="handwriting-overlay"
        width={width}
        height={height}
        viewBox={viewBox}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 10,
          overflow: 'visible',
        }}
      >
        <defs>{/* Masks and clip paths inserted here */}</defs>
      </svg>
    );
  }
);

/**
 * Standalone helper methods for creating animated SVG word glyphs with reveal masks.
 */
function createWordSVG(
  svg: SVGSVGElement,
  wordId: string,
  glyphPath: string,
  maskPath: string,
  x: number,
  y: number,
  color: string,
  maskStrokeWidth: number
): { group: SVGGElement; maskElement: SVGPathElement; totalLength: number; unmask: () => void } {
  const ns = 'http://www.w3.org/2000/svg';

  // 1. Create mask in <defs>
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS(ns, 'defs');
    svg.prepend(defs);
  }

  const mask = document.createElementNS(ns, 'mask');
  mask.setAttribute('id', `mask-${wordId}`);
  mask.setAttribute('maskUnits', 'userSpaceOnUse');
  mask.setAttribute('maskContentUnits', 'userSpaceOnUse');
  mask.setAttribute('x', '-2000');
  mask.setAttribute('y', '-2000');
  mask.setAttribute('width', '8000');
  mask.setAttribute('height', '8000');

  const maskElement = document.createElementNS(ns, 'path');
  maskElement.setAttribute('d', maskPath);
  maskElement.setAttribute('stroke', 'white');
  maskElement.setAttribute('stroke-width', `${Math.max(180, maskStrokeWidth)}`);
  maskElement.setAttribute('fill', 'none');
  maskElement.setAttribute('stroke-linecap', 'round');
  maskElement.setAttribute('stroke-linejoin', 'round');

  mask.appendChild(maskElement);
  defs.appendChild(mask);

  // Calculate total path length for dashoffset
  const totalLength = maskElement.getTotalLength();

  // Set initial state: fully masked (hidden)
  maskElement.style.strokeDasharray = `${totalLength}`;
  maskElement.style.strokeDashoffset = `${totalLength}`;

  // 2. Create the visible glyph group
  const group = document.createElementNS(ns, 'g');
  group.setAttribute('class', 'word-group');
  group.setAttribute('data-word-id', wordId);
  group.setAttribute('transform', `translate(${x}, ${y})`);
  group.setAttribute('mask', `url(#mask-${wordId})`);

  const glyphElement = document.createElementNS(ns, 'path');
  glyphElement.setAttribute('d', glyphPath);
  glyphElement.setAttribute('fill', color);
  glyphElement.setAttribute('class', 'glyph');
  group.appendChild(glyphElement);
  svg.appendChild(group);

  const unmask = () => {
    if (group.hasAttribute('mask')) {
      group.removeAttribute('mask');
    }
    maskElement.style.strokeDashoffset = '0';
    mask.remove();
  };

  return { group, maskElement, totalLength, unmask };
}

/**
 * Cubic ease-out for smoother handwriting reveal.
 * Starts fast (pen touching down), slows at the end (natural deceleration).
 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
