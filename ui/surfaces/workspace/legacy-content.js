/* [INPUT]: Legacy runtime state and shared feature content.
 * [OUTPUT]: Legacy view signatures backed by the same feature renderers.
 * [POS]: Compatibility only; remove after legacy panel leases/configuration are retired.
 * [PROTOCOL]: Keep workspace/AGENTS.md in sync. */
import {
  outlineHtml as markup,
  alignOutlineNestedText as align,
  attachOutlineEvents as bind,
} from '../../features/outline/view.js';
import { createNextView } from '../../features/next/view.js';
import {
  shellState,
  runtimeState,
  outlineState,
  stepwiseState,
  contextState,
} from '../../codex/runtime/state.js';
import { outlineJumpTo, outlineJumpToAnchor } from '../../codex/outline.js';
import { fillComposer } from '../../codex/next.js';
import { emitSignal } from '../../codex/runtime/signals.js';
import { syncContentFade } from '../embedded/shell/geometry.js';
const reading = {
  get selected() {
    return shellState.promptPreviewIndex;
  },
  set selected(v) {
    shellState.promptPreviewIndex = v;
  },
};
const next = createNextView({
  read: () => ({
    ...stepwiseState,
    ...contextState,
    settings: runtimeState.settings,
    display: shellState,
    promptToken: JSON.stringify(stepwiseState.prompts),
  }),
  reading,
  command: (kind, data) => {
    const item =
      kind === 'quick-fill'
        ? runtimeState.settings?.quickPrompts?.[data.index]
        : stepwiseState.prompts[data.index];
    if (item?.prompt)
      fillComposer(item.prompt, data.submit, {
        quick: kind === 'quick-fill',
      });
  },
  changed: syncContentFade,
});
export const nextHtml = () => next.html();
export const attachNextEvents = (root = shellState.panel) => next.bind(root);
export const clearPromptInteractionTimers = () => next.clear();
export const outlineHtml = () => markup(outlineState);
export const alignOutlineNestedText = () => align(shellState.panel);
export const attachOutlineEvents = (root = shellState.panel) =>
  bind(root, (kind, data) => {
    const ok = kind === 'outline-jump' ? outlineJumpTo(data.id) : outlineJumpToAnchor(data.anchor);
    if (!ok) {
      outlineState.outlineStatus = 'error';
      outlineState.outlineError = '找不到对应的小节，刷新后再试。';
      emitSignal('render', { preserveMorph: true });
    }
  });
