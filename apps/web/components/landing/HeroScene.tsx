"use client";

import { motion } from "motion/react";

/**
 * CSS-3D glass/orbital composition: a luminous core inside three tilted,
 * filled glass rings (no Three.js dependency). A soft dark backdrop sits
 * behind it so the object reads as a distinct shape against the grid.
 */
export function HeroScene() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[560px]" style={{ perspective: "1600px" }} aria-hidden="true">
      {/* backdrop: separates the object from the grid behind it */}
      <div
        className="absolute inset-0 rounded-full"
        style={{ background: "radial-gradient(circle, rgba(7,8,11,0.65) 0%, rgba(7,8,11,0.25) 55%, transparent 75%)" }}
      />

      <motion.div
        className="absolute inset-0"
        style={{ transformStyle: "preserve-3d" }}
        initial={{ opacity: 0, rotateY: -14, scale: 0.9 }}
        animate={{ opacity: 1, rotateY: 0, scale: 1 }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      >
        {[
          { size: 78, tiltX: 58, tiltY: 6, dur: 26, hue: "rgba(193,185,255,0.16)", edge: "rgba(201,195,255,0.55)" },
          { size: 58, tiltX: -46, tiltY: -14, dur: 32, hue: "rgba(155,145,255,0.14)", edge: "rgba(201,195,255,0.4)" },
          { size: 40, tiltX: 30, tiltY: 40, dur: 38, hue: "rgba(124,168,255,0.12)", edge: "rgba(180,195,255,0.3)" },
        ].map((ring, i) => (
          <motion.div
            key={i}
            className="absolute left-1/2 top-1/2 rounded-full"
            style={{
              width: `${ring.size}%`,
              height: `${ring.size}%`,
              marginLeft: `-${ring.size / 2}%`,
              marginTop: `-${ring.size / 2}%`,
              border: `1.5px solid ${ring.edge}`,
              background: `radial-gradient(circle at 35% 30%, ${ring.hue}, transparent 70%)`,
              boxShadow: `inset 0 0 30px rgba(255,255,255,0.06), 0 30px 70px rgba(0,0,0,0.6)`,
              transform: `rotateX(${ring.tiltX}deg) rotateY(${ring.tiltY}deg)`,
            }}
            animate={{ rotate: 360 }}
            transition={{ duration: ring.dur, repeat: Infinity, ease: "linear" }}
          >
            <span
              className="absolute h-2.5 w-2.5 rounded-full"
              style={{
                top: "4%",
                left: "50%",
                transform: "translateX(-50%)",
                background: "#C1B9FF",
                boxShadow: "0 0 20px 6px rgba(193,185,255,0.8)",
              }}
            />
          </motion.div>
        ))}

        {/* luminous core, drawn last so it sits visually in front */}
        <div
          className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(193,185,255,0.6) 40%, transparent 72%)",
            boxShadow: "0 0 140px 50px rgba(155,145,255,0.3)",
          }}
        />
      </motion.div>

      {/* grain to avoid an overly flat/digital look */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.05] mix-blend-overlay">
        <filter id="omnii-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#omnii-grain)" />
      </svg>
    </div>
  );
}
