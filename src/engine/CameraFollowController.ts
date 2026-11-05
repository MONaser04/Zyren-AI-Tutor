export interface WritingFocusTarget {
  x: number;
  y: number;
  width: number;
  height: number;
  kind?: string;
}

export interface ViewportTransform {
  zoom: number;
  pan: { x: number; y: number };
}

export interface ViewportInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface AutoFollowPanResult {
  needsPan: boolean;
  desiredPanX: number;
  desiredPanY: number;
}

export interface AutoFollowTransformResult {
  needsMotion: boolean;
  needsPan: boolean;
  needsZoom: boolean;
  desiredZoom: number;
  desiredPanX: number;
  desiredPanY: number;
}

export interface AutoFollowOptions {
  deadzoneRatio?: number;
  autoResize?: boolean;
  minZoom?: number;
  maxZoom?: number;
  targetFillRatio?: number;
}

/**
 * Computes whether the live writing target falls outside the comfortable inner
 * safe-zone (deadband) of the unobstructed viewport, and returns the smooth
 * target pan that brings the writing comfortably into view WITHOUT altering
 * the student's chosen zoom level.
 */
export function computeAutoFollowPan(
  target: WritingFocusTarget,
  currentTransform: ViewportTransform,
  containerWidth: number,
  containerHeight: number,
  insets: ViewportInsets = { left: 0, right: 0, top: 64, bottom: 72 },
  deadzoneRatio = 0.68
): AutoFollowPanResult {
  const zoom = currentTransform.zoom || 1;
  const { pan } = currentTransform;

  const usableLeft = Math.max(0, insets.left);
  const usableRight = Math.max(usableLeft + 160, containerWidth - Math.max(0, insets.right));
  const usableTop = Math.max(0, insets.top);
  const usableBottom = Math.max(usableTop + 120, containerHeight - Math.max(0, insets.bottom));

  const usableWidth = usableRight - usableLeft;
  const usableHeight = usableBottom - usableTop;
  const usableCenterX = usableLeft + usableWidth / 2;
  const usableCenterY = usableTop + usableHeight / 2;

  const safeHalfW = (usableWidth * deadzoneRatio) / 2;
  const safeHalfH = (usableHeight * deadzoneRatio) / 2;

  const safeLeft = usableCenterX - safeHalfW;
  const safeRight = usableCenterX + safeHalfW;
  const safeTop = usableCenterY - safeHalfH;
  const safeBottom = usableCenterY + safeHalfH;

  // Determine representative anchor point of the active writing stroke / shape in virtual board coords
  const isPenTip = target.kind === 'handwriting-pen' || target.kind === 'handwriting';
  const anchorVirtualX = isPenTip
    ? target.x
    : target.x + Math.min(Math.max(0, target.width || 0) * 0.35, 220);
  const anchorVirtualY = target.y + Math.min(Math.max(0, target.height || 0) * 0.5, 160);

  const screenX = pan.x + anchorVirtualX * zoom;
  const screenY = pan.y + anchorVirtualY * zoom;

  const outHoriz = screenX < safeLeft || screenX > safeRight;
  const outVert = screenY < safeTop || screenY > safeBottom;

  if (!outHoriz && !outVert) {
    return {
      needsPan: false,
      desiredPanX: pan.x,
      desiredPanY: pan.y,
    };
  }

  // Frame LTR writing slightly left-of-center (38% across usable width) so upcoming
  // words to the right write smoothly across the screen without triggering another pan.
  const desiredScreenAnchorX = isPenTip
    ? usableLeft + usableWidth * 0.38
    : usableCenterX;
  const desiredScreenAnchorY = usableCenterY;

  const rawDesiredPanX = outHoriz ? desiredScreenAnchorX - anchorVirtualX * zoom : pan.x;
  const rawDesiredPanY = outVert ? desiredScreenAnchorY - anchorVirtualY * zoom : pan.y;

  // Boundary clamping: ensure camera never drifts off the 1920x1080 whiteboard canvas
  const VIRTUAL_W = 1920;
  const VIRTUAL_H = 1080;
  const scaledW = VIRTUAL_W * zoom;
  const scaledH = VIRTUAL_H * zoom;

  let clampedPanX = rawDesiredPanX;
  let clampedPanY = rawDesiredPanY;

  if (scaledW <= usableWidth) {
    clampedPanX = usableLeft + (usableWidth - scaledW) / 2;
  } else {
    const minPanX = usableRight - scaledW;
    const maxPanX = usableLeft;
    clampedPanX = Math.max(minPanX, Math.min(maxPanX, rawDesiredPanX));
  }

  if (scaledH <= usableHeight) {
    clampedPanY = usableTop + (usableHeight - scaledH) / 2;
  } else {
    const minPanY = usableBottom - scaledH;
    const maxPanY = usableTop;
    clampedPanY = Math.max(minPanY, Math.min(maxPanY, rawDesiredPanY));
  }

  return {
    needsPan: true,
    desiredPanX: clampedPanX,
    desiredPanY: clampedPanY,
  };
}

/**
 * Intelligent Auto-Framing & Auto-Resize Transform Calculator:
 * Dynamically evaluates both pan position AND zoom scale to frame multi-node
 * diagrams, large comparison charts, and multi-line equations comfortably within
 * the screen without awkward cropping or jarring camera jumps.
 */
export function computeAutoFollowTransform(
  target: WritingFocusTarget,
  currentTransform: ViewportTransform,
  containerWidth: number,
  containerHeight: number,
  insets: ViewportInsets = { left: 0, right: 0, top: 64, bottom: 72 },
  opts: AutoFollowOptions = {}
): AutoFollowTransformResult {
  const deadzoneRatio = opts.deadzoneRatio ?? 0.68;
  const autoResize = opts.autoResize ?? true;
  const minZoom = opts.minZoom ?? 0.52;
  const targetFillRatio = opts.targetFillRatio ?? 0.78;

  const currentZoom = currentTransform.zoom || 1;
  const { pan } = currentTransform;

  const usableLeft = Math.max(0, insets.left);
  const usableRight = Math.max(usableLeft + 160, containerWidth - Math.max(0, insets.right));
  const usableTop = Math.max(0, insets.top);
  const usableBottom = Math.max(usableTop + 120, containerHeight - Math.max(0, insets.bottom));

  const usableWidth = usableRight - usableLeft;
  const usableHeight = usableBottom - usableTop;
  const usableCenterX = usableLeft + usableWidth / 2;
  const usableCenterY = usableTop + usableHeight / 2;

  // Virtual target bounding dimensions
  const hasSubstantialBox = (target.width || 0) > 60 && (target.height || 0) > 40;
  let desiredZoom = currentZoom;

  if (autoResize && hasSubstantialBox) {
    const boxW = (target.width || 0) + 100;
    const boxH = (target.height || 0) + 80;
    const safeZoneW = usableWidth * targetFillRatio;
    const safeZoneH = usableHeight * targetFillRatio;

    // What zoom fits the full box within the comfortable viewing safe zone?
    const fitZoom = Math.min(safeZoneW / boxW, safeZoneH / boxH);

    // If current zoom causes the content to exceed the safe viewport zone,
    // smoothly step down zoom to comfortably fit the complete diagram or structure
    if (currentZoom > fitZoom) {
      desiredZoom = Math.max(minZoom, Math.min(fitZoom, currentZoom));
    }
  }

  // Anchor point in virtual coordinates
  const isPenTip = target.kind === 'handwriting-pen' || target.kind === 'handwriting';
  const isLargeDiagram = target.kind === 'diagram' || (hasSubstantialBox && (target.width || 0) > 280);

  const anchorVirtualX = isLargeDiagram
    ? target.x + (target.width || 0) / 2
    : isPenTip
    ? target.x
    : target.x + Math.min(Math.max(0, target.width || 0) * 0.35, 220);

  const anchorVirtualY = isLargeDiagram
    ? target.y + (target.height || 0) / 2
    : target.y + Math.min(Math.max(0, target.height || 0) * 0.5, 160);

  // Compute screen coordinates under desiredZoom
  const safeHalfW = (usableWidth * deadzoneRatio) / 2;
  const safeHalfH = (usableHeight * deadzoneRatio) / 2;
  const safeLeft = usableCenterX - safeHalfW;
  const safeRight = usableCenterX + safeHalfW;
  const safeTop = usableCenterY - safeHalfH;
  const safeBottom = usableCenterY + safeHalfH;

  const screenX = pan.x + anchorVirtualX * desiredZoom;
  const screenY = pan.y + anchorVirtualY * desiredZoom;

  const zoomChanged = Math.abs(desiredZoom - currentZoom) > 0.008;
  const outHoriz = screenX < safeLeft || screenX > safeRight || zoomChanged;
  const outVert = screenY < safeTop || screenY > safeBottom || zoomChanged;

  if (!outHoriz && !outVert && !zoomChanged) {
    return {
      needsMotion: false,
      needsPan: false,
      needsZoom: false,
      desiredZoom: currentZoom,
      desiredPanX: pan.x,
      desiredPanY: pan.y,
    };
  }

  const desiredScreenAnchorX = isLargeDiagram
    ? usableCenterX
    : isPenTip
    ? usableLeft + usableWidth * 0.38
    : usableCenterX;
  const desiredScreenAnchorY = usableCenterY;

  const rawDesiredPanX = desiredScreenAnchorX - anchorVirtualX * desiredZoom;
  const rawDesiredPanY = desiredScreenAnchorY - anchorVirtualY * desiredZoom;

  // Boundary clamping in virtual 1920x1080 canvas
  const VIRTUAL_W = 1920;
  const VIRTUAL_H = 1080;
  const scaledW = VIRTUAL_W * desiredZoom;
  const scaledH = VIRTUAL_H * desiredZoom;

  let clampedPanX = rawDesiredPanX;
  let clampedPanY = rawDesiredPanY;

  if (scaledW <= usableWidth) {
    clampedPanX = usableLeft + (usableWidth - scaledW) / 2;
  } else {
    const minPanX = usableRight - scaledW;
    const maxPanX = usableLeft;
    clampedPanX = Math.max(minPanX, Math.min(maxPanX, rawDesiredPanX));
  }

  if (scaledH <= usableHeight) {
    clampedPanY = usableTop + (usableHeight - scaledH) / 2;
  } else {
    const minPanY = usableBottom - scaledH;
    const maxPanY = usableTop;
    clampedPanY = Math.max(minPanY, Math.min(maxPanY, rawDesiredPanY));
  }

  return {
    needsMotion: true,
    needsPan: Math.abs(clampedPanX - pan.x) > 1 || Math.abs(clampedPanY - pan.y) > 1,
    needsZoom: zoomChanged,
    desiredZoom,
    desiredPanX: clampedPanX,
    desiredPanY: clampedPanY,
  };
}

/**
 * Frame-rate independent exponential LERP step for smooth camera pan motion.
 */
export function stepAutoFollowLerp(
  currentPan: { x: number; y: number },
  targetPan: { x: number; y: number },
  dtSeconds: number,
  lerpFactor = 0.14
): { pan: { x: number; y: number }; settled: boolean } {
  const dx = targetPan.x - currentPan.x;
  const dy = targetPan.y - currentPan.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 0.6) {
    return {
      pan: { x: targetPan.x, y: targetPan.y },
      settled: true,
    };
  }

  const clampedDt = Math.max(0.004, Math.min(0.06, dtSeconds || 0.016));
  const alpha = 1 - Math.pow(1 - lerpFactor, clampedDt * 60);

  return {
    pan: {
      x: currentPan.x + dx * alpha,
      y: currentPan.y + dy * alpha,
    },
    settled: false,
  };
}

/**
 * Frame-rate independent exponential LERP step for simultaneous smooth pan & zoom motion.
 */
export function stepAutoFollowTransformLerp(
  currentTransform: ViewportTransform,
  targetTransform: ViewportTransform,
  dtSeconds: number,
  lerpFactor = 0.14
): { transform: ViewportTransform; settled: boolean } {
  const dZoom = targetTransform.zoom - currentTransform.zoom;
  const dx = targetTransform.pan.x - currentTransform.pan.x;
  const dy = targetTransform.pan.y - currentTransform.pan.y;
  const distPan = Math.hypot(dx, dy);
  const distZoom = Math.abs(dZoom);

  if (distPan < 0.6 && distZoom < 0.003) {
    return {
      transform: {
        zoom: targetTransform.zoom,
        pan: { x: targetTransform.pan.x, y: targetTransform.pan.y },
      },
      settled: true,
    };
  }

  const clampedDt = Math.max(0.004, Math.min(0.06, dtSeconds || 0.016));
  const alpha = 1 - Math.pow(1 - lerpFactor, clampedDt * 60);

  return {
    transform: {
      zoom: currentTransform.zoom + dZoom * alpha,
      pan: {
        x: currentTransform.pan.x + dx * alpha,
        y: currentTransform.pan.y + dy * alpha,
      },
    },
    settled: false,
  };
}
