// Bump when rendering changes so saved documents do not reuse PDFs from the old renderer.
const RESUME_RENDERER_VERSION = 2;

export function resumePdfCacheKey(kind: "master" | "variant", id: string, updatedAtMs: number) {
  return `${kind}-${id}-${updatedAtMs}-v${RESUME_RENDERER_VERSION}.pdf`;
}
