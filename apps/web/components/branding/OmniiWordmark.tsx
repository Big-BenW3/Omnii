import { OmniiLogo } from "./OmniiLogo";

/**
 * Full wordmark: mark + lowercase "omnii" with the double-i rendered as two
 * dotless strokes so the mark's orbit reads as the dot of each i.
 */
export function OmniiWordmark({
  size = "md",
  withMark = true,
  className = "",
}: {
  size?: "sm" | "md" | "lg" | "xl";
  withMark?: boolean;
  className?: string;
}) {
  const textSize = { sm: "text-base", md: "text-lg", lg: "text-2xl", xl: "text-6xl md:text-8xl" }[size];
  const markSize = { sm: 18, md: 22, lg: 30, xl: 56 }[size];
  return (
    <span className={`inline-flex items-center gap-2 text-text-primary ${className}`}>
      {withMark && <OmniiLogo size={markSize} />}
      <span className={`font-semibold tracking-tight ${textSize}`} style={{ letterSpacing: "-0.02em" }}>
        omn<span className="text-accent">ii</span>
      </span>
    </span>
  );
}
