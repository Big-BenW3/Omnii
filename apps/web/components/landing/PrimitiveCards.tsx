"use client";

import { motion } from "motion/react";

function EngineScene() {
  return (
    <svg viewBox="0 0 200 110" className="h-full w-full">
      <line x1="10" y1="55" x2="190" y2="55" stroke="currentColor" strokeOpacity="0.12" />
      {[0, 1, 2].map((i) => (
        <motion.circle
          key={i}
          cy="55" r="3" fill="#7CA8FF"
          initial={{ cx: 10 }}
          animate={{ cx: [10, 190] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "linear", delay: i * 0.6 }}
        />
      ))}
      <rect x="150" y="30" width="40" height="50" rx="6" fill="none" stroke="#7CA8FF" strokeOpacity="0.5" />
      <text x="170" y="100" textAnchor="middle" className="fill-text-muted" fontSize="7" fontFamily="var(--font-mono)">
        settled
      </text>
    </svg>
  );
}

function PrivateScene() {
  return (
    <svg viewBox="0 0 200 110" className="h-full w-full">
      <motion.rect
        x="60" y="20" width="80" height="70" rx="10" fill="none" stroke="#B9A6FF" strokeOpacity="0.5"
        initial={{ opacity: 0.4 }} animate={{ opacity: [0.4, 0.8, 0.4] }} transition={{ duration: 2.4, repeat: Infinity }}
      />
      <path d="M90 50 v-8 a10 10 0 0 1 20 0 v8" fill="none" stroke="#B9A6FF" strokeWidth="2" />
      <rect x="85" y="50" width="30" height="22" rx="3" fill="#B9A6FF" opacity="0.18" stroke="#B9A6FF" />
      <motion.circle
        cx="100" cy="61" r="2.4" fill="#B9A6FF"
        animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.6, repeat: Infinity }}
      />
    </svg>
  );
}

function VrfScene() {
  return (
    <svg viewBox="0 0 200 110" className="h-full w-full">
      <motion.g style={{ transformOrigin: "100px 55px" }} animate={{ rotate: 360 }} transition={{ duration: 6, repeat: Infinity, ease: "linear" }}>
        <circle cx="100" cy="55" r="30" fill="none" stroke="#8C7CFF" strokeOpacity="0.4" strokeDasharray="4 6" />
        {[0, 72, 144, 216, 288].map((deg) => (
          <circle
            key={deg}
            cx={100 + 30 * Math.cos((deg * Math.PI) / 180)}
            cy={55 + 30 * Math.sin((deg * Math.PI) / 180)}
            r="2.5"
            fill="#8C7CFF"
          />
        ))}
      </motion.g>
      <circle cx="100" cy="55" r="4" fill="#C1B9FF" />
    </svg>
  );
}

const CARDS = [
  {
    kind: "REAL-TIME EXECUTION",
    name: "MagicBlock Engine",
    body: "Fast, on-demand execution through Ephemeral Rollups, enabling responsive application state that settles back to Solana.",
    tint: "from-[#1a2740] to-[#0c0d12]",
    Scene: EngineScene,
  },
  {
    kind: "CONFIDENTIAL EXECUTION",
    name: "MagicBlock Private",
    body: "Permission-controlled, confidential execution that helps protect sensitive application state, such as an individual ballot.",
    tint: "from-[#241a3d] to-[#0c0d12]",
    Scene: PrivateScene,
  },
  {
    kind: "VERIFIABLE RANDOMNESS",
    name: "MagicBlock VRF",
    body: "Cryptographically verifiable randomness for fair, unbiased selection where a meeting flow calls for it.",
    tint: "from-[#1c1a3d] to-[#0c0d12]",
    Scene: VrfScene,
  },
];

export function PrimitiveCards() {
  return (
    <section id="technology" className="mx-auto max-w-6xl px-6 py-28">
      <div className="max-w-2xl">
        <span className="label-mono">Technology</span>
        <h2 className="mt-4 text-4xl font-semibold tracking-tight text-text-primary md:text-5xl">
          Built with the primitives of real-time Solana infrastructure.
        </h2>
        <p className="mt-4 text-text-secondary">
          Omnii brings private collaboration and verifiable decision-making together using infrastructure built for
          real-time applications on Solana. The video layer, confidential execution, and base-layer settlement each
          do a distinct job.
        </p>
      </div>

      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {CARDS.map((card, i) => (
          <motion.div
            key={card.name}
            className={`group relative overflow-hidden rounded-2xl border border-border bg-gradient-to-b ${card.tint} p-6 transition-colors hover:border-border-strong`}
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5, delay: i * 0.1 }}
            whileHover={{ y: -3 }}
          >
            <div className="aspect-[16/10] w-full overflow-hidden rounded-lg border border-white/5 bg-black/20">
              <card.Scene />
            </div>
            <p className="label-mono mt-5">{card.kind}</p>
            <h3 className="mt-2 text-lg font-semibold text-text-primary">{card.name}</h3>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">{card.body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
