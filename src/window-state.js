"use strict";

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 860;
const MIN_WIDTH = 480;
const MIN_HEIGHT = 700;

function boundsAreUsable(bounds, workAreas) {
  if (!bounds) return false;
  const { x, y, width, height } = bounds;
  if (![x, y, width, height].every((value) => Number.isFinite(value))) return false;
  if (width < MIN_WIDTH || height < MIN_HEIGHT) return false;
  if (width > 8000 || height > 8000) return false;
  if (!Array.isArray(workAreas) || workAreas.length === 0) return false;

  return workAreas.some((area) => {
    if (!area || ![area.x, area.y, area.width, area.height].every((value) => Number.isFinite(value))) {
      return false;
    }
    const overlapWidth = Math.min(x + width, area.x + area.width) - Math.max(x, area.x);
    const overlapHeight = Math.min(y + height, area.y + area.height) - Math.max(y, area.y);
    return overlapWidth > 80 && overlapHeight > 80;
  });
}

module.exports = {
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  MIN_WIDTH,
  MIN_HEIGHT,
  boundsAreUsable,
};
