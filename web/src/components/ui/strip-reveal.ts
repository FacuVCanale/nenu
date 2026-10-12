/**
 * Where a strip should scroll so the chip spanning [start, end) shows whole, clear of the fade on an
 * edge the strip can still scroll toward; null when it already does. A chip wider than the strip
 * lines up by its start, where its name begins. Positions are in the strip's scroll coordinates.
 */
export function revealScrollLeft({
  scrollLeft,
  width,
  max,
  fade,
  start,
  end,
}: {
  scrollLeft: number;
  width: number;
  /** scrollWidth - clientWidth: the furthest the strip scrolls. */
  max: number;
  /** The edge fade's width (strips.css). */
  fade: number;
  start: number;
  end: number;
}): number | null {
  const clearStart = scrollLeft + (scrollLeft > 0 ? fade : 0);
  const clearEnd = scrollLeft + width - (scrollLeft < max ? fade : 0);
  if (start >= clearStart && end <= clearEnd) return null;
  const target = start < clearStart || end - start > width - 2 * fade ? start - fade : end - width + fade;
  const clamped = Math.min(max, Math.max(0, target));
  return clamped === scrollLeft ? null : clamped;
}
