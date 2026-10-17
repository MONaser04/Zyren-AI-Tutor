/**
 * ArabicShaper — Arabic text contextual shaping and SVG path extraction.
 *
 * This is the core of the Arabic handwriting engine. It transforms raw
 * Unicode Arabic text into SVG path data with correct contextual forms.
 *
 * Pipeline:
 * 1. Reshape Arabic characters to positional forms (initial/medial/final/isolated)
 * 2. Load font and extract Bézier curves via opentype.js
 * 3. Generate per-word SVG path data
 * 4. Generate reveal mask paths for stroke-dashoffset animation
 *
 * Why not use <text> elements?
 * - SVG <text> in many browsers doesn't apply full OpenType shaping
 * - Arabic characters appear disconnected without GSUB processing
 * - Path-based rendering guarantees visual fidelity across all browsers
 */
// @ts-ignore
import opentype from 'opentype.js';
import type { ShapedWord, ShapedGlyph, Rect } from '../types';

/**
 * Arabic Unicode ranges and positional form mappings.
 * Maps standard Arabic characters to their Presentation Forms B positions.
 */
const ARABIC_FORMS: Record<string, { isolated: number; initial: number; medial: number; final: number }> = {
  '\u0627': { isolated: 0xFE8D, initial: 0xFE8D, medial: 0xFE8E, final: 0xFE8E }, // Alef
  '\u0628': { isolated: 0xFE8F, initial: 0xFE91, medial: 0xFE92, final: 0xFE90 }, // Ba
  '\u062A': { isolated: 0xFE95, initial: 0xFE97, medial: 0xFE98, final: 0xFE96 }, // Ta
  '\u062B': { isolated: 0xFE99, initial: 0xFE9B, medial: 0xFE9C, final: 0xFE9A }, // Tha
  '\u062C': { isolated: 0xFE9D, initial: 0xFE9F, medial: 0xFEA0, final: 0xFE9E }, // Jeem
  '\u062D': { isolated: 0xFEA1, initial: 0xFEA3, medial: 0xFEA4, final: 0xFEA2 }, // Ha
  '\u062E': { isolated: 0xFEA5, initial: 0xFEA7, medial: 0xFEA8, final: 0xFEA6 }, // Kha
  '\u062F': { isolated: 0xFEA9, initial: 0xFEA9, medial: 0xFEAA, final: 0xFEAA }, // Dal
  '\u0630': { isolated: 0xFEAB, initial: 0xFEAB, medial: 0xFEAC, final: 0xFEAC }, // Thal
  '\u0631': { isolated: 0xFEAD, initial: 0xFEAD, medial: 0xFEAE, final: 0xFEAE }, // Ra
  '\u0632': { isolated: 0xFEAF, initial: 0xFEAF, medial: 0xFEB0, final: 0xFEB0 }, // Zay
  '\u0633': { isolated: 0xFEB1, initial: 0xFEB3, medial: 0xFEB4, final: 0xFEB2 }, // Seen
  '\u0634': { isolated: 0xFEB5, initial: 0xFEB7, medial: 0xFEB8, final: 0xFEB6 }, // Sheen
  '\u0635': { isolated: 0xFEB9, initial: 0xFEBB, medial: 0xFEBC, final: 0xFEBA }, // Sad
  '\u0636': { isolated: 0xFEBD, initial: 0xFEBF, medial: 0xFEC0, final: 0xFEBE }, // Dad
  '\u0637': { isolated: 0xFEC1, initial: 0xFEC3, medial: 0xFEC4, final: 0xFEC2 }, // Tah
  '\u0638': { isolated: 0xFEC5, initial: 0xFEC7, medial: 0xFEC8, final: 0xFEC6 }, // Zah
  '\u0639': { isolated: 0xFEC9, initial: 0xFECB, medial: 0xFECC, final: 0xFECA }, // Ain
  '\u063A': { isolated: 0xFECD, initial: 0xFECF, medial: 0xFED0, final: 0xFECE }, // Ghain
  '\u0641': { isolated: 0xFED1, initial: 0xFED3, medial: 0xFED4, final: 0xFED2 }, // Fa
  '\u0642': { isolated: 0xFED5, initial: 0xFED7, medial: 0xFED8, final: 0xFED6 }, // Qaf
  '\u0643': { isolated: 0xFED9, initial: 0xFEDB, medial: 0xFEDC, final: 0xFEDA }, // Kaf
  '\u0644': { isolated: 0xFEDD, initial: 0xFEDF, medial: 0xFEE0, final: 0xFEDE }, // Lam
  '\u0645': { isolated: 0xFEE1, initial: 0xFEE3, medial: 0xFEE4, final: 0xFEE2 }, // Meem
  '\u0646': { isolated: 0xFEE5, initial: 0xFEE7, medial: 0xFEE8, final: 0xFEE6 }, // Noon
  '\u0647': { isolated: 0xFEE9, initial: 0xFEEB, medial: 0xFEEC, final: 0xFEEA }, // Ha
  '\u0648': { isolated: 0xFEED, initial: 0xFEED, medial: 0xFEEE, final: 0xFEEE }, // Waw
  '\u064A': { isolated: 0xFEF1, initial: 0xFEF3, medial: 0xFEF4, final: 0xFEF2 }, // Ya
  '\u0629': { isolated: 0xFE93, initial: 0xFE93, medial: 0xFE94, final: 0xFE94 }, // Ta Marbuta
  '\u0649': { isolated: 0xFEEF, initial: 0xFEEF, medial: 0xFEF0, final: 0xFEF0 }, // Alef Maksura
};

/** Characters that connect to the following character (right-joining) */
const RIGHT_JOINING = new Set([
  '\u0627', '\u062F', '\u0630', '\u0631', '\u0632', '\u0648', '\u0649',
  '\u0629', // These characters don't connect to the left
]);

/** Characters that are non-joining (spaces, punctuation, etc.) */
const isArabicChar = (c: string): boolean => {
  const code = c.charCodeAt(0);
  return (code >= 0x0600 && code <= 0x06FF) || (code >= 0xFB50 && code <= 0xFDFF) || (code >= 0xFE70 && code <= 0xFEFF);
};

/** Check if a character is a tashkeel (diacritical mark) */
const isTashkeel = (c: string): boolean => {
  const code = c.charCodeAt(0);
  return code >= 0x064B && code <= 0x065F;
};

export class ArabicShaper {
  private font: opentype.Font | null = null;
  private fontUrl: string;
  private _isLoaded = false;

  constructor(fontUrl: string) {
    this.fontUrl = fontUrl;
  }

  /**
   * Load the Arabic font. Must be called before any shaping operations.
   */
  async loadFont(): Promise<void> {
    if (this._isLoaded) return;

    try {
      const response = await fetch(this.fontUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      this.font = opentype.parse(buffer);
      this._isLoaded = true;
      console.log(`[ArabicShaper] Font loaded: ${this.font.names.fontFamily?.en ?? 'unknown'}`);
    } catch (error) {
      throw new Error(`[ArabicShaper] Failed to load font from ${this.fontUrl}: ${error}`);
    }
  }

  get isLoaded(): boolean {
    return this._isLoaded;
  }

  /**
   * Reshape Arabic text to use correct positional forms.
   * Handles initial, medial, final, and isolated forms.
   */
  reshapeText(text: string): string {
    const chars = [...text]; // Handle multi-byte characters
    const result: string[] = [];

    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];

      // Skip tashkeel (diacritical marks) — pass through unchanged
      if (isTashkeel(char)) {
        result.push(char);
        continue;
      }

      // Non-Arabic characters pass through unchanged
      if (!isArabicChar(char) || !ARABIC_FORMS[char]) {
        result.push(char);
        continue;
      }

      const forms = ARABIC_FORMS[char];
      const prevChar = this.findPrevBaseChar(chars, i);
      const nextChar = this.findNextBaseChar(chars, i);

      const prevConnects = prevChar !== null && isArabicChar(prevChar) && !RIGHT_JOINING.has(prevChar) && ARABIC_FORMS[prevChar] !== undefined;
      const nextConnects = nextChar !== null && isArabicChar(nextChar) && ARABIC_FORMS[nextChar] !== undefined;

      // Can this character connect to the left?
      const canConnectLeft = !RIGHT_JOINING.has(char);

      let form: number;
      if (prevConnects && nextConnects && canConnectLeft) {
        form = forms.medial;
      } else if (prevConnects && (!nextConnects || !canConnectLeft)) {
        form = forms.final;
      } else if (!prevConnects && nextConnects && canConnectLeft) {
        form = forms.initial;
      } else {
        form = forms.isolated;
      }

      result.push(String.fromCharCode(form));
    }

    return result.join('');
  }

  /**
   * Shapes text and extracts SVG path data for each word.
   * This is the main API used by the SVG Overlay layer.
   *
   * @param text - Raw Arabic text
   * @param fontSize - Font size in pixels
   * @returns Array of ShapedWord objects with path data
   */
  shapeToSVGPaths(text: string, fontSize: number): ShapedWord[] {
    if (!this.font) throw new Error('[ArabicShaper] Font not loaded');

    const words = text.split(/\s+/).filter(Boolean);
    const shapedWords: ShapedWord[] = [];

    for (const word of words) {
      const shapedWord = this.shapeWord(word, fontSize);
      shapedWords.push(shapedWord);
    }

    return shapedWords;
  }

  /**
   * Shapes a single word and extracts its SVG path data.
   */
  private shapeWord(word: string, fontSize: number): ShapedWord {
    if (!this.font) throw new Error('[ArabicShaper] Font not loaded');

    // Check if word contains Arabic characters
    const hasArabic = [...word].some((c) => isArabicChar(c));

    let processedText = word;
    if (hasArabic) {
      // 1. Reshape Arabic to positional forms
      const reshaped = this.reshapeText(word);
      // 2. Reverse for RTL display (opentype.js renders LTR)
      processedText = [...reshaped].reverse().join('');
    }

    // 3. Extract per-character glyphs
    const glyphs = this.extractGlyphs(processedText, fontSize);

    // 4. Combine paths and calculate overall bounding box
    const combinedPath = glyphs.map(g => g.pathData).join(' ');

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (glyphs.length > 0) {
      for (const g of glyphs) {
        minX = Math.min(minX, g.bounds.x);
        minY = Math.min(minY, g.bounds.y);
        maxX = Math.max(maxX, g.bounds.x + g.bounds.width);
        maxY = Math.max(maxY, g.bounds.y + g.bounds.height);
      }
    } else {
      minX = 0; minY = 0; maxX = 0; maxY = 0;
    }
    
    const bounds: Rect = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };

    // 5. Generate the reveal mask path (follows natural LTR or RTL writing direction)
    const revealMaskPath = this.generateRevealMaskPath(bounds, fontSize, hasArabic);

    return {
      text: word,
      glyphs,
      combinedPath,
      revealMaskPath,
      totalWidth: bounds.width,
      totalHeight: bounds.height,
    };
  }

  /**
   * Extract individual glyph paths from the font.
   */
  private extractGlyphs(text: string, fontSize: number): ShapedGlyph[] {
    if (!this.font) return [];

    const glyphs: ShapedGlyph[] = [];
    let xOffset = 0;

    for (const char of text) {
      if (isTashkeel(char)) continue;

      const glyph = this.font.charToGlyph(char);
      if (!glyph) continue;

      const scale = fontSize / this.font.unitsPerEm;
      // Fix opentype.js bezier math precision bug that outputs NaN for long floats
      const safeXOffset = Math.round(xOffset * 100) / 100;
      const path = glyph.getPath(safeXOffset, 0, fontSize);
      
      // Defense in depth: sanitize path data
      const pathData = path.toPathData(2).replace(/NaN/g, '0');
      const bbox = path.getBoundingBox();

      glyphs.push({
        char,
        pathData,
        advanceWidth: (glyph.advanceWidth ?? 0) * scale,
        bounds: {
          x: bbox.x1,
          y: bbox.y1,
          width: bbox.x2 - bbox.x1,
          height: bbox.y2 - bbox.y1,
        },
      });

      xOffset += (glyph.advanceWidth ?? 0) * scale;
    }

    return glyphs;
  }

  /**
   * Generates a reveal mask path for the word.
   * For Arabic (RTL): horizontal stroke from right to left.
   * For English / German (LTR): horizontal stroke from left to right.
   */
  private generateRevealMaskPath(bounds: Rect, fontSize: number, isRtl: boolean): string {
    const y = bounds.y + bounds.height / 2;
    const padding = fontSize * 0.5;

    const startX = isRtl ? (bounds.x + bounds.width + padding) : (bounds.x - padding);
    const endX = isRtl ? (bounds.x - padding) : (bounds.x + bounds.width + padding);

    return `M ${startX} ${y} L ${endX} ${y}`;
  }

  /**
   * Find the previous base character (skip tashkeel).
   */
  private findPrevBaseChar(chars: string[], index: number): string | null {
    for (let i = index - 1; i >= 0; i--) {
      if (!isTashkeel(chars[i])) return chars[i];
    }
    return null;
  }

  /**
   * Find the next base character (skip tashkeel).
   */
  private findNextBaseChar(chars: string[], index: number): string | null {
    for (let i = index + 1; i < chars.length; i++) {
      if (!isTashkeel(chars[i])) return chars[i];
    }
    return null;
  }
}
