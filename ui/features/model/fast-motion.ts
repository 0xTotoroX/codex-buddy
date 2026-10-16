/* [INPUT]: Separate Fast button, fill layer and divider SVG elements.
 * [OUTPUT]: Cancellable charge -> strike animation; actual Fast state remains owned by ModelView.
 * [POS]: Model presentation-only motion, with reduced-motion and teardown handling.
 * [PROTOCOL]: Keep model/AGENTS.md in sync. */
import { useEffect, useRef, useState } from 'react';
export function useFastMotion() {
  const button = useRef<HTMLButtonElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  const beam = useRef<HTMLDivElement>(null);
  const path = useRef<SVGGElement>(null);
  const animations = useRef<Animation[]>([]);
  const revision = useRef(0);
  const [phase, setPhase] = useState<'idle' | 'charging' | 'striking'>('idle');
  function stop() {
    revision.current++;
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    setPhase('idle');
  }
  async function start() {
    stop();
    if (
      !button.current ||
      !fill.current ||
      !beam.current ||
      !path.current ||
      button.current.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)')
        .matches
    )
      return;
    const id = revision.current;
    setPhase('charging');
    const charge = fill.current.animate(
      [{ clipPath: 'inset(100% 0 0)' }, { clipPath: 'inset(0% 0 0)' }],
      { duration: 360, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' },
    );
    animations.current = [charge];
    try {
      await charge.finished;
      if (revision.current !== id) return;
      setPhase('striking');
      const reveal = path.current.animate(
        [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0)' }],
        { duration: 145, easing: 'cubic-bezier(.18,.7,.28,1)', fill: 'forwards' },
      );
      const strike = beam.current.animate(
        [
          { opacity: 0, offset: 0 },
          { opacity: 1, offset: 0.1 },
          { opacity: 0.95, offset: 0.44 },
          { opacity: 0, offset: 1 },
        ],
        { duration: 340, easing: 'linear' },
      );
      animations.current = [charge, reveal, strike];
      await strike.finished;
      if (revision.current === id) stop();
    } catch {
      /* Cancellation is expected on failure, drag, catalog or unmount. */
    }
  }
  useEffect(
    () => () => {
      revision.current++;
      animations.current.forEach((animation) => animation.cancel());
    },
    [],
  );
  return { button, fill, beam, path, phase, start, stop };
}
