/* [INPUT]: Original capsule expression and activePaneCue, supplied by the runtime.
 * [OUTPUT]: Compact shared face, source dot and interruptible action acknowledgement without replacing the runtime expression.
 * [POS]: Presentation adapter; no new context selection, task reads or click handlers.
 * [PROTOCOL]: Keep embedded/AGENTS.md in sync. */
import { eyeOffset } from './shell/effects.js';
import { EYE_MAX_X, EYE_MAX_Y } from '../../shared/constants.js';
import { statusStageHtml } from './shell/shell.js';
import { faceStyles } from './shell/face-styles.js';
export const launcherFaceStyles = `${faceStyles}
button.csw-launcher-face {position:relative;--buddy-space-4:16px;--buddy-radius-pill:999px;--csw-text:currentColor;}
.csw-launcher-face .csw-status-stage {position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.5,.7);pointer-events:none;}
.csw-launcher-face .csw-fab-happy-arc path {stroke-width:1.6;}
.csw-launcher-source {position:absolute;left:var(--source-x,18px);top:var(--source-y,18px);width:3.5px;height:3.5px;border-radius:50%;background:currentColor;opacity:.7;transform:translate(-50%,-50%);pointer-events:none;transition:opacity 120ms ease-out;}
.csw-launcher-source[hidden] {display:none;}
@media(prefers-reduced-motion:reduce){.csw-launcher-source{transition:none;}}
`;
export function launcherFaceHtml() {
  return `${statusStageHtml()}<span class="csw-launcher-source" aria-hidden="true" hidden></span>`;
}
export function createLauncherFace(button) {
  const dot = button.querySelector('.csw-launcher-source');
  const eyes = button.querySelector('.csw-fab-face');
  const events = new AbortController();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let angle = null,
    target = null,
    frame = 0,
    expression = 'idle',
    pointerFrame = 0,
    pointer;
  let feedback = null;
  function clearFeedback() {
    feedback?.cancel();
    feedback = null;
  }
  const setPoint = (value) => {
    const halfHeight = button.clientHeight / 2;
    button.style.setProperty('--source-x', `${18 + 16 * Math.cos(value)}px`);
    button.style.setProperty(
      '--source-y',
      `${halfHeight + Math.max(0, halfHeight - 2) * Math.sin(value)}px`,
    );
  };
  function resetEyes() {
    cancelAnimationFrame(pointerFrame);
    pointerFrame = 0;
    button.style.setProperty('--csw-eye-x', '0px');
    button.style.setProperty('--csw-eye-y', '0px');
  }
  document.addEventListener(
    'pointermove',
    (event) => {
      if (expression !== 'answering' || reduced.matches || document.hidden) return;
      pointer = { x: event.clientX, y: event.clientY };
      if (pointerFrame) return;
      pointerFrame = requestAnimationFrame(() => {
        pointerFrame = 0;
        if (!pointer || expression !== 'answering') return;
        const offset = eyeOffset(
          pointer,
          button.getBoundingClientRect(),
          EYE_MAX_X,
          EYE_MAX_Y,
          220,
        );
        button.style.setProperty('--csw-eye-x', `${offset.x}px`);
        button.style.setProperty('--csw-eye-y', `${offset.y}px`);
      });
    },
    { signal: events.signal, passive: true },
  );
  window.addEventListener('blur', resetEyes, { signal: events.signal });
  document.addEventListener('pointerleave', resetEyes, { signal: events.signal });
  document.addEventListener('visibilitychange', resetEyes, { signal: events.signal });
  reduced.addEventListener('change', resetEyes, { signal: events.signal });
  reduced.addEventListener('change', clearFeedback, { signal: events.signal });
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) clearFeedback();
    },
    { signal: events.signal },
  );
  return {
    acknowledge() {
      clearFeedback();
      if (!eyes || !button.isConnected || document.hidden) return;
      // 仅表示收到操作，不覆盖业务表情，也不等待或宣称窗口已打开。
      const animation = eyes.animate(
        reduced.matches
          ? [{ opacity: 0.65 }, { opacity: 0.65 }]
          : [
              { transform: 'translateY(0) scale(1, 1)', offset: 0, easing: 'ease-out' },
              { transform: 'translateY(1px) scale(1.05, .16)', offset: 0.28, easing: 'ease-out' },
              { transform: 'translateY(-1px) scale(.98, 1.08)', offset: 0.65, easing: 'ease-out' },
              { transform: 'translateY(0) scale(1, 1)', offset: 1 },
            ],
        { duration: reduced.matches ? 140 : 280 },
      );
      feedback = animation;
      void animation.finished.then(
        () => {
          if (feedback === animation) clearFeedback();
        },
        () => {},
      );
    },
    update(value = {}) {
      expression = value.expression === 'hidden' ? 'idle' : value.expression || 'idle';
      if (button.dataset.expression !== expression) button.dataset.expression = expression;
      if (expression !== 'answering') resetEyes();
      const cue = value.sourceCue;
      const valid =
        cue &&
        ['left', 'right', 'top', 'bottom'].includes(cue.direction) &&
        Number.isFinite(cue.angle);
      const label = valid
        ? { left: '左侧', right: '右侧', top: '上侧', bottom: '下侧' }[cue.direction] + '聊天'
        : '';
      button.setAttribute(
        'aria-description',
        [value.expressionLabel, label].filter(Boolean).join('；'),
      );
      button.dataset.sourceDirection = valid ? cue.direction : 'single';
      dot.hidden = !valid;
      if (!valid) {
        cancelAnimationFrame(frame);
        frame = 0;
        angle = target = null;
        return;
      }
      if (target === cue.angle) return;
      target = cue.angle;
      cancelAnimationFrame(frame);
      frame = 0;
      if (angle === null || reduced.matches) {
        angle = target;
        setPoint(angle);
        return;
      }
      const from = angle,
        delta = Math.atan2(Math.sin(target - from), Math.cos(target - from)),
        start = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - start) / 160);
        angle = from + delta * (1 - (1 - t) ** 3);
        setPoint(angle);
        frame = t < 1 ? requestAnimationFrame(tick) : 0;
      };
      frame = requestAnimationFrame(tick);
    },
    destroy() {
      events.abort();
      clearFeedback();
      cancelAnimationFrame(frame);
      resetEyes();
    },
  };
}
