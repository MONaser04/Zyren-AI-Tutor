import React, { useMemo } from 'react';
import type { WhiteboardPage } from './SlidePanel';

interface SlideThumbnailProps {
  page: WhiteboardPage;
  isActive?: boolean;
}

export function formatLatexForMiniPreview(raw: string): { display: string; boxed: boolean } {
  if (!raw) return { display: '', boxed: false };
  let s = raw.trim();
  let boxed = false;
  if (/\\boxed\s*\{/.test(s)) {
    boxed = true;
    s = s.replace(/\\boxed\s*\{([\s\S]*)\}/g, '$1');
  }
  s = s
    .replace(/\$\$/g, '')
    .replace(/\$/g, '')
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '($1)/($2)')
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, '√($1)')
    .replace(/\\cdot/g, '·')
    .replace(/\\times/g, '×')
    .replace(/\\div/g, '÷')
    .replace(/\\pm/g, '±')
    .replace(/\\leq|\\le/g, '≤')
    .replace(/\\geq|\\ge/g, '≥')
    .replace(/\\neq|\\ne/g, '≠')
    .replace(/\\approx/g, '≈')
    .replace(/\\rightarrow|\\to/g, '→')
    .replace(/\\Rightarrow/g, '⇒')
    .replace(/\\infty/g, '∞')
    .replace(/\\int/g, '∫')
    .replace(/\\sum/g, '∑')
    .replace(/\\pi/g, 'π')
    .replace(/\\alpha/g, 'α')
    .replace(/\\beta/g, 'β')
    .replace(/\\gamma/g, 'γ')
    .replace(/\\theta/g, 'θ')
    .replace(/\\Delta/g, 'Δ')
    .replace(/\\lambda/g, 'λ')
    .replace(/\^2(?![0-9])/g, '²')
    .replace(/\^3(?![0-9])/g, '³')
    .replace(/\\text\s*\{([^{}]+)\}/g, '$1')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { display: s || raw.slice(0, 32), boxed };
}

function wrapMiniHandwritingLines(text: string, fontSize: number, startX: number): string[] {
  if (!text) return [];
  const rawSegments = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .flatMap((line) => line.split(/(?=\s+(?:[-•*]|\d+[.)])\s+)/g));

  const maxCharsPerLine = Math.max(18, Math.floor((Math.max(460, 1850 - startX)) / (fontSize * 0.52)));
  const out: string[] = [];

  for (const seg of rawSegments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    if (trimmed.length <= maxCharsPerLine) {
      out.push(trimmed);
    } else {
      const words = trimmed.split(/\s+/);
      let current = '';
      for (const w of words) {
        if (!current) {
          current = w;
        } else if (current.length + 1 + w.length <= maxCharsPerLine) {
          current += ` ${w}`;
        } else {
          out.push(current);
          current = w;
        }
      }
      if (current) out.push(current);
    }
  }
  return out.slice(0, 8);
}

export const SlideThumbnail: React.FC<SlideThumbnailProps> = React.memo(({ page, isActive }) => {
  const shapes = page.shapes || [];
  const handwriting = page.handwriting || [];
  const userPaths = page.userPaths || [];
  const userTexts = page.userTexts || [];

  const isEmpty =
    shapes.length === 0 &&
    handwriting.length === 0 &&
    userPaths.length === 0 &&
    userTexts.length === 0;

  const renderedShapes = useMemo(() => {
    return shapes.map((shape, idx) => {
      const key = shape.id || `thumb-shape-${idx}`;
      const x = Number(shape.x ?? shape.position?.x ?? 0);
      const y = Number(shape.y ?? shape.position?.y ?? 0);
      const w = Number(shape.width ?? 160);
      const h = Number(shape.height ?? 90);
      const opts = shape.options || {};
      const stroke = opts.color || '#4ECDC4';

      switch (shape.shapeType) {
        case 'rectangle':
          return (
            <g key={key}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={10}
                fill={opts.fill || 'rgba(78, 205, 196, 0.12)'}
                stroke={stroke}
                strokeWidth={4}
              />
              {opts.label && (
                <text
                  x={x + w / 2}
                  y={y + h / 2 + 9}
                  fill="#FFFFFF"
                  fontSize={24}
                  fontWeight={600}
                  textAnchor="middle"
                  fontFamily="'Inter', sans-serif"
                >
                  {String(opts.label).slice(0, 28)}
                </text>
              )}
            </g>
          );

        case 'ellipse':
          return (
            <g key={key}>
              <ellipse
                cx={x + w / 2}
                cy={y + h / 2}
                rx={Math.max(12, w / 2)}
                ry={Math.max(12, h / 2)}
                fill={opts.fill || 'rgba(168, 85, 247, 0.14)'}
                stroke={stroke}
                strokeWidth={4}
              />
              {opts.label && (
                <text
                  x={x + w / 2}
                  y={y + h / 2 + 8}
                  fill="#FFFFFF"
                  fontSize={22}
                  fontWeight={600}
                  textAnchor="middle"
                  fontFamily="'Inter', sans-serif"
                >
                  {String(opts.label).slice(0, 24)}
                </text>
              )}
            </g>
          );

        case 'line':
        case 'arrow': {
          const x2 = Number(shape.toX ?? x + 120);
          const y2 = Number(shape.toY ?? y);
          const angle = Math.atan2(y2 - y, x2 - x);
          const headLen = 22;
          const p1x = x2 - headLen * Math.cos(angle - Math.PI / 6);
          const p1y = y2 - headLen * Math.sin(angle - Math.PI / 6);
          const p2x = x2 - headLen * Math.cos(angle + Math.PI / 6);
          const p2y = y2 - headLen * Math.sin(angle + Math.PI / 6);
          return (
            <g key={key}>
              <line x1={x} y1={y} x2={x2} y2={y2} stroke={stroke} strokeWidth={4.5} strokeLinecap="round" />
              {shape.shapeType === 'arrow' && (
                <polygon points={`${x2},${y2} ${p1x},${p1y} ${p2x},${p2y}`} fill={stroke} />
              )}
            </g>
          );
        }

        case 'math': {
          const rawLatex = opts.latex || opts.text || '';
          const { display, boxed } = formatLatexForMiniPreview(rawLatex);
          const fontSize = Math.max(28, Number(opts.fontSize || 32));
          const estW = Math.min(820, Math.max(120, display.length * fontSize * 0.56 + 32));
          const estH = fontSize * 1.65;
          return (
            <g key={key}>
              {boxed && (
                <rect
                  x={x - 12}
                  y={y - 8}
                  width={estW}
                  height={estH}
                  rx={8}
                  fill="rgba(78, 205, 196, 0.1)"
                  stroke="#4ECDC4"
                  strokeWidth={3.5}
                />
              )}
              <text
                x={x}
                y={y + fontSize}
                fill={opts.color || '#FFFFFF'}
                fontSize={fontSize}
                fontStyle="italic"
                fontWeight={600}
                fontFamily="'Cambria Math', 'Times New Roman', serif"
              >
                {display.slice(0, 64)}
              </text>
            </g>
          );
        }

        case 'text': {
          const txt = String(opts.text || '');
          const fSize = Math.max(24, Number(opts.fontSize || 26));
          const isHw = opts.writingStyle === 'handwriting';
          const lines = wrapMiniHandwritingLines(txt, fSize, x);
          return (
            <g key={key}>
              {lines.map((ln, lIdx) => (
                <text
                  key={`${key}-ln-${lIdx}`}
                  x={x}
                  y={y + fSize + lIdx * (fSize * 1.35)}
                  fill={opts.color || '#F1F5F9'}
                  fontSize={fSize}
                  fontFamily={isHw ? "'Caveat', cursive, sans-serif" : "'Inter', sans-serif"}
                  fontWeight={isHw ? 600 : 500}
                >
                  {ln}
                </text>
              ))}
            </g>
          );
        }

        case 'graph': {
          const gw = Number(shape.width || 480);
          const gh = Number(shape.height || 360);
          const midX = x + gw / 2;
          const midY = y + gh * 0.58;
          return (
            <g key={key}>
              <rect
                x={x}
                y={y}
                width={gw}
                height={gh}
                rx={14}
                fill="#181A30"
                stroke="#4ECDC4"
                strokeWidth={3.5}
              />
              {/* Axes */}
              <line x1={x + 28} y1={midY} x2={x + gw - 28} y2={midY} stroke="rgba(255,255,255,0.35)" strokeWidth={2.5} />
              <line x1={midX} y1={y + 44} x2={midX} y2={y + gh - 24} stroke="rgba(255,255,255,0.35)" strokeWidth={2.5} />
              {/* Shaded integral preview if present */}
              {opts.shadedRegion && (
                <path
                  d={`M ${midX - 60} ${midY} Q ${midX + 10} ${midY - 95}, ${midX + 95} ${midY - 55} L ${midX + 95} ${midY} Z`}
                  fill="rgba(78, 205, 196, 0.28)"
                />
              )}
              {/* Function curve */}
              <path
                d={`M ${x + 42} ${midY + 60} Q ${midX - 20} ${midY - 120}, ${x + gw - 42} ${midY - 40}`}
                fill="none"
                stroke="#4ECDC4"
                strokeWidth={5}
                strokeLinecap="round"
              />
              <text x={x + 22} y={y + 32} fill="#94A3B8" fontSize={20} fontWeight={600} fontFamily="'Inter', sans-serif">
                {String(opts.title || '2D Function Plot').slice(0, 28)}
              </text>
            </g>
          );
        }

        case 'graph3d': {
          const gw = Number(shape.width || 500);
          const gh = Number(shape.height || 420);
          const cx = x + gw / 2;
          const cy = y + gh * 0.56;
          return (
            <g key={key}>
              <rect
                x={x}
                y={y}
                width={gw}
                height={gh}
                rx={14}
                fill="#17152E"
                stroke="#A855F7"
                strokeWidth={3.5}
              />
              <ellipse cx={cx} cy={cy + 30} rx={gw * 0.32} ry={gh * 0.14} fill="rgba(168, 85, 247, 0.16)" stroke="#A855F7" strokeWidth={3} />
              <path
                d={`M ${cx - gw * 0.32} ${cy + 30} Q ${cx} ${cy - gh * 0.34}, ${cx + gw * 0.32} ${cy + 30}`}
                fill="rgba(78, 205, 196, 0.18)"
                stroke="#4ECDC4"
                strokeWidth={4}
              />
              <text x={x + 22} y={y + 34} fill="#D8B4FE" fontSize={20} fontWeight={600} fontFamily="'Inter', sans-serif">
                {String(opts.title || '3D Surface').slice(0, 28)}
              </text>
            </g>
          );
        }

        case 'venn': {
          const vw = Number(shape.width || 480);
          const vh = Number(shape.height || 380);
          const r = Math.min(vw, vh) * 0.26;
          const cy = y + vh * 0.56;
          return (
            <g key={key}>
              <rect x={x} y={y} width={vw} height={vh} rx={14} fill="#171930" stroke="rgba(255,255,255,0.22)" strokeWidth={3} />
              <circle cx={x + vw * 0.4} cy={cy} r={r} fill="rgba(78, 205, 196, 0.25)" stroke="#4ECDC4" strokeWidth={3.5} />
              <circle cx={x + vw * 0.6} cy={cy} r={r} fill="rgba(255, 171, 0, 0.22)" stroke="#FFAB00" strokeWidth={3.5} />
              <text x={x + 20} y={y + 32} fill="#E2E8F0" fontSize={20} fontWeight={600} fontFamily="'Inter', sans-serif">
                {String(opts.title || 'Venn Diagram').slice(0, 26)}
              </text>
            </g>
          );
        }

        case 'image':
        case 'video': {
          const mw = Number(shape.width || 520);
          const mh = Number(shape.height || 320);
          const mediaObj = ((opts as any).media || opts) as any;
          const previewHref = mediaObj.posterDataUrl || mediaObj.url || opts.posterDataUrl || opts.url || '';
          const clipId = `thumb-clip-${String(key).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
          const isVideo = shape.shapeType === 'video';
          const cx = x + mw / 2;
          const cy = y + mh / 2;
          return (
            <g key={key}>
              <defs>
                <clipPath id={clipId}>
                  <rect x={x} y={y} width={mw} height={mh} rx={14} />
                </clipPath>
              </defs>
              <rect
                x={x}
                y={y}
                width={mw}
                height={mh}
                rx={14}
                fill="#0b0d1b"
                stroke={isVideo ? '#A855F7' : '#4ECDC4'}
                strokeWidth={4}
              />
              {previewHref ? (
                <image
                  href={previewHref}
                  x={x}
                  y={y}
                  width={mw}
                  height={mh}
                  preserveAspectRatio="xMidYMid meet"
                  clipPath={`url(#${clipId})`}
                />
              ) : (
                <text
                  x={cx}
                  y={cy - 10}
                  fill="#94A3B8"
                  fontSize={28}
                  fontWeight={700}
                  textAnchor="middle"
                  fontFamily="'Inter', sans-serif"
                >
                  {isVideo ? '🎬 Video' : '🖼️ Image'}
                </text>
              )}
              {isVideo && (
                <g>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={Math.min(48, Math.min(mw, mh) * 0.16)}
                    fill="rgba(15, 17, 34, 0.82)"
                    stroke="#4ECDC4"
                    strokeWidth={4}
                  />
                  <polygon
                    points={`${cx - 12},${cy - 18} ${cx - 12},${cy + 18} ${cx + 18},${cy}`}
                    fill="#4ECDC4"
                  />
                </g>
              )}
              <rect
                x={x + 10}
                y={y + mh - 42}
                width={Math.min(mw - 20, 340)}
                height={32}
                rx={8}
                fill="rgba(12, 14, 28, 0.82)"
              />
              <text
                x={x + 22}
                y={y + mh - 20}
                fill="#E2E8F0"
                fontSize={19}
                fontWeight={600}
                fontFamily="'Inter', sans-serif"
              >
                {`${isVideo ? '🎬 ' : '🖼️ '}${String(opts.fileName || (isVideo ? 'Video' : 'Image')).slice(0, 26)}`}
              </text>
            </g>
          );
        }

        default:
          return null;
      }
    });
  }, [shapes]);

  const renderedHandwriting = useMemo(() => {
    return handwriting.map((hw, idx) => {
      const hx = Number(hw.position?.x ?? 80);
      const hy = Number(hw.position?.y ?? 140);
      const isTitle = hw.style === 'title' || (hy <= 130 && hx < 500);
      const fSize = Number(hw.fontSize || (isTitle ? 46 : 28));
      const lines = wrapMiniHandwritingLines(hw.text || '', fSize, hx);
      const firstLineLen = (lines[0] || '').length * fSize * 0.48;

      return (
        <g key={hw.id || `thumb-hw-${idx}`}>
          {lines.map((line, lIdx) => (
            <text
              key={`hw-${idx}-${lIdx}`}
              x={hx}
              y={hy + lIdx * (fSize * 1.4)}
              fill={hw.color || (isTitle ? '#FFFFFF' : '#E2E8F0')}
              fontSize={fSize}
              fontWeight={isTitle ? 700 : 600}
              fontFamily="'Caveat', cursive, 'Inter', sans-serif"
            >
              {line}
            </text>
          ))}
          {isTitle && lines.length > 0 && (
            <line
              x1={hx}
              y1={hy + 12}
              x2={Math.min(1840, hx + Math.max(140, firstLineLen))}
              y2={hy + 12}
              stroke="#4ECDC4"
              strokeWidth={5}
              strokeLinecap="round"
            />
          )}
        </g>
      );
    });
  }, [handwriting]);

  return (
    <div
      className="slide-thumbnail-frame"
      style={{
        width: '100%',
        aspectRatio: '16 / 9',
        borderRadius: 7,
        overflow: 'hidden',
        backgroundColor: '#131324',
        border: isActive ? '2px solid #4ECDC4' : '1.5px solid rgba(255, 255, 255, 0.14)',
        boxShadow: isActive
          ? '0 0 0 3px rgba(78, 205, 196, 0.2), 0 6px 18px rgba(0, 0, 0, 0.45)'
          : '0 3px 10px rgba(0, 0, 0, 0.35)',
        position: 'relative',
        transition: 'border-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease',
      }}
    >
      <svg
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        {/* Subtle dark board background + faint column divider cue */}
        <rect x={0} y={0} width={1920} height={1080} fill="#131324" />
        <line x1={0} y1={130} x2={1920} y2={130} stroke="rgba(255,255,255,0.035)" strokeWidth={2} />

        {isEmpty ? (
          <text
            x={960}
            y={555}
            fill="rgba(255, 255, 255, 0.18)"
            fontSize={54}
            fontWeight={600}
            textAnchor="middle"
            fontFamily="'Inter', sans-serif"
          >
            Blank Slide
          </text>
        ) : (
          <>
            {renderedShapes}
            {renderedHandwriting}
            {userPaths.map((p) => (
              <path
                key={p.id}
                d={p.d}
                fill="none"
                stroke={p.color || '#4ECDC4'}
                strokeWidth={Math.max(4, (p.strokeWidth || 3) * 1.4)}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {userTexts.map((ut) => (
              <text
                key={ut.id}
                x={ut.x}
                y={ut.y}
                fill={ut.color || '#FFFFFF'}
                fontSize={Math.max(24, ut.fontSize || 24)}
                fontFamily="'Inter', sans-serif"
              >
                {ut.text}
              </text>
            ))}
          </>
        )}
      </svg>
    </div>
  );
});
