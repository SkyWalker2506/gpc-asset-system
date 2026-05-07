// §P1_4_ANCHOR_RUNTIME§ anchor-resolve.js
// Converts the 4-flag anchor schema ({tl, tr, bl, br}) used in gpc_asset_overrides
// into Unity-style anchorMin/anchorMax bounds, then computes effective sprite
// dimensions and position offset given a container (viewport) size.
//
// Flag mapping:
//   tl = Top-Left corner pinned
//   tr = Top-Right corner pinned
//   bl = Bottom-Left corner pinned
//   br = Bottom-Right corner pinned
//
// If a flag is true on both sides of an axis, the sprite stretches on that axis.
// If only one side is pinned, the sprite keeps its natural size and pins to that edge.
// Default (all 4 true) = full stretch (corner-pinned, fills container).
// All 4 false = natural size, centered (same as no anchor).

(function (root) {
  'use strict';

  /**
   * Convert 4-flag anchor to { anchorMin:{x,y}, anchorMax:{x,y} }.
   *
   * Axis convention (matching Unity canvas):
   *   x: 0 = left edge, 1 = right edge
   *   y: 0 = top edge,  1 = bottom edge
   *
   * @param {{ tl?: boolean, tr?: boolean, bl?: boolean, br?: boolean }} flags
   * @returns {{ anchorMin: {x:number,y:number}, anchorMax: {x:number,y:number} }}
   */
  function flagsToBounds(flags) {
    if (!flags) {
      // No anchor data → natural size, centered
      return { anchorMin: { x: 0.5, y: 0.5 }, anchorMax: { x: 0.5, y: 0.5 } };
    }
    const { tl, tr, bl, br } = flags;

    // X axis: left-pin = tl or bl; right-pin = tr or br
    const leftPinned  = !!(tl || bl);
    const rightPinned = !!(tr || br);
    const minX = leftPinned  ? 0 : (rightPinned ? 1 : 0.5);
    const maxX = rightPinned ? 1 : (leftPinned  ? 0 : 0.5);

    // Y axis: top-pin = tl or tr; bottom-pin = bl or br
    const topPinned    = !!(tl || tr);
    const bottomPinned = !!(bl || br);
    const minY = topPinned    ? 0 : (bottomPinned ? 1 : 0.5);
    const maxY = bottomPinned ? 1 : (topPinned    ? 0 : 0.5);

    return {
      anchorMin: { x: minX, y: minY },
      anchorMax: { x: maxX, y: maxY }
    };
  }

  /**
   * Returns true when the anchor flags represent the default "no-op" state
   * (all 4 corners pinned → preserve natural dimensions, no stretch).
   *
   * Note: when all 4 corners are set the sprite should fill the container.
   * For decoration sprites the "container" is the per-decoration w/h, so
   * the current behaviour is unchanged → this is the regression-safe default.
   */
  function isDefaultAnchor(flags) {
    if (!flags) return true;
    return !!(flags.tl && flags.tr && flags.bl && flags.br);
  }

  /**
   * Given anchor flags, a natural sprite size, and a container size,
   * compute the effective draw rect { x (offset from containerLeft), y (offset
   * from containerTop), w, h }.
   *
   * containerW / containerH: the parent bounds (e.g. canvas W/H for full-viewport
   *   pinning, or the decoration slot for local pinning).
   * naturalW / naturalH: sprite's intrinsic pixel size.
   *
   * Returns { dx, dy, dw, dh } where dx/dy are offsets from the anchor origin.
   */
  function resolveRect(flags, naturalW, naturalH, containerW, containerH) {
    const { anchorMin, anchorMax } = flagsToBounds(flags);

    const spanX = anchorMax.x - anchorMin.x;
    const spanY = anchorMax.y - anchorMin.y;

    // Effective dimensions
    const dw = spanX > 0 ? containerW * spanX : naturalW;
    const dh = spanY > 0 ? containerH * spanY : naturalH;

    // Offset from container top-left
    const anchorOriginX = anchorMin.x * containerW;
    const anchorOriginY = anchorMin.y * containerH;

    // When span = 0 we pin to the anchor point; centre sprite on it when
    // anchorMin === anchorMax === 0.5 (centered, no-pin), otherwise pin edge.
    let dx, dy;
    if (spanX > 0) {
      dx = anchorOriginX;
    } else {
      // No horizontal stretch: pin left edge when left-only, right edge when right-only
      const { tl, tr, bl, br } = flags || {};
      const leftOnly  = !!(tl || bl) && !(tr || br);
      const rightOnly = !!(tr || br) && !(tl || bl);
      if (leftOnly)       dx = anchorOriginX;
      else if (rightOnly) dx = anchorOriginX - dw;
      else                dx = anchorOriginX - dw / 2; // centered
    }

    if (spanY > 0) {
      dy = anchorOriginY;
    } else {
      const { tl, tr, bl, br } = flags || {};
      const topOnly    = !!(tl || tr) && !(bl || br);
      const bottomOnly = !!(bl || br) && !(tl || tr);
      if (topOnly)        dy = anchorOriginY;
      else if (bottomOnly)dy = anchorOriginY - dh;
      else                dy = anchorOriginY - dh / 2;
    }

    return { dx, dy, dw, dh };
  }

  // Export
  const ns = {
    flagsToBounds,
    isDefaultAnchor,
    resolveRect
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ns;
  } else {
    root.GpcAnchorResolve = ns;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
