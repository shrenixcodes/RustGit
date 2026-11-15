/** WCAG 2.1 relative luminance of a `#rrggbb` color. */
export function relativeLuminance(hex: string): number {
  const match: RegExpExecArray | null = /^#([0-9a-f]{6})$/i.exec(hex);
  if (match === null) {
    throw new Error(`expected #rrggbb, got ${hex}`);
  }
  const value: number = Number.parseInt(match[1] as string, 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel: number) => {
    const s: number = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio between two `#rrggbb` colors (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x: number, y: number) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}
