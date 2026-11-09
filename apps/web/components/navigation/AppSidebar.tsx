"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, PlusCircle, ShieldCheck } from "lucide-react";
import { OmniiLogo } from "../branding/OmniiLogo";

/** Only routes that exist in this app — no placeholder nav items. */
const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/create", label: "New meeting", icon: PlusCircle },
  { href: "/privacy", label: "Privacy", icon: ShieldCheck },
];

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden h-screen w-60 flex-shrink-0 flex-col border-r border-border-low bg-background-alt md:flex">
      <Link href="/" className="flex items-center gap-2 px-6 py-6">
        <OmniiLogo size={22} className="text-accent" />
        <span className="text-sm font-semibold tracking-tight text-text-primary">omnii</span>
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5 px-3">
        {NAV.map((item) => {
          const active = pathname === item.href || (item.href !== "/dashboard" && pathname?.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                active ? "bg-white/[0.05] text-text-primary" : "text-text-secondary hover:bg-white/[0.03] hover:text-text-primary"
              }`}
            >
              {active && <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" />}
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border-low px-3 py-4">
        <span className="label-mono block px-3">Network</span>
        <span className="mt-1 block px-3 text-xs text-warning">Devnet</span>
      </div>
    </aside>
  );
}
