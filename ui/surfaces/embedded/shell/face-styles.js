/* [INPUT]: Existing capsule face classes and expression attributes.
 * [OUTPUT]: One shared face stylesheet for the capsule, workbench and rail button.
 * [POS]: Pure visual resource; no state inference or host operations.
 * [PROTOCOL]: Keep shell/AGENTS.md and styles/AGENTS.md in sync. */
export const faceStyles = `
.csw-fab-face {
  align-items: center;
  display: flex;
  gap: var(--buddy-space-4);
  height: 27px;
  justify-content: center;
  position: relative;
  width: 52px;
  z-index: 1;
}

.csw-status-stage {
  align-items: center;
  display: flex;
  height: 28px;
  justify-content: center;
  position: relative;
  width: 58px;
  z-index: 1;
}

.csw-source-track {
  height: var(--csw-source-track-height, var(--csw-default-chip-height));
  left: 50%;
  pointer-events: none;
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: var(--csw-default-chip-width);
  z-index: 2;
}

.csw-fab-eye {
  background: currentColor;
  border-radius: var(--buddy-radius-pill);
  display: block;
  height: 14px;
  position: relative;
  transform: translate3d(var(--csw-eye-x, 0px), var(--csw-eye-y, 0px), 0);
  transform-origin: center;
  will-change: transform;
  width: 8px;
}

.csw-fab-happy-arc {
  display: none;
  height: 100%;
  overflow: visible;
  width: 100%;
}

.csw-fab-happy-arc path {
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2.6;
  vector-effect: non-scaling-stroke;
}

:is(.csw-fab, .csw-head-face)[data-expression='answering'] .csw-fab-eye {
  height: 13px;
}

:is(.csw-fab, .csw-head-face)[data-expression='surprise'] .csw-fab-eye {
  background: currentColor;
  border: 0;
  border-radius: 0;
  clip-path: polygon(50% 0, 61% 36%, 100% 50%, 61% 64%, 50% 100%, 39% 64%, 0 50%, 39% 36%);
  height: 18px;
  width: 18px;
}

:is(.csw-fab, .csw-head-face)[data-expression='generating'] .csw-fab-eye {
  height: 14px;
  width: 8px;
}

:is(.csw-fab, .csw-head-face)[data-expression='ready'] .csw-fab-eye {
  background: transparent;
  border: 0;
  border-radius: 0;
  height: 12px;
  width: 18px;
}

:is(.csw-fab, .csw-head-face)[data-expression='ready'] .csw-fab-happy-arc {
  display: block;
}

:is(.csw-fab, .csw-head-face)[data-expression='ready'] .csw-fab-eye::before,
:is(.csw-fab, .csw-head-face)[data-expression='ready'] .csw-fab-eye::after {
  content: none;
}

:is(.csw-fab, .csw-head-face)[data-expression='empty'] .csw-fab-eye {
  height: 3px;
  width: 16px;
}

:is(.csw-fab, .csw-head-face)[data-expression='error'] .csw-fab-eye {
  background: transparent;
  color: var(--csw-text);
  height: 14px;
  width: 14px;
}

:is(.csw-fab, .csw-head-face)[data-expression='error'] .csw-fab-eye::before,
:is(.csw-fab, .csw-head-face)[data-expression='error'] .csw-fab-eye::after {
  background: currentColor;
  border-radius: var(--buddy-radius-pill);
  content: '';
  height: 2.5px;
  left: 0;
  position: absolute;
  top: 5.75px;
  width: 14px;
}

:is(.csw-fab, .csw-head-face)[data-expression='error'] .csw-fab-eye::before {
  transform: rotate(45deg);
}

:is(.csw-fab, .csw-head-face)[data-expression='error'] .csw-fab-eye::after {
  transform: rotate(-45deg);
}

:is(.csw-fab, .csw-head-face)[data-expression='curious'] .csw-fab-eye {
  background: transparent;
  border: 3px solid currentColor;
  border-radius: 50%;
  clip-path: none;
  height: 17px;
  width: 17px;
}

:is(.csw-fab, .csw-head-face)[data-expression='curious'] .csw-fab-eye::before {
  content: none;
}

:is(.csw-fab, .csw-head-face)[data-expression='curious'] .csw-fab-eye::after {
  background: currentColor;
  border-radius: 50%;
  content: '';
  height: 5px;
  left: 50%;
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%)
    translate3d(var(--csw-curious-eye-x, 0px), var(--csw-curious-eye-y, 0px), 0);
  width: 5px;
}

.csw-fab-eye {
  transition:
    background 170ms ease,
    border-color 170ms ease,
    height 170ms ease,
    transform 170ms ease,
    width 170ms ease;
}

:is(.csw-fab, .csw-head-face)[data-expression='idle'] .csw-fab-eye {
  animation: csw-face-blink 4.8s infinite;
}

:is(.csw-fab, .csw-head-face)[data-expression='answering'] .csw-fab-eye {
  transition-duration: 70ms;
}

:is(.csw-fab, .csw-head-face)[data-expression='surprise'] .csw-fab-eye {
  animation: csw-face-star 1.25s ease-in-out infinite;
}

:is(.csw-fab, .csw-head-face)[data-expression='generating'] .csw-fab-eye {
  animation: csw-face-generate-bob 0.92s cubic-bezier(0.45, 0, 0.2, 1) infinite;
  animation-delay: 0s;
}

.csw-fab[data-expression='ready'] .csw-fab-eye {
  animation: csw-face-happy-lift 720ms cubic-bezier(0.2, 0.72, 0.2, 1) 1 both;
}

:is(.csw-fab, .csw-head-face)[data-expression='empty'] .csw-fab-eye {
  animation: csw-face-calm-breathe 3.6s ease-in-out infinite;
}

:is(.csw-fab, .csw-head-face)[data-expression='error'] .csw-fab-eye {
  animation: csw-face-error-breathe 3.8s ease-in-out infinite;
}

:is(.csw-fab, .csw-head-face)[data-expression='curious'] .csw-fab-eye {
  animation: none;
}

:is(.csw-fab, .csw-head-face)[data-expression='curious'] .csw-fab-eye::after {
  animation: none;
  transition: transform 90ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

@keyframes csw-face-blink {
  0%,
  45%,
  49%,
  100% {
    transform: scaleY(1);
  }
  47% {
    transform: scaleY(0.12);
  }
}

@keyframes csw-face-star {
  0%,
  100% {
    transform: scale(0.9) rotate(0deg);
  }
  50% {
    transform: scale(1.08) rotate(8deg);
  }
}

@keyframes csw-face-generate-bob {
  0%,
  100% {
    transform: translate3d(0, 2px, 0) scaleY(0.9);
  }
  50% {
    transform: translate3d(0, -4px, 0) scaleY(1.06);
  }
}

@keyframes csw-face-happy-lift {
  0%,
  100% {
    transform: translate3d(0, 1px, 0) scale(0.97);
  }
  50% {
    transform: translate3d(0, -1px, 0) scale(1.03);
  }
}

@keyframes csw-face-calm-breathe {
  0%,
  100% {
    opacity: 0.74;
    transform: scaleX(0.94);
  }
  50% {
    opacity: 1;
    transform: scaleX(1);
  }
}

@keyframes csw-face-error-breathe {
  0%,
  100% {
    opacity: 0.78;
    transform: scale(0.96);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}


@media (prefers-reduced-motion: reduce) {
  .csw-fab-eye, .csw-fab-eye::before, .csw-fab-eye::after { animation:none!important;transition:none!important; }
}
`;
