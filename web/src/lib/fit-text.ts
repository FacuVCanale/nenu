// A one-line label cut to the width it is drawn in. CSS can only cut a line at its end, which hides a
// file's extension and the folder nearest to it, the two parts worth keeping.
import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * A file name cut in the middle to `max` characters, keeping its start, the last letters before its
 * extension and the extension, as Files does. An ellipsis right against the extension read as four
 * dots ("informe….md").
 */
export function shortName(name: string, max: number): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : "";
  const stem = name.slice(0, name.length - extension.length);
  const room = Math.max(1, max - extension.length - 1);
  const tail = Math.min(4, Math.floor(room / 3));
  return `${stem.slice(0, room - tail)}…${tail ? stem.slice(-tail) : ""}${extension}`;
}

let canvas: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: string): number {
  canvas ??= document.createElement("canvas").getContext("2d");
  if (!canvas) return 0;
  canvas.font = font;
  return canvas.measureText(text).width;
}

/**
 * `cut(n)` for the largest `n` whose text fits the width of `line` in the font `ref` is drawn with: a
 * character count guesses wrong both ways, "reporte-auditoria.html" fits a phone's bar at 22 and a
 * name of wide letters does not. Where nothing can be measured, `fallback` characters.
 */
export function useFitted(ref: RefObject<HTMLElement | null>, line: RefObject<HTMLElement | null>, full: string, cut: (max: number) => string, fallback: number): string {
  const [max, setMax] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current, box = line.current;
    if (!element || !box) return;
    const fit = () => {
      const width = box.clientWidth;
      if (!width) return setMax(fallback);
      const { fontStyle, fontWeight, fontSize, fontFamily } = getComputedStyle(element);
      const font = `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`;
      let n = full.length;
      while (n > 1 && textWidth(cut(n), font) > width) n--;
      setMax(n);
    };
    fit();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(box);
    return () => observer?.disconnect();
    // `cut` is rebuilt every render; `full` and `fallback` are what it depends on.
  }, [full, fallback]);
  return cut(max);
}
