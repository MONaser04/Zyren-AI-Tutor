/**
 * TreeDiagramModel — canonical, recursive model for concept-tree and flowchart diagrams.
 *
 * Why this exists:
 *  - The AI describes trees in many shapes: an explicit `root` + flat `nodes`, a single
 *    node carrying nested `children`, `parent` pointers, or a sub-tree attached to an
 *    existing node. Every one of these is normalised here into ONE structure.
 *  - A diagram on the board keeps its model. When the AI later expands a node (via
 *    `attachToNode`) or re-sends the same tree/flowchart with more detail, the SyncEngine
 *    merges the request into the stored model and re-lays out the WHOLE diagram in place,
 *    so branches stay aligned, never duplicate, and never cross each other.
 */
import type { DiagramNode, DiagramOptions, TreeModelNode } from '../types';

const PLACEHOLDER_RE = /^[\s.\u2026?\-_\u2013\u2014*•·]*$/;

const GENERIC_DIAGRAM_WORDS = new Set([
  'tree',
  'diagram',
  'map',
  'overview',
  'types',
  'type',
  'branches',
  'branch',
  'categories',
  'category',
  'taxonomy',
  'hierarchy',
  'hierarchical',
  'sub',
  'points',
  'subtypes',
  'subpoints',
  'subtopic',
  'subtopics',
  'main',
  'complete',
  'simplified',
  'expanded',
  'final',
  'updated',
  'redraw',
  'chart',
  'flowchart',
  'process',
  'structure',
  'model',
  'concept',
  'concepts',
  'handwritten',
  'handwriting',
  'of',
  'the',
  'in',
  'for',
  'and',
  'to',
  'from',
  'with',
  'a',
  'an',
]);

/** True for labels that carry no content ("", "...", "…", "?", "-"), which render as empty boxes. */
export function isPlaceholderLabel(label: string | undefined | null): boolean {
  const trimmed = String(label ?? '').trim();
  if (PLACEHOLDER_RE.test(trimmed)) return true;
  if (/^(empty|blank|placeholder|empty\s+box|box)$/i.test(trimmed)) return true;
  return false;
}

/** Case/spacing/punctuation-insensitive key used to match node labels. */
export function normalizeLabel(label: string | undefined | null): string {
  return String(label ?? '')
    .toLowerCase()
    .replace(/\\n|\n/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Extracts the core domain topic by stripping generic diagram/structural suffixes. */
export function extractCoreTopic(text: string | undefined | null): string {
  const norm = normalizeLabel(text);
  if (!norm) return '';
  const tokens = norm.split(/\s+/).filter((t) => t && !GENERIC_DIAGRAM_WORDS.has(t));
  return tokens.join(' ').trim();
}

function cleanItem(item: unknown): string {
  return String(item ?? '').replace(/\\n|\n/g, ' ').trim();
}

function uniqueItems(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const it = cleanItem(raw);
    if (!it || isPlaceholderLabel(it)) continue;
    const key = normalizeLabel(it);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

export function cloneTree(node: TreeModelNode): TreeModelNode {
  return {
    label: node.label,
    items: [...(node.items || [])],
    children: (node.children || []).map(cloneTree),
    ...(node.color ? { color: node.color } : {}),
  };
}

/** Safely parses Python dictionary strings, JSON objects, or JS object literals if passed as a string. */
export function tryParseDictOrJson(raw: unknown): any {
  if (!raw || typeof raw !== 'string') return null;
  const str = raw.trim();
  if (!str.startsWith('{') || !str.endsWith('}')) return null;

  try {
    const parsed = JSON.parse(str);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}

  try {
    const jsonStr = str
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false')
      .replace(/\bNone\b/g, 'null');
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {}

  try {
    const fn = new Function(`return (${str})`);
    const res = fn();
    if (res && typeof res === 'object') return res;
  } catch {}

  return null;
}

/** Converts an arbitrary AI DiagramNode (with optional nested children) into a model node. */
export function diagramNodeToModel(n: DiagramNode): TreeModelNode {
  const rawLabel = n?.label ?? n?.text ?? (n as any)?.root_text ?? n?.name;
  let label = isPlaceholderLabel(rawLabel) ? '' : String(rawLabel).replace(/\\n/g, '\n').trim();
  let items = uniqueItems(Array.isArray(n?.items) ? n.items : []);
  let children = (Array.isArray(n?.children) ? n.children : [])
    .filter((c) => c && typeof c === 'object')
    .map(diagramNodeToModel);

  const parsedLabelObj = tryParseDictOrJson(label);
  if (parsedLabelObj && typeof parsedLabelObj === 'object') {
    label = parsedLabelObj.label || parsedLabelObj.text || parsedLabelObj.root_text || parsedLabelObj.name || parsedLabelObj.title || '';
    if (items.length === 0 && Array.isArray(parsedLabelObj.items)) {
      items = uniqueItems(parsedLabelObj.items);
    }
    if (children.length === 0 && Array.isArray(parsedLabelObj.children)) {
      children = parsedLabelObj.children.filter((c: any) => c && typeof c === 'object').map(diagramNodeToModel);
    }
  }

  return {
    label,
    items,
    children,
    ...(n?.color ? { color: n.color } : {}),
  };
}

/** Converts model children back to DiagramNodes (used for serialisation / debugging). */
export function modelToDiagramNodes(children: TreeModelNode[]): DiagramNode[] {
  return children.map((c) => ({
    label: c.label,
    items: [...c.items],
    ...(c.color ? { color: c.color } : {}),
    children: modelToDiagramNodes(c.children),
  }));
}

/**
 * Builds the canonical tree model from raw diagram options.
 * Root reconciliation and parent-pointer semantics are preserved from the original
 * generator; nested `children` are now real child boxes (never silently flattened).
 */
export function buildTreeModelFromOptions(options: DiagramOptions): TreeModelNode {
  if (options.treeModel) return cloneTree(options.treeModel);

  let rawRoot = options.root || (options as any).root_text || (options as any).root_label;
  let rawNodes: DiagramNode[] = Array.isArray(options.nodes) ? [...options.nodes] : Array.isArray((options as any).children) ? [...(options as any).children] : [];

  if (typeof rawRoot === 'object' && rawRoot !== null) {
    const rootObj = rawRoot as any;
    rawRoot = rootObj.label || rootObj.text || rootObj.root_text || rootObj.name || rootObj.root || rootObj.title || options.title;
    if (rawNodes.length === 0 && Array.isArray(rootObj.children) && rootObj.children.length > 0) {
      rawNodes = [...rootObj.children];
    }
  }

  const parsedRootObj = tryParseDictOrJson(rawRoot);
  if (parsedRootObj && typeof parsedRootObj === 'object') {
    rawRoot = parsedRootObj.label || parsedRootObj.text || parsedRootObj.root_text || parsedRootObj.name || parsedRootObj.root || parsedRootObj.title || options.title;
    if (rawNodes.length === 0 && Array.isArray(parsedRootObj.children) && parsedRootObj.children.length > 0) {
      rawNodes = [...parsedRootObj.children];
    }
  }

  const parsedTitleObj = tryParseDictOrJson(options.title);
  if (parsedTitleObj && typeof parsedTitleObj === 'object') {
    if (!rawRoot || rawRoot === options.title) {
      rawRoot = parsedTitleObj.label || parsedTitleObj.text || parsedTitleObj.root_text || parsedTitleObj.name || parsedTitleObj.root || parsedTitleObj.title;
    }
    if (rawNodes.length === 0 && Array.isArray(parsedTitleObj.children) && parsedTitleObj.children.length > 0) {
      rawNodes = [...parsedTitleObj.children];
    }
  }

  rawNodes = rawNodes.map((n) => {
    if (typeof n === 'string') {
      const parsed = tryParseDictOrJson(n);
      return (parsed && typeof parsed === 'object') ? parsed : { label: n, items: [] };
    }
    if (n && typeof n === 'object') {
      const resolvedLabel = n.label ?? n.text ?? n.name;
      return {
        ...n,
        label: typeof resolvedLabel === 'string' ? resolvedLabel : (resolvedLabel != null ? String(resolvedLabel) : ''),
      };
    }
    return n;
  }).filter(
    (n) => n && typeof n === 'object' && typeof n.label === 'string'
  );

  const isHandwriting =
    options.writingStyle === 'handwriting' ||
    /handwritten|handwriting/i.test(options.title || '') ||
    /handwritten|handwriting/i.test(options.root || '');

  let rootLabel = (rawRoot || options.title || 'Concept').trim();
  const cleanTitle = (options.title || '')
    .replace(/\b(tree|redraw|diagram|overview|map|handwritten|handwriting)\b/gi, '')
    .trim()
    .toLowerCase();

  if (isHandwriting) {
    rootLabel = rootLabel.replace(/\b(handwritten|handwriting)\b/gi, '').trim();
    if (!rootLabel) {
      rootLabel =
        (options.title || 'Concept').replace(/\b(handwritten|handwriting|tree|redraw|diagram)\b/gi, '').trim() ||
        'Concept';
    }
  }

  let candidateRootIndex = rawNodes.findIndex((n) => {
    const lbl = (n.label || '').trim().toLowerCase();
    if (!lbl || isPlaceholderLabel(lbl)) return false;
    const id = (n.id || '').trim().toLowerCase();
    const r = rootLabel.toLowerCase();
    const t = (options.title || '').trim().toLowerCase();
    return (
      id.includes('root') ||
      (id && (id === r || id === t)) ||
      lbl === r ||
      lbl === t ||
      (cleanTitle && (lbl.includes(cleanTitle) || cleanTitle.includes(lbl))) ||
      t.includes(lbl) ||
      r.includes(lbl) ||
      (id === 'ml' && lbl.includes('machine learning')) ||
      (r.includes('ml') && lbl.includes('machine learning'))
    );
  });

  // A single top-level node that carries nested children IS the root of the hierarchy.
  if (
    candidateRootIndex === -1 &&
    !options.root &&
    rawNodes.length === 1 &&
    Array.isArray(rawNodes[0].children) &&
    rawNodes[0].children.length > 0
  ) {
    candidateRootIndex = 0;
  }

  let topNodes: DiagramNode[] = [...rawNodes];
  let rootId: string | undefined;
  let rootItems: string[] = [];
  let rootColor: string | undefined;

  if (candidateRootIndex !== -1) {
    const rootNode = rawNodes[candidateRootIndex];
    rootId = rootNode.id;
    if (rootNode.label && rootNode.label.trim()) {
      rootLabel = rootNode.label.trim();
      if (isHandwriting) rootLabel = rootLabel.replace(/\b(handwritten|handwriting)\b/gi, '').trim();
    }
    rootItems = Array.isArray(rootNode.items) ? rootNode.items : [];
    rootColor = rootNode.color;
    topNodes.splice(candidateRootIndex, 1);
    if (Array.isArray(rootNode.children) && rootNode.children.length > 0) {
      topNodes = [...rootNode.children, ...topNodes];
    }
  }

  // Parent-pointer hierarchy among flat nodes: a node pointing to a sibling becomes a bullet
  // item of that sibling (legacy contract); pointing to the root makes it a direct branch.
  const keyOf = (n: DiagramNode) => {
    const rawLbl = n.label ?? n.text ?? n.name;
    return (n.id || '').trim() || (isPlaceholderLabel(rawLbl) ? '' : (rawLbl || '').trim());
  };
  const modelByKey = new Map<string, TreeModelNode>();
  for (const n of topNodes) {
    const key = keyOf(n);
    const mapKey = key || `__placeholder_${modelByKey.size}`;
    if (!modelByKey.has(mapKey)) modelByKey.set(mapKey, diagramNodeToModel(n));
  }

  const attached = new Set<string>();
  for (const n of topNodes) {
    const key = keyOf(n);
    if (!key) continue;
    let parentKey = (n.parentId || n.parent || '').trim();
    const pk = parentKey.toLowerCase();
    const optRootStr = typeof options.root === 'string' ? options.root : (options.root && typeof options.root === 'object' ? (options.root as any).label || (options.root as any).text || (options.root as any).name || '' : '');
    const optTitleStr = typeof options.title === 'string' ? options.title : (options.title && typeof options.title === 'object' ? (options.title as any).label || (options.title as any).text || (options.title as any).name || '' : '');
    if (
      (rootId && pk === rootId.toLowerCase()) ||
      pk === rootLabel.toLowerCase() ||
      (optRootStr && pk === optRootStr.toLowerCase()) ||
      (optTitleStr && pk === optTitleStr.toLowerCase())
    ) {
      parentKey = '';
    }
    if (!parentKey && n.id) {
      for (const pKey of modelByKey.keys()) {
        if (pKey !== n.id && (n.id.startsWith(`${pKey}_`) || n.id.startsWith(`${pKey}-`))) {
          parentKey = pKey;
          break;
        }
      }
    }
    if (parentKey && modelByKey.has(parentKey) && parentKey !== key) {
      const parent = modelByKey.get(parentKey)!;
      const text = cleanItem(n.label);
      if (text && !parent.items.includes(text)) parent.items.push(text);
      attached.add(key);
    }
  }

  const children: TreeModelNode[] = [];
  for (const [key, model] of modelByKey.entries()) {
    if (!attached.has(key)) children.push(model);
  }

  const root: TreeModelNode = {
    label: rootLabel,
    items: uniqueItems(rootItems),
    children,
    ...(rootColor ? { color: rootColor } : {}),
  };

  // Concept-card style: bullets passed at diagram level with no child branches.
  if (children.length === 0 && Array.isArray(options.items) && options.items.length > 0) {
    root.items = uniqueItems([...root.items, ...options.items]);
  }
  return root;
}

/** Depth-first search for a node whose label matches `label` (exact first, then containment). */
export function findNodeByLabel(root: TreeModelNode, label: string): TreeModelNode | null {
  const target = normalizeLabel(label);
  if (!target) return null;
  let partial: TreeModelNode | null = null;
  const stack: TreeModelNode[] = [root];
  while (stack.length > 0) {
    const node = stack.shift()!;
    const key = normalizeLabel(node.label);
    if (key && key === target) return node;
    if (!partial && key && (key.includes(target) || target.includes(key)) && Math.min(key.length, target.length) >= 4) {
      partial = node;
    }
    stack.push(...node.children);
  }
  return partial;
}

/**
 * Merges `incoming` children into `target` (in place):
 *  - children with the same label are unified recursively (items unioned);
 *  - new labelled children are appended;
 *  - empty placeholder boxes are filled by real children when the AI later supplies them,
 *    and are matched by position against existing placeholders (never duplicated).
 */
export function mergeChildrenInto(target: TreeModelNode, incoming: TreeModelNode[]): void {
  const incomingReal = incoming.filter((c) => !isPlaceholderLabel(c.label));
  const incomingEmpty = incoming.filter((c) => isPlaceholderLabel(c.label));

  if (
    incomingReal.length > 0 &&
    target.children.length > 0 &&
    target.children.every((c) => isPlaceholderLabel(c.label) && c.children.length === 0)
  ) {
    target.children = [];
  }

  for (const child of incomingReal) {
    const key = normalizeLabel(child.label);
    const existing = target.children.find((c) => normalizeLabel(c.label) === key);
    if (existing) {
      mergeNodeInto(existing, child);
    } else {
      target.children.push(cloneTree(child));
    }
  }

  const existingEmpty = target.children.filter((c) => isPlaceholderLabel(c.label));
  incomingEmpty.forEach((child, idx) => {
    if (idx < existingEmpty.length) {
      mergeNodeInto(existingEmpty[idx], child);
    } else if (incomingReal.length === 0) {
      target.children.push(cloneTree(child));
    }
  });
}

/** Merges node `src` into node `dst` (same logical node). */
export function mergeNodeInto(dst: TreeModelNode, src: TreeModelNode): void {
  if (!isPlaceholderLabel(src.label)) {
    if (
      isPlaceholderLabel(dst.label) ||
      (normalizeLabel(dst.label) !== normalizeLabel(src.label) &&
        coreTopicsMatch(dst.label, src.label) &&
        src.label.trim().length > dst.label.trim().length)
    ) {
      dst.label = src.label.trim();
    }
  }
  if (src.items && src.items.length > 0) {
    dst.items = uniqueItems(src.items);
  } else {
    dst.items = uniqueItems(dst.items || []);
  }
  if (!dst.color && src.color) dst.color = src.color;
  mergeChildrenInto(dst, src.children || []);
  // If any bullet item was promoted to a child box, remove the redundant bullet item
  if (dst.children.length > 0 && dst.items.length > 0) {
    const childKeys = new Set(dst.children.map((c) => normalizeLabel(c.label)).filter(Boolean));
    dst.items = dst.items.filter((itm) => {
      const ik = normalizeLabel(itm);
      if (!ik) return false;
      if (childKeys.has(ik)) return false;
      for (const ck of childKeys) {
        if (ck.length >= 4 && ik.startsWith(ck)) return false;
      }
      return true;
    });
  }
}

function coreTopicsMatch(a: string, b: string): boolean {
  const ca = extractCoreTopic(a);
  const cb = extractCoreTopic(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  if ((ca === 'ml' && cb === 'machine learning') || (cb === 'ml' && ca === 'machine learning')) return true;
  if (Math.min(ca.length, cb.length) >= 4 && (ca.includes(cb) || cb.includes(ca))) return true;
  return false;
}

/**
 * Determines whether an incoming tree diagram is an update, expansion, or sub-branch
 * of an existing tree diagram on the active slide.
 */
export function isSameOrRelatedTree(
  existing: TreeModelNode,
  existingTitle: string,
  incoming: TreeModelNode,
  incomingTitle: string,
  attachToNode?: string
): boolean {
  if (attachToNode && findNodeByLabel(existing, attachToNode)) {
    return true;
  }

  const exRoot = normalizeLabel(existing.label);
  const inRoot = normalizeLabel(incoming.label);
  if (exRoot && inRoot && exRoot === inRoot) return true;
  if (coreTopicsMatch(existing.label, incoming.label)) return true;
  if (existingTitle && incomingTitle && coreTopicsMatch(existingTitle, incomingTitle)) return true;

  if (inRoot && findNodeByLabel(existing, incoming.label)) return true;

  const realIncomingChildren = incoming.children.filter((c) => !isPlaceholderLabel(c.label));
  if (realIncomingChildren.length > 0 && existing.children.length > 0) {
    const matchCount = realIncomingChildren.filter((c) => findNodeByLabel(existing, c.label) !== null).length;
    if (matchCount >= 2 || (matchCount >= 1 && matchCount / realIncomingChildren.length >= 0.5)) {
      return true;
    }
  }

  return false;
}

/**
 * Merges `incoming` into `existing` in place. Returns true if the merge succeeded.
 */
export function mergeIncomingTreeIntoExisting(
  existing: TreeModelNode,
  incoming: TreeModelNode,
  attachToNode?: string,
  incomingTitle?: string
): boolean {
  if (attachToNode) {
    const target = findNodeByLabel(existing, attachToNode);
    if (!target) return false;

    if (incoming.children.length > 0) {
      const inNorm = normalizeLabel(incoming.label);
      const tNorm = normalizeLabel(target.label);
      const titleNorm = normalizeLabel(incomingTitle || '');
      const wrapperRe =
        /\b(sub|types|categories|points|branches|details|children|tasks|applications|examples|methods|algorithms|overview|tree|diagram)\b/i;
      const isWrapper =
        !inNorm ||
        inNorm === tNorm ||
        inNorm === titleNorm ||
        coreTopicsMatch(incoming.label, target.label) ||
        wrapperRe.test(incoming.label);

      if (isWrapper) {
        let childrenToMerge = incoming.children;
        if (childrenToMerge.length === 1) {
          const single = childrenToMerge[0];
          const singleIsWrapper =
            !isPlaceholderLabel(single.label) &&
            (wrapperRe.test(single.label) || coreTopicsMatch(single.label, target.label));
          if (singleIsWrapper) {
            if (single.children.length > 0) {
              childrenToMerge = single.children;
            } else if (single.items.length > 0) {
              childrenToMerge = single.items.map((it) => ({
                label: it,
                items: [],
                children: [],
                ...(single.color ? { color: single.color } : {}),
              }));
            }
          }
        }
        target.items = uniqueItems([...(target.items || []), ...(incoming.items || [])]);
        mergeChildrenInto(target, childrenToMerge);
      } else {
        mergeChildrenInto(target, [incoming]);
      }
    } else {
      const inNorm = normalizeLabel(incoming.label);
      const tNorm = normalizeLabel(target.label);
      if (inNorm && inNorm === tNorm && incoming.items.length > 0) {
        target.items = uniqueItems([...(target.items || []), ...incoming.items]);
      } else {
        mergeChildrenInto(target, [incoming]);
      }
    }
    return true;
  }

  const exRoot = normalizeLabel(existing.label);
  const inRoot = normalizeLabel(incoming.label);
  const rootMatches =
    (exRoot && inRoot && exRoot === inRoot) || coreTopicsMatch(existing.label, incoming.label);
  const childrenOverlap =
    incoming.children.length > 0 &&
    incoming.children.some((c) => !isPlaceholderLabel(c.label) && findNodeByLabel(existing, c.label) !== null);

  if (rootMatches || childrenOverlap) {
    const incomingHadNoItems = !treeHasAnyItems(incoming);
    const incomingCoversFullStructure =
      countTreeNodes(incoming) >= countTreeNodes(existing) && treeDepth(incoming) >= treeDepth(existing);
    mergeNodeInto(existing, incoming);
    if (incomingHadNoItems && incomingCoversFullStructure) {
      clearTreeItems(existing);
    }
    return true;
  }

  if (inRoot) {
    const internalTarget = findNodeByLabel(existing, incoming.label);
    if (internalTarget) {
      mergeNodeInto(internalTarget, incoming);
      return true;
    }
  }

  return false;
}

/** Normalizes a flowchart step label so "15. Box 15", "Step 1: Input", and "Box 15" match reliably. */
export function normalizeStepLabel(label: string | undefined | null): string {
  const raw = String(label ?? '').trim();
  const stripped = raw.replace(/^\s*(?:step\s*\d+\s*[:.\-]\s*|\d+\.\s*)/i, '').trim();
  return normalizeLabel(stripped || raw);
}

/**
 * Checks whether an incoming diagram call is a continuation or in-place update of an
 * existing flowchart on the current slide (e.g. extending 15 boxes -> 30 boxes).
 */
export function isContinuationOfFlowchart(
  existingNodes: DiagramNode[],
  existingTitle: string,
  incomingOptions: DiagramOptions
): boolean {
  const inNodes = incomingOptions.nodes || [];
  if (existingNodes.length === 0 || inNodes.length === 0) return false;

  const dType = (incomingOptions.diagramType || 'tree').toLowerCase();
  const isFlowType = dType === 'flowchart' || dType === 'process' || dType === 'hybrid';

  if (incomingOptions.attachToNode) {
    const att = normalizeStepLabel(incomingOptions.attachToNode);
    const matchesExistingStep = existingNodes.some((n) => {
      const nl = normalizeStepLabel(n.label);
      return nl && att && (nl === att || nl.includes(att) || att.includes(nl));
    });
    if (matchesExistingStep) {
      const looksSequential =
        isFlowType ||
        (incomingOptions.direction || '').toUpperCase() === 'LR' ||
        inNodes.length >= 4 ||
        /continuation|flowchart|boxes|steps|pipeline/i.test(incomingOptions.title || '') ||
        inNodes.some((n) => /\b(box|step)\s*\d+/i.test(n.label || ''));
      if (looksSequential) return true;
    }
  }

  if (!isFlowType) return false;

  const exSet = new Set(existingNodes.map((n) => normalizeStepLabel(n.label)).filter(Boolean));
  const overlap = inNodes.filter((n) => exSet.has(normalizeStepLabel(n.label))).length;
  if (overlap >= Math.min(2, existingNodes.length)) return true;

  if (existingTitle && incomingOptions.title && coreTopicsMatch(existingTitle, incomingOptions.title)) {
    return true;
  }

  return false;
}

/** Merges incoming flowchart steps into an existing flowchart step list in order without duplicates. */
export function mergeFlowchartNodes(
  existingNodes: DiagramNode[],
  incomingNodes: DiagramNode[]
): DiagramNode[] {
  const result: DiagramNode[] = existingNodes.map((n) => ({
    ...n,
    items: [...(n.items || [])],
    ...(n.children ? { children: [...n.children] } : {}),
  }));

  const indexByKey = new Map<string, number>();
  result.forEach((n, idx) => {
    const k = normalizeStepLabel(n.label);
    if (k && !indexByKey.has(k)) indexByKey.set(k, idx);
  });

  for (const inc of incomingNodes) {
    if (!inc || typeof inc.label !== 'string') continue;
    const k = normalizeStepLabel(inc.label);
    if (k && indexByKey.has(k)) {
      const idx = indexByKey.get(k)!;
      const cur = result[idx];
      cur.items = uniqueItems([...(cur.items || []), ...(inc.items || [])]);
      if (inc.flow && inc.flow !== 'auto') cur.flow = inc.flow;
      if (inc.children && inc.children.length > 0) cur.children = [...inc.children];
    } else {
      const copy: DiagramNode = {
        ...inc,
        items: uniqueItems(inc.items || []),
      };
      indexByKey.set(k || `__step_${result.length}`, result.length);
      result.push(copy);
    }
  }

  return result;
}

export function countTreeNodes(root: TreeModelNode): number {
  return 1 + root.children.reduce((sum, c) => sum + countTreeNodes(c), 0);
}

export function countTreeLeaves(root: TreeModelNode): number {
  if (root.children.length === 0) return 1;
  return root.children.reduce((sum, c) => sum + countTreeLeaves(c), 0);
}

export function treeHasAnyItems(root: TreeModelNode): boolean {
  if (root.items && root.items.length > 0) return true;
  return root.children.some(treeHasAnyItems);
}

export function clearTreeItems(root: TreeModelNode): void {
  root.items = [];
  root.children.forEach(clearTreeItems);
}

export function treeDepth(root: TreeModelNode): number {
  return root.children.length === 0 ? 0 : 1 + Math.max(...root.children.map(treeDepth));
}
