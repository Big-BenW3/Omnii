/**
 * Compact Omnii mark: two circular "i" dots bridged by a thin orbital ring.
 * Works standalone (favicon, sidebar, mobile nav) or beside the wordmark.
 */
export function OmniiLogo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="10.5" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.4" />
      <circle cx="11.5" cy="20.5" r="2.6" fill="currentColor" />
      <circle cx="20.5" cy="20.5" r="2.6" fill="currentColor" />
      <circle cx="11.5" cy="11.5" r="1.4" fill="currentColor" opacity="0.55" />
      <circle cx="20.5" cy="11.5" r="1.4" fill="currentColor" opacity="0.55" />
    </svg>
  );
}
