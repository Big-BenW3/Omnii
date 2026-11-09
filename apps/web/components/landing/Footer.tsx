import Link from "next/link";
import { OmniiWordmark } from "../branding/OmniiWordmark";

/**
 * Only links to destinations that actually exist in this app. No social
 * links are included: none have been established for this project yet.
 */
const PRODUCT = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Create a meeting", href: "/create" },
  { label: "Privacy & security", href: "/privacy" },
];
const RESOURCES = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Technology", href: "#technology" },
];

export function Footer() {
  return (
    <footer className="border-t border-border-low">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <OmniiWordmark size="md" />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-text-secondary">
              Omnii is the private space for meaningful conversations, confidential decisions, and verifiable
              outcomes.
            </p>
            <p className="label-mono mt-6">© Omnii {new Date().getFullYear()}</p>
          </div>

          <div>
            <p className="label-mono mb-4">Product</p>
            <ul className="flex flex-col gap-2.5 text-sm">
              {PRODUCT.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="text-text-secondary transition-colors hover:text-text-primary">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="label-mono mb-4">Resources</p>
            <ul className="flex flex-col gap-2.5 text-sm">
              {RESOURCES.map((l) => (
                <li key={l.label}>
                  <a href={l.href} className="text-text-secondary transition-colors hover:text-text-primary">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="relative overflow-hidden px-6 pb-2" aria-hidden="true">
        <div
          className="select-none whitespace-nowrap text-center font-semibold leading-none"
          style={{
            fontSize: "min(22vw, 220px)",
            color: "rgba(255,255,255,0.035)",
            letterSpacing: "-0.03em",
          }}
        >
          omnii
        </div>
      </div>
    </footer>
  );
}
