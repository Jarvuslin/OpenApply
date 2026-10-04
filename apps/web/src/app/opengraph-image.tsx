import { ImageResponse } from "next/og";
import { markDataUri } from "@/components/brand/mark-svg";
import { accent, feedback, surfaces, textColors } from "@/theme/palette";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "OpenApply - your job search on autopilot";

// Satori renders this - inline styles only, no MUI/emotion, every multi-child div is flex.
export default function OpenGraphImage(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: surfaces.base,
        padding: 80,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: 10,
          background: `linear-gradient(90deg, ${accent.primary}, ${feedback.warning}, ${accent.secondary})`,
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {/* biome-ignore lint/performance/noImgElement: this is a next/og data-URI SVG, not a Next <Image>. */}
        <img width={64} height={64} src={markDataUri(64)} alt="" />
        <div style={{ color: textColors.primary, fontSize: 40, fontWeight: 700 }}>OpenApply</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          style={{
            color: textColors.primary,
            fontSize: 74,
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: -2,
          }}
        >
          Your job search on autopilot, running on your machine.
        </div>
        <div style={{ color: textColors.secondary, fontSize: 30, lineHeight: 1.4, maxWidth: 940 }}>
          Write your goals once; the Pilot finds roles, tailors your resume, applies, and chases
          replies overnight - on your own Claude or Codex subscription.
        </div>
      </div>
      <div style={{ display: "flex", color: textColors.disabled, fontSize: 24 }}>
        localhost:4100
      </div>
    </div>,
    { ...size },
  );
}
