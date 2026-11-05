/**
 * ArabicShaper — Text contextual shaping, multi-line list preservation, inline math superscripts, and SVG path extraction.
 *
 * Pipeline:
 * 1. Split text into logical lines (preserving '\n' and separating inline numbered/bulleted lists)
 * 2. Normalize math notation, symbols, and superscripts/subscripts (^, _, ², ³, etc.)
 * 3. Load font and extract Bézier curves via opentype.js (blocking .notdef index-0 Tofu glyphs)
 * 4. Generate per-word SVG path data with lineBreakBefore markers
 * 5. Generate reveal mask paths for stroke-dashoffset animation
 */
// @ts-ignore
import opentype from 'opentype.js';
import type { ShapedWord, ShapedGlyph, Rect } from '../types';
import { splitIntoLogicalLines, normalizeProseMathAndSymbols } from '../engine/CollisionDetector';

/**
 * Arabic Unicode ranges and positional form mappings.
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
  '\u0629',
]);

/** Unicode superscript map to standard ^{...} representation for authentic raised glyph rendering */
const UNICODE_SUPERSCRIPTS: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁺': '+',
  '⁻': '-',
  'ⁿ': 'n',
};

/** Fallback map for mathematical or typographic symbols if missing in the active handwriting font */
const SYMBOL_FALLBACKS: Record<string, string> = {
  '≡': ':=',
  '≈': '~=',
  '≠': '!=',
  '≤': '<=',
  '≥': '>=',
  '→': '->',
  '⇒': '=>',
  '↔': '<->',
  '⇔': '<=>',
  '−': '-',
  '–': '-',
  '—': '-',
  '•': '-',
  '●': '-',
  '▪': '-',
  '·': '*',
  '×': 'x',
  '÷': '/',
};

const isArabicChar = (c: string): boolean => {
  const code = c.charCodeAt(0);
  return (code >= 0x0600 && code <= 0x06FF) || (code >= 0xFB50 && code <= 0xFDFF) || (code >= 0xFE70 && code <= 0xFEFF);
};

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
   * Checks whether the loaded font has a valid glyph (not .notdef index 0) for the given character.
   */
  public hasGlyph(char: string): boolean {
    if (!this.font) return false;
    const glyph = this.font.charToGlyph(char);
    return Boolean(glyph && glyph.index > 0);
  }

  /**
   * Normalizes Unicode superscripts and substitutes any symbol missing from the loaded font
   * so .notdef Tofu boxes can never appear.
   */
  private normalizeForFont(line: string): string {
    let out = '';
    const chars = [...line];
    let i = 0;
    while (i < chars.length) {
      const c = chars[i];
      if (UNICODE_SUPERSCRIPTS[c] !== undefined) {
        let supGroup = '';
        while (i < chars.length && UNICODE_SUPERSCRIPTS[chars[i]] !== undefined) {
          supGroup += UNICODE_SUPERSCRIPTS[chars[i]];
          i++;
        }
        out += `^{${supGroup}}`;
        continue;
      }

      if (/\s/.test(c) || c === '^' || c === '_' || c === '{' || c === '}') {
        out += c;
        i++;
        continue;
      }

      if (this.hasGlyph(c)) {
        out += c;
      } else if (SYMBOL_FALLBACKS[c] !== undefined) {
        out += SYMBOL_FALLBACKS[c];
      }
      // Characters that have neither a glyph nor a fallback are silently omitted rather than drawing a .notdef box
      i++;
    }
    return out;
  }

  reshapeText(text: string): string {
    const chars = [...text];
    const result: string[] = [];

    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];

      if (isTashkeel(char)) {
        result.push(char);
        continue;
      }

      if (!isArabicChar(char) || !ARABIC_FORMS[char]) {
        result.push(char);
        continue;
      }

      const forms = ARABIC_FORMS[char];
      const prevChar = this.findPrevBaseChar(chars, i);
      const nextChar = this.findNextBaseChar(chars, i);

      const prevConnects = prevChar !== null && isArabicChar(prevChar) && !RIGHT_JOINING.has(prevChar) && ARABIC_FORMS[prevChar] !== undefined;
      const nextConnects = nextChar !== null && isArabicChar(nextChar) && ARABIC_FORMS[nextChar] !== undefined;
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
   * Shapes text and extracts SVG path data for each word while preserving logical line breaks
   * (\n, numbered lists, bullet lists) via lineBreakBefore flags.
   */
  shapeToSVGPaths(text: string, fontSize: number): ShapedWord[] {
    if (!this.font) throw new Error('[ArabicShaper] Font not loaded');

    const logicalLines = splitIntoLogicalLines(text);
    const shapedWords: ShapedWord[] = [];

    logicalLines.forEach((rawLine, lineIdx) => {
      const normalizedLine = this.normalizeForFont(normalizeProseMathAndSymbols(rawLine));
      const words = normalizedLine.split(/[ \t]+/).filter(Boolean);
      let firstValidWordInLine = true;

      for (const word of words) {
        const shapedWord = this.shapeWord(word, fontSize);
        if (shapedWord.glyphs.length === 0) continue;

        if (lineIdx > 0 && firstValidWordInLine) {
          shapedWord.lineBreakBefore = true;
        }
        firstValidWordInLine = false;
        shapedWords.push(shapedWord);
      }
    });

    return shapedWords;
  }

  /**
   * Shapes a single word and extracts its SVG path data.
   */
  private shapeWord(word: string, fontSize: number): ShapedWord {
    if (!this.font) throw new Error('[ArabicShaper] Font not loaded');

    const hasArabic = [...word].some((c) => isArabicChar(c));

    let processedText = word;
    if (hasArabic) {
      const reshaped = this.reshapeText(word);
      processedText = [...reshaped].reverse().join('');
    }

    const glyphs = this.extractGlyphs(processedText, fontSize);
    const combinedPath = glyphs.map((g) => g.pathData).join(' ');

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
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
    };

    const revealMaskPath = this.generateRevealMaskPath(bounds, fontSize, hasArabic);

    // Clean display text (without raw ^, _, {, } tokens) for accurate timing character count
    const cleanWordText = word.replace(/[\^_]\{([^}]*)\}/g, '$1').replace(/[\^_]([0-9a-zA-Z+\-])/g, '$1');

    return {
      text: cleanWordText || word,
      glyphs,
      combinedPath,
      revealMaskPath,
      totalWidth: bounds.width,
      totalHeight: bounds.height,
    };
  }

  /**
   * Extracts individual glyph paths from the font, with native support for typographic
   * superscripts (^x, ^{...}) and subscripts (_x, _{...}) so raw '^' carets never appear.
   */
  private extractGlyphs(text: string, fontSize: number): ShapedGlyph[] {
    if (!this.font) return [];

    const glyphs: ShapedGlyph[] = [];
    let xOffset = 0;
    const chars = [...text];
    let i = 0;

    const appendGlyph = (char: string, targetFontSize: number, yOffset: number) => {
      if (!this.font || isTashkeel(char)) return;
      const glyph = this.font.charToGlyph(char);
      // Strictly block .notdef (index 0) Tofu boxes
      if (!glyph || glyph.index === 0) return;

      const scale = targetFontSize / this.font.unitsPerEm;
      const safeXOffset = Math.round(xOffset * 100) / 100;
      const path = glyph.getPath(safeXOffset, yOffset, targetFontSize);

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
    };

    while (i < chars.length) {
      const char = chars[i];

      // Handle Superscript (^) or Subscript (_)
      if ((char === '^' || char === '_') && i + 1 < chars.length) {
        const isSup = char === '^';
        const subSupFontSize = Math.max(14, Math.round(fontSize * 0.68));
        const yOffset = isSup ? -Math.round(fontSize * 0.36) : Math.round(fontSize * 0.22);
        i++; // skip '^' or '_'

        if (chars[i] === '{') {
          i++; // skip '{'
          while (i < chars.length && chars[i] !== '}') {
            appendGlyph(chars[i], subSupFontSize, yOffset);
            i++;
          }
          if (i < chars.length && chars[i] === '}') {
            i++; // skip '}'
          }
        } else {
          // Read contiguous exponent/subscript token (e.g. ^2, ^n, ^-1)
          let count = 0;
          while (i < chars.length && count < 4 && /[0-9a-zA-Z+\-]/.test(chars[i])) {
            appendGlyph(chars[i], subSupFontSize, yOffset);
            i++;
            count++;
          }
        }
        continue;
      }

      appendGlyph(char, fontSize, 0);
      i++;
    }

    return glyphs;
  }

  private generateRevealMaskPath(bounds: Rect, fontSize: number, isRtl: boolean): string {
    const y = bounds.y + bounds.height / 2;
    const padding = fontSize * 0.5;

    const startX = isRtl ? (bounds.x + bounds.width + padding) : (bounds.x - padding);
    const endX = isRtl ? (bounds.x - padding) : (bounds.x + bounds.width + padding);

    return `M ${startX} ${y} L ${endX} ${y}`;
  }

  private findPrevBaseChar(chars: string[], index: number): string | null {
    for (let i = index - 1; i >= 0; i--) {
      if (!isTashkeel(chars[i])) return chars[i];
    }
    return null;
  }

  private findNextBaseChar(chars: string[], index: number): string | null {
    for (let i = index + 1; i < chars.length; i++) {
      if (!isTashkeel(chars[i])) return chars[i];
    }
    return null;
  }
}
