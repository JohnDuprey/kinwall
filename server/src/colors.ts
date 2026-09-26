// Contrast rules for the family's own color schemes, so a scheme saved through the REST API or the
// MCP server is held to the same bar as one saved in the app's editor. This is a line-for-line
// port of web/src/color.ts (contrastRatio, readableOn) and web/src/skins.ts (baseFromPalette,
// paletteChecks): keep them in step, or the editor and the server will disagree about pass/fail.

export type Palette = { bg: string; card: string; text: string; accent: string };

function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const lin = [r, g, b].map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function readableOn(color: string, bg: string, min = 4.5): string {
  const n = color.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  const toward = luminance(bg) > 0.18 ? 0 : 255;
  for (let pct = 0; pct <= 100; pct += 2) {
    const hex = '#' + rgb.map((v) => Math.round(v + ((toward - v) * pct) / 100).toString(16).padStart(2, '0')).join('');
    if (contrastRatio(hex, bg) >= min) return hex;
  }
  return toward ? '#ffffff' : '#000000';
}

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

function dimText(p: Palette): string {
  let textDim = mix(p.text, p.bg, 0.4);
  for (const surface of [p.bg, p.card, p.bg]) textDim = readableOn(textDim, surface);
  return textDim;
}

/** The four pairs a saved scheme must pass (4.5:1) in one mode. */
export function paletteChecks(p: Palette): { label: string; ratio: number }[] {
  const textDim = dimText(p);
  return [
    { label: 'Text on background', ratio: contrastRatio(p.text, p.bg) },
    { label: 'Text on cards', ratio: contrastRatio(p.text, p.card) },
    { label: 'Dim text on background', ratio: contrastRatio(textDim, p.bg) },
    { label: 'Dim text on cards', ratio: contrastRatio(textDim, p.card) },
  ];
}

/** Human-readable failures for a scheme in both modes; empty when it passes. */
export function schemeContrastFailures(s: { name: string; light: Palette; dark: Palette }): string[] {
  return (['light', 'dark'] as const).flatMap((mode) =>
    paletteChecks(s[mode])
      .filter((c) => c.ratio < 4.5)
      .map((c) => `${s.name} (${mode} mode): ${c.label} is ${c.ratio.toFixed(1)}:1; it needs at least 4.5:1`),
  );
}
