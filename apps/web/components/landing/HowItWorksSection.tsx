"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ConfidentialVoteIllustration,
  CreateSpaceIllustration,
  MeetDiscussIllustration,
  PreserveDecisionIllustration,
  VerifyOutcomeIllustration,
  type IllustrationComponent,
} from "./StepIllustrations";

const STEPS: { title: string; body: string; Illustration: IllustrationComponent }[] = [
  {
    title: "Create a private space",
    body: "Start with a focused space for the people who need to make an important decision. Create a meeting, establish its purpose, and invite the right participants.",
    Illustration: CreateSpaceIllustration,
  },
  {
    title: "Meet and discuss",
    body: "Bring everyone together for a private video meeting where discussion, context, and collaboration happen in one place.",
    Illustration: MeetDiscussIllustration,
  },
  {
    title: "Cast a confidential vote",
    body: "When the group is ready, eligible participants cast their votes privately. No one, including the host, can see individual choices while voting is open.",
    Illustration: ConfidentialVoteIllustration,
  },
  {
    title: "Verify the outcome",
    body: "When voting closes, the result is established and can be independently checked without exposing confidential individual choices.",
    Illustration: VerifyOutcomeIllustration,
  },
  {
    title: "Preserve the decision",
    body: "Turn the outcome into a verifiable decision record, committed on-chain, that the group can revisit later.",
    Illustration: PreserveDecisionIllustration,
  },
];

/**
 * Dual-column pinned scroll: the left illustration stays sticky while the
 * right step cards scroll past it. Driven by IntersectionObserver, not a
 * scroll-hijacking library, so native scrolling stays intact.
 */
export function HowItWorksSection() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = refs.current.findIndex((el) => el === entry.target);
            if (idx !== -1) setActive(idx);
          }
        });
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );
    refs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const Active = STEPS[active].Illustration;

  return (
    <section id="how-it-works" className="relative mx-auto max-w-6xl px-6 py-28">
      <div className="grid gap-12 md:grid-cols-[42%_58%] md:gap-10">
        {/* Left: pinned on desktop, static intro on mobile */}
        <div className="md:sticky md:top-28 md:h-fit">
          <span className="label-mono">How it works</span>
          <h2 className="mt-4 text-4xl font-semibold tracking-tight text-text-primary md:text-5xl">
            One flow, from first invite to final record.
          </h2>
          <p className="mt-4 max-w-sm text-text-secondary">
            Every meeting moves through the same five stages — private by default, verifiable at the end.
          </p>

          <div className="mt-8 hidden aspect-square w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-surface md:block">
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                className="h-full w-full"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
              >
                <Active />
              </motion.div>
            </AnimatePresence>
          </div>
          <p className="label-mono mt-4 hidden md:block">
            Step {String(active + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
          </p>
        </div>

        {/* Right: step list */}
        <div className="flex flex-col gap-6 md:gap-10">
          {STEPS.map((step, i) => (
            <div
              key={step.title}
              ref={(el) => {
                refs.current[i] = el;
              }}
              className="md:min-h-[55vh] md:py-0"
            >
              <div
                className={`rounded-2xl border p-7 transition-colors duration-300 md:p-8 ${
                  active === i ? "border-border-strong bg-surface-raised" : "border-border-low bg-transparent"
                }`}
              >
                <span
                  className={`font-mono text-sm transition-colors ${active === i ? "text-accent" : "text-text-muted"}`}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3
                  className={`mt-3 text-xl font-semibold transition-colors ${
                    active === i ? "text-text-primary" : "text-text-secondary"
                  }`}
                >
                  {step.title}
                </h3>
                <p
                  className={`mt-2 max-w-md text-sm leading-relaxed transition-colors ${
                    active === i ? "text-text-secondary" : "text-text-muted"
                  }`}
                >
                  {step.body}
                </p>
                {/* Mobile: inline illustration per step, no pinning. */}
                <div className="mt-5 block aspect-[4/3] w-full overflow-hidden rounded-xl border border-border bg-surface md:hidden">
                  <step.Illustration />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
