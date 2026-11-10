import type { QuizPair, QuizOption } from '../types';

// ─── Text Matching Score ───────────────────────────────────────────
export function scoreMatchText(candidate: string, target: string): number {
  const candLower = candidate.toLowerCase().trim();
  const targLower = target.toLowerCase().trim();
  if (!candLower || !targLower) return 0;
  if (candLower === targLower) return 100;
  if (candLower.includes(targLower)) return 85;
  if (targLower.includes(candLower)) return 75;

  const candWords = candLower.split(/[\s,.;:->=_|/()[\]{}]+/).filter((w) => w.length >= 3);
  const targWords = targLower.split(/[\s,.;:->=_|/()[\]{}]+/).filter((w) => w.length >= 3);
  if (candWords.length === 0 || targWords.length === 0) return 0;

  let matchPoints = 0;
  for (const cw of candWords) {
    for (const tw of targWords) {
      if (cw === tw) {
        matchPoints += 2;
        break;
      } else if (cw.startsWith(tw) || tw.startsWith(cw)) {
        matchPoints += 1.5;
        break;
      } else {
        const minLen = Math.min(cw.length, tw.length);
        if (minLen >= 4 && cw.slice(0, minLen - 1) === tw.slice(0, minLen - 1)) {
          matchPoints += 1;
          break;
        }
      }
    }
  }
  return (matchPoints / Math.max(candWords.length, targWords.length)) * 50;
}

// ─── Matching Voice & Speech Answer Parser ─────────────────────────
export function parseMatchingVoiceAnswer(
  answer: string,
  pairs: QuizPair[],
  displayedRightPairs: QuizPair[],
  existingMatches?: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = { ...(existingMatches || {}) };
  if (!answer || typeof answer !== 'string' || !pairs || pairs.length === 0) {
    return result;
  }

  const raw = answer.trim();

  // 1. JSON string parsing
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        for (const [k, v] of Object.entries(parsed)) {
          const kStr = String(k).trim().toLowerCase();
          const vStr = String(v).trim().toLowerCase();
          const left = pairs.find(
            (p) =>
              p.leftId.toLowerCase() === kStr ||
              p.leftText.toLowerCase() === kStr ||
              p.leftText.toLowerCase().includes(kStr)
          );
          const right = pairs.find(
            (p) =>
              p.rightId.toLowerCase() === vStr ||
              p.rightText.toLowerCase() === vStr ||
              p.rightText.toLowerCase().includes(vStr)
          );
          if (left && right) {
            result[left.leftId] = right.rightId;
          }
        }
        if (Object.keys(result).length > 0) {
          return result;
        }
      }
    } catch {}
  }

  const leftItems = pairs.map((p, idx) => ({
    id: p.leftId,
    text: p.leftText || (p as any).left || (p as any).term || (p as any).concept || '',
    idx,
  }));

  const rightItems = (displayedRightPairs.length > 0 ? displayedRightPairs : pairs).map((p, idx) => ({
    id: p.rightId,
    text: p.rightText || (p as any).right || (p as any).definition || (p as any).desc || '',
    idx,
  }));

  function findMatchingLeft(text: string): string | null {
    const t = text.trim();
    if (!t) return null;
    const tLower = t.toLowerCase();

    // Check single digit (1-based index)
    if (/^\d+$/.test(t)) {
      const num = parseInt(t, 10);
      if (num >= 1 && num <= leftItems.length) {
        return leftItems[num - 1].id;
      }
    }
    // Check single letter (A, B, C...)
    if (/^[a-zA-Z]$/.test(t)) {
      const idx = tLower.charCodeAt(0) - 97;
      if (idx >= 0 && idx < leftItems.length) {
        return leftItems[idx].id;
      }
    }

    let bestScore = 0;
    let bestId: string | null = null;
    for (const item of leftItems) {
      if (item.id.toLowerCase() === tLower) return item.id;
      const score = scoreMatchText(t, item.text);
      if (score > bestScore && score >= 20) {
        bestScore = score;
        bestId = item.id;
      }
    }
    return bestId;
  }

  function findMatchingRight(text: string): string | null {
    const t = text.trim();
    if (!t) return null;
    const tLower = t.toLowerCase();

    // Check single digit (1-based index referring to displayed right column position)
    if (/^\d+$/.test(t)) {
      const num = parseInt(t, 10);
      if (num >= 1 && num <= rightItems.length) {
        return rightItems[num - 1].id;
      }
    }
    // Check single letter (A, B, C...)
    if (/^[a-zA-Z]$/.test(t)) {
      const idx = tLower.charCodeAt(0) - 97;
      if (idx >= 0 && idx < rightItems.length) {
        return rightItems[idx].id;
      }
    }

    let bestScore = 0;
    let bestId: string | null = null;
    for (const item of rightItems) {
      if (item.id.toLowerCase() === tLower) return item.id;
      const score = scoreMatchText(t, item.text);
      if (score > bestScore && score >= 20) {
        bestScore = score;
        bestId = item.id;
      }
    }
    return bestId;
  }

  // 2. Clause-based parsing
  const clauseRegex = /[,;\n|]+|(?:\s+(?:und\s+dann|and\s+then|und\s+auch|und|and|sowie|also)\s+)/i;
  const rawClauses = raw.split(clauseRegex).map((c) => c.trim()).filter((c) => c.length >= 2);

  const connectorRegex = /(?:->|=>|→|:|=|\s+-\s+|\bgeh[öo]rt\s+zu\b|\bverbinde[nt]?\s+mit\b|\bmatches?\s+with\b|\bconnects?\s+to\b|\bpaired\s+with\b|\bmit\b|\bwith\b|\bzu\b|\bto\b|\bfür\b|\bfor\b|\bist\b|\bis\b)/i;

  for (const clause of rawClauses) {
    if (connectorRegex.test(clause)) {
      const parts = clause.split(connectorRegex);
      if (parts.length >= 2) {
        const leftPart = parts[0].trim();
        const rightPart = parts.slice(1).join(' ').trim();
        const leftId = findMatchingLeft(leftPart);
        const rightId = findMatchingRight(rightPart);
        if (leftId && rightId) {
          // Clean 1-to-1 match
          for (const [existingL, existingR] of Object.entries(result)) {
            if (existingR === rightId) delete result[existingL];
          }
          result[leftId] = rightId;
          continue;
        }
      }
    }

    // Direct clause scan
    let bestLId: string | null = null;
    let bestLScore = 0;
    for (const item of leftItems) {
      const score = scoreMatchText(clause, item.text);
      if (score > bestLScore && score >= 20) {
        bestLScore = score;
        bestLId = item.id;
      }
    }

    let bestRId: string | null = null;
    let bestRScore = 0;
    for (const item of rightItems) {
      const score = scoreMatchText(clause, item.text);
      if (score > bestRScore && score >= 20) {
        bestRScore = score;
        bestRId = item.id;
      }
    }

    if (bestLId && bestRId) {
      for (const [existingL, existingR] of Object.entries(result)) {
        if (existingR === bestRId) delete result[existingL];
      }
      result[bestLId] = bestRId;
    }
  }

  // 3. Positional / Proximity Fallback across full text
  if (Object.keys(result).length < pairs.length) {
    const rawLower = raw.toLowerCase();
    const lPositions: { id: string; pos: number }[] = [];

    for (const lItem of leftItems) {
      if (result[lItem.id]) continue;
      const pos = rawLower.indexOf(lItem.text.toLowerCase());
      if (pos !== -1) {
        lPositions.push({ id: lItem.id, pos });
      }
    }

    lPositions.sort((a, b) => a.pos - b.pos);

    for (let i = 0; i < lPositions.length; i++) {
      const l = lPositions[i];
      const nextLPos = i + 1 < lPositions.length ? lPositions[i + 1].pos : rawLower.length;

      let bestRId: string | null = null;
      let minRPos = Infinity;

      for (const rItem of rightItems) {
        const rPos = rawLower.indexOf(rItem.text.toLowerCase(), l.pos);
        if (rPos !== -1 && rPos < nextLPos && rPos < minRPos) {
          minRPos = rPos;
          bestRId = rItem.id;
        }
      }

      if (bestRId) {
        for (const [existingL, existingR] of Object.entries(result)) {
          if (existingR === bestRId) delete result[existingL];
        }
        result[l.id] = bestRId;
      }
    }
  }

  return result;
}

// ─── Sequence Ordering Voice & Speech Answer Parser ───────────────
export function parseOrderingVoiceAnswer(
  answerPayload: any,
  options: QuizOption[],
  currentOrdering?: string[]
): string[] {
  const opts = options || [];
  if (opts.length === 0) return [];

  // Build word frequency map to identify distinctive keywords per option
  const wordFreq: Record<string, number> = {};
  const optWordsList = opts.map((o) => {
    // Strip leading numbering e.g. "1. Bereitstellung" -> "Bereitstellung"
    const cleanText = (o.text || '').replace(/^[0-9]+[.\-)]\s*/, '').toLowerCase();
    const words = cleanText
      .split(/[\s,.;:->=_|/()[\]{}]+/)
      .filter((w) => w.length >= 3);
    const uniqueInOpt = Array.from(new Set(words));
    for (const w of uniqueInOpt) {
      wordFreq[w] = (wordFreq[w] || 0) + 1;
    }
    return uniqueInOpt;
  });

  const optDistinctiveWords = optWordsList.map((words) =>
    words.filter((w) => wordFreq[w] === 1)
  );

  function scoreOption(t: string, optIdx: number): number {
    const opt = opts[optIdx];
    const tLower = t.toLowerCase().trim().replace(/^[0-9]+[.\-)]\s*/, '');
    if (!tLower || !opt) return 0;

    const rawOptText = (opt.text || '').toLowerCase().trim();
    const cleanOptText = rawOptText.replace(/^[0-9]+[.\-)]\s*/, '');
    const oIdLower = opt.id.toLowerCase();
    const oLabelLower = (opt.label || '').toLowerCase();

    // Direct ID or Label match
    if (oIdLower === tLower || oLabelLower === tLower) return 200;

    // Number match: if t is "1", "2", etc.
    if (/^\d+$/.test(t.trim())) {
      const num = parseInt(t.trim(), 10);
      if (opt.order === num || oLabelLower === String(num) || optIdx === num - 1) return 180;
    }

    // Letter match: if t is "a", "b", etc.
    if (/^[a-z]$/i.test(t.trim())) {
      const idx = t.trim().toLowerCase().charCodeAt(0) - 97;
      if (oLabelLower === t.trim().toLowerCase() || optIdx === idx) return 180;
    }

    // Full exact text match
    if (tLower === cleanOptText || tLower === rawOptText) return 150;
    if (tLower.includes(cleanOptText) || cleanOptText.includes(tLower)) return 120;

    let score = scoreMatchText(tLower, cleanOptText);

    // Boost score if token contains this option's distinctive unique words
    const distinctive = optDistinctiveWords[optIdx] || [];
    for (const dw of distinctive) {
      if (tLower.includes(dw)) {
        score += 80;
      }
    }

    return score;
  }

  // 1. Array payload handling
  if (Array.isArray(answerPayload) && answerPayload.length > 0) {
    const matchedIds: string[] = [];
    for (const item of answerPayload) {
      const strItem = String(item).trim();
      let bestIdx = -1;
      let bestScore = 0;

      for (let i = 0; i < opts.length; i++) {
        if (matchedIds.includes(opts[i].id)) continue;
        const s = scoreOption(strItem, i);
        if (s > bestScore && s >= 20) {
          bestScore = s;
          bestIdx = i;
        }
      }

      if (bestIdx !== -1) {
        matchedIds.push(opts[bestIdx].id);
      }
    }

    if (matchedIds.length > 0) {
      const prevOrder = currentOrdering || opts.map((o) => o.id);
      for (const id of prevOrder) {
        if (!matchedIds.includes(id)) {
          matchedIds.push(id);
        }
      }
      return matchedIds;
    }
  }

  // 2. String payload handling
  if (typeof answerPayload === 'string' && answerPayload.trim()) {
    const raw = answerPayload.trim();

    // Check for JSON array string
    if (raw.startsWith('[') && raw.endsWith(']')) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parseOrderingVoiceAnswer(parsed, opts, currentOrdering);
        }
      } catch {}
    }

    const splitRegex = /[,;\n\->|]+|(?:\s+(?:dann|then|und\s+dann|and\s+then|danach|als\s+nächstes|next|afterwards|und|and)\s+)/i;
    const rawTokens = raw.split(splitRegex).map((t) => t.trim()).filter(Boolean);

    const matchedIds: string[] = [];
    for (const token of rawTokens) {
      let bestIdx = -1;
      let bestScore = 0;

      for (let i = 0; i < opts.length; i++) {
        if (matchedIds.includes(opts[i].id)) continue;
        const s = scoreOption(token, i);
        if (s > bestScore && s >= 20) {
          bestScore = s;
          bestIdx = i;
        }
      }

      if (bestIdx !== -1) {
        matchedIds.push(opts[bestIdx].id);
      }
    }

    // 3. Sequential occurrence scan across full speech string for any unmatched options
    if (matchedIds.length < opts.length) {
      const rawLower = raw.toLowerCase();
      const posList: { optId: string; pos: number }[] = [];

      for (let i = 0; i < opts.length; i++) {
        const opt = opts[i];
        if (matchedIds.includes(opt.id)) continue;

        let bestPos = -1;
        const cleanOpt = (opt.text || '').replace(/^[0-9]+[.\-)]\s*/, '').toLowerCase();
        const fullPos = rawLower.indexOf(cleanOpt);
        if (fullPos !== -1) {
          bestPos = fullPos;
        } else {
          const distinctive = optDistinctiveWords[i] || [];
          for (const dw of distinctive) {
            const p = rawLower.indexOf(dw);
            if (p !== -1 && (bestPos === -1 || p < bestPos)) {
              bestPos = p;
            }
          }
        }

        if (bestPos !== -1) {
          posList.push({ optId: opt.id, pos: bestPos });
        }
      }

      posList.sort((a, b) => a.pos - b.pos);
      for (const p of posList) {
        if (!matchedIds.includes(p.optId)) {
          matchedIds.push(p.optId);
        }
      }
    }

    if (matchedIds.length > 0) {
      const prevOrder = currentOrdering || opts.map((o) => o.id);
      for (const id of prevOrder) {
        if (!matchedIds.includes(id)) {
          matchedIds.push(id);
        }
      }
      return matchedIds;
    }
  }

  return currentOrdering || opts.map((o) => o.id);
}
