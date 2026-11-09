"use client";

import type { ReactElement } from "react";
import { motion } from "motion/react";

/** Five small, self-contained animated scenes — one per How It Works step. */
export type IllustrationComponent = () => ReactElement;

export function CreateSpaceIllustration() {
  const nodes = [
    { x: 30, y: 24 }, { x: 78, y: 32 }, { x: 70, y: 76 }, { x: 24, y: 72 }, { x: 50, y: 14 },
  ];
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full">
      <motion.circle
        cx="50" cy="50" r="2" fill="var(--accent)"
        animate={{ r: [2, 4, 2] }} transition={{ duration: 2, repeat: Infinity }}
      />
      <motion.circle
        cx="50" cy="50" r="38" fill="none" stroke="currentColor" strokeOpacity="0.14" strokeDasharray="2 4"
        initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.8 }}
      />
      {nodes.map((n, i) => (
        <g key={i}>
          <motion.line
            x1="50" y1="50" x2={n.x} y2={n.y} stroke="var(--accent)" strokeOpacity="0.25"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, delay: 0.15 * i }}
          />
          <motion.circle
            cx={n.x} cy={n.y} r="3.2" fill="var(--surface-raised)" stroke="var(--accent)" strokeWidth="1"
            initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, delay: 0.2 + 0.15 * i }}
          />
        </g>
      ))}
    </svg>
  );
}

export function MeetDiscussIllustration() {
  const tiles = [0, 1, 2, 3];
  return (
    <div className="grid h-full w-full grid-cols-2 gap-3 p-6">
      {tiles.map((i) => (
        <motion.div
          key={i}
          className="relative rounded-lg border border-border bg-surface-raised"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: i * 0.12 }}
        >
          {i === 0 && (
            <div className="absolute bottom-2 left-2 flex items-end gap-0.5">
              {[4, 8, 5, 10, 6].map((h, j) => (
                <motion.span
                  key={j}
                  className="w-0.5 rounded-full bg-accent"
                  style={{ height: h }}
                  animate={{ scaleY: [0.5, 1, 0.6, 1] }}
                  transition={{ duration: 1.1, repeat: Infinity, delay: j * 0.08 }}
                />
              ))}
            </div>
          )}
        </motion.div>
      ))}
    </div>
  );
}

export function ConfidentialVoteIllustration() {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full">
      <motion.rect
        x="30" y="18" width="40" height="28" rx="2" fill="none" stroke="currentColor" strokeOpacity="0.3"
        initial={{ y: 18, opacity: 1 }} animate={{ y: [18, 48, 48], opacity: [1, 1, 0] }}
        transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 1.2 }}
      />
      <rect x="22" y="46" width="56" height="40" rx="6" fill="var(--surface-raised)" stroke="var(--accent)" strokeOpacity="0.5" />
      <motion.g animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }}>
        <rect x="42" y="58" width="16" height="12" rx="2" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
        <path d="M45 58 V54 a5 5 0 0 1 10 0 v4" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      </motion.g>
    </svg>
  );
}

export function VerifyOutcomeIllustration() {
  const hashes = ["4f1a", "9c02", "e71b", "33af"];
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 font-mono text-xs">
      {hashes.map((h, i) => (
        <motion.div
          key={h}
          className="flex items-center gap-2 text-text-secondary"
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: i * 0.2 }}
        >
          <span className="h-1 w-1 rounded-full bg-accent" />
          0x{h}…{i === hashes.length - 1 ? (
            <motion.span
              className="text-success"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.9 }}
            >
              verified
            </motion.span>
          ) : (
            "linked"
          )}
        </motion.div>
      ))}
    </div>
  );
}

export function PreserveDecisionIllustration() {
  return (
    <motion.div
      className="flex h-full w-full flex-col justify-center gap-2 rounded-lg border border-border bg-surface-raised p-5 font-mono text-xs"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
    >
      {[
        ["record", "DR-2f91"],
        ["status", "committed"],
        ["timestamp", "on-chain"],
      ].map(([k, v], i) => (
        <motion.div
          key={k}
          className="flex justify-between text-text-secondary"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 + i * 0.2 }}
        >
          <span>{k}</span>
          <span className="text-text-primary">{v}</span>
        </motion.div>
      ))}
      <motion.div
        className="mt-1 h-px w-full bg-border"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: 0.9, duration: 0.5 }}
      />
    </motion.div>
  );
}
