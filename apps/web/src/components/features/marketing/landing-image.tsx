import type { ReactElement } from "react";
import { Box } from "@mui/material";
import Image from "next/image";

interface LandingImageProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  /** The hero loads first; everything below the fold waits. */
  priority?: boolean;
  sizes: string;
  /** Background behind the picture and its corner radius, in theme units. */
  radius?: number;
}

/** A product picture exported from the design at 2x, scaled to its column. */
export function LandingImage(props: LandingImageProps): ReactElement {
  const { src, alt, width, height, priority = false, sizes, radius = 4 } = props;
  return (
    <Box
      sx={{
        borderRadius: radius,
        overflow: "hidden",
        "& img": { width: "100%", height: "auto", display: "block" },
      }}
    >
      <Image src={src} alt={alt} width={width} height={height} priority={priority} sizes={sizes} />
    </Box>
  );
}
