"use client";

import Link from "next/link";
import { motion } from "motion/react";

export function FinalCTA() {
  return (
    <section className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl border border-border-low bg-surface px-6 py-20 text-center">
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: "radial-gradient(circle, rgba(155,145,255,0.25), transparent 70%)" }}
        aria-hidden="true"
      />
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.6 }}
        className="relative"
      >
        <h2 className="text-balance text-4xl font-semibold tracking-tight text-text-primary md:text-5xl">
          Important decisions deserve a better way.
        </h2>
        <p className="mx-auto mt-4 max-w-md text-text-secondary">
          Bring your people together, protect what matters, and create decisions that stand the test of time.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-full bg-accent px-6 py-3 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
          >
            Start with Omnii
          </Link>
          <a
            href="#technology"
            className="rounded-full border border-border px-6 py-3 text-sm font-medium text-text-primary transition-colors hover:border-border-strong"
          >
            Explore the technology
          </a>
        </div>
      </motion.div>
    </section>
  );
}
