"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, ChevronDown } from "lucide-react";
import RippleGrid from "../effects/RippleGrid";
import { HeroScene } from "./HeroScene";

export function HeroSection() {
  return (
    <section className="relative min-h-[92vh] overflow-hidden border-b border-border-low">
      <div className="absolute inset-0">
        <RippleGrid
          color="#9B91FF"
          variant="lines"
          cellSize={56}
          lineWidth={0.8}
          glow={0.5}
          rippleStrength={0.7}
          rippleSpeed={0.8}
          rippleSize={1.1}
          autoRipple="center"
          rippleInterval={3.6}
          tilt={8}
          rotation={0}
          mouseInteraction
          clickRipple
          intro
          fade={0.6}
          opacity={0.32}
        />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />

      {/* Right track gets an explicit minmax basis: a percentage-sized child
          (the hero scene) inside a plain `1fr` auto track collapses to 0
          width in CSS Grid, since percentages don't contribute to track sizing. */}
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 pt-36 pb-24 md:grid-cols-[1fr_minmax(0,560px)] md:pt-44">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: "easeOut" }}>
          <span className="label-mono inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5">
            Private collaboration infrastructure
          </span>
          <h1 className="mt-6 text-balance text-5xl font-semibold leading-[1.05] tracking-tight text-text-primary md:text-6xl">
            Meet privately.
            <br />
            Decide confidently.
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-text-secondary">
            Omnii brings private video meetings, confidential voting, and verifiable decision records into one
            trusted space on Solana.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
            >
              Launch Omnii
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#how-it-works"
              className="rounded-full border border-border px-6 py-3 text-sm font-medium text-text-primary transition-colors hover:border-border-strong hover:bg-white/[0.03]"
            >
              Explore how it works
            </a>
          </div>
          <p className="label-mono mt-8">Powered by Solana and MagicBlock</p>
        </motion.div>

        {/* No justify-self-end: that shrinks the item to content width, which
            re-introduces the same 0-width collapse for the w-full child below.
            The explicit 560px track already sits on the right; just fill it. */}
        <div className="relative">
          <HeroScene />
        </div>
      </div>

      <motion.div
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
        animate={{ y: [0, 6, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        <ChevronDown className="h-5 w-5 text-text-muted" />
      </motion.div>
    </section>
  );
}
