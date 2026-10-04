/** OpenApply mark for next/og raster targets. */
export function markDataUri(px: number, opts: { bleed?: boolean } = {}): string {
  const frame = opts.bleed
    ? '<rect width="100" height="100" fill="#191919"/>'
    : '<rect x="3" y="3" width="94" height="94" rx="24" fill="#191919"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 100 100">${frame}<path d="M57 28H30V72H72V48M50 50L74 26M58 26H74V42" fill="none" stroke="white" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
