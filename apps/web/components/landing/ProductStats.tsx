"use client";

import { motion } from "motion/react";

const ITEMS = [
  { title: "Private by design", body: "Sensitive decisions deserve confidential spaces." },
  { title: "One verifiable record", body: "Important outcomes deserve a record that can be independently checked." },
  { title: "Built on Solana", body: "Private collaboration and verifiable decisions, together, on fast settlement infrastructure." },
];

export function ProductStats() {
  return (
    <section className="mx-auto max-w-6xl border-t border-border-low px-6 py-24">
      <div className="grid gap-10 md:grid-cols-3 md:divide-x md:divide-border-low">
        {ITEMS.map((item, i) => (
          <motion.div
            key={item.title}
            className="px-0 md:px-8"
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, delay: i * 0.1 }}
          >
            <p className="text-2xl font-semibold leading-snug tracking-tight text-text-primary md:text-3xl">
              {item.title}
            </p>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-text-secondary">{item.body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
