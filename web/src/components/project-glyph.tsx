import { GLYPHS, projectMark, type MarkPick } from "@/lib/project-glyph";
import { cn } from "@/lib/utils";

/**
 * A project's own mark, drawn from its slug (lib/project-glyph.ts): 16px beside a name in the sidebar
 * and Search, 20px at the head of the project. Decorative, since its name always sits beside it.
 */
export function ProjectGlyph({ slug, pick, size = 16, className }: { slug: string; pick?: MarkPick; size?: number; className?: string }) {
  const { glyph, hue } = projectMark(slug, pick);
  const { stroke, fill, dash } = GLYPHS[glyph];
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" data-glyph={glyph} className={cn("shrink-0", className)}
      style={{ color: `var(--glyph-${hue})` }} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      {stroke && <path d={stroke} />}
      {dash && <path d={dash} strokeDasharray="2.1 2.1" />}
      {fill && <path d={fill} fill="currentColor" stroke="none" />}
    </svg>
  );
}
