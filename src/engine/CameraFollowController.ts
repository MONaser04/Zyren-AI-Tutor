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
 * Frame-rate independent exponential LERP step for smooth camera motion.
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
