type RGBA = { r: number; g: number; b: number; a: number };

function parseColor(c: string): RGBA {
  if (c.startsWith("#")) {
    const n = parseInt(c.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`Unrecognized color: ${c}`);
  const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

function relativeLuminance({ r, g, b }: RGBA): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** Composites a possibly-translucent `fg` color over an opaque `bg` color. */
export function compositeOver(fg: string, bg: string): string {
  const f = parseColor(fg);
  const b = parseColor(bg);
  const r = Math.round(f.r * f.a + b.r * (1 - f.a));
  const g = Math.round(f.g * f.a + b.g * (1 - f.a));
  const bl = Math.round(f.b * f.a + b.b * (1 - f.a));
  return `rgb(${r}, ${g}, ${bl})`;
}

/** WCAG 2.x contrast ratio between two opaque colors (hex or rgb()/rgba()). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(parseColor(a));
  const lb = relativeLuminance(parseColor(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
