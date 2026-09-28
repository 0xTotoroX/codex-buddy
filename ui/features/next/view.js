/* [INPUT]: Suggestion projection, display preferences and guarded action callback.
 * [OUTPUT]: Original list/preview, quick prompts, hover/focus and single/double-click actions.
 * [POS]: Content interaction only; generation and input validation stay in Codex/backend services.
 * [PROTOCOL]: Keep features/next/AGENTS.md in sync. */
import { escapeAttr, escapeHtml, normalizeText, clamp } from '../../shared/text.js';
import {
  FRIENDLY_BRIDGE_ERRORS,
  PROMPT_CLICK_DELAY_MS,
  PROMPT_PREVIEW_SWITCH_MS,
} from '../../shared/constants.js';
import { iconSvg } from '../../shared/icons/index.js';
export function createNextView({ read, reading, command, changed = () => {} }) {
  let container,
    previewTimer = 0,
    clickTimer = 0;
  function bridgeErrorPresentation(error = read().bridgeError) {
    const text = normalizeText(error);
    const match = FRIENDLY_BRIDGE_ERRORS.find((item) => item.pattern.test(text));
    return (
      match || {
        title: '生成失败，稍后重试',
        message: '',
      }
    );
  }

  function nextProgressState() {
    if (read().bridgeStatus === 'pending') {
      return {
        title: '正在生成建议',
      };
    }
    if ((read().settings?.generationMode || 'manual') === 'manual') return null;
    if (read().scanStatus === 'assistant-changed' || read().scanStatus === 'assistant-settling') {
      return {
        title: '正在整理回答',
      };
    }
    if (read().scanStatus === 'not-ready' && read().scanBusy) {
      return {
        title: '等待回答完成',
      };
    }
    return null;
  }

  function nextHtml() {
    const buttons = (read().settings?.quickPrompts || [])
      .map(
        (item, index) =>
          `<button type="button" class="csw-quick-prompt" data-quick-prompt="${index}" title="${escapeAttr('填入：' + item.prompt)}">${escapeHtml(item.label)}</button>`,
      )
      .join('');
    return `<div class="csw-next-content">${buttons ? `<div class="csw-quick-prompts" aria-label="常用提示词">${buttons}</div>` : ''}${nextSuggestionsHtml()}</div>`;
  }

  function nextSuggestionsHtml() {
    const progress = nextProgressState();
    if (progress) {
      return `<div class="csw-progress" aria-label="${progress.title}">
        <span class="csw-progress-ring" aria-hidden="true"></span>
        <span class="csw-progress-copy">
          <span class="csw-progress-title">${progress.title}</span>
        </span>
      </div>`;
    }
    if (!read().prompts.length) {
      const empty = nextEmptyState();
      return `<div class="csw-empty" data-state="${escapeAttr(('state' in empty ? empty.state : '') || 'idle')}">
        <div class="csw-empty-title">${escapeHtml(empty.title)}</div>
      </div>`;
    }
    const previewIndex = clamp(Number(reading.selected) || 0, 0, read().prompts.length - 1);
    const previewItem = read().prompts[previewIndex];
    reading.selected = previewIndex;
    return `<div class="csw-next-layout">
      <div class="csw-list" data-label-only="${read().display?.labelOnly ?? true}" aria-label="下一步建议">${read()
        .prompts.map(
          (item, index) => `
        <button class="csw-row" type="button" data-index="${index}" data-preview-active="${index === previewIndex}" aria-current="${index === previewIndex ? 'true' : 'false'}">
          <span class="csw-row-copy">
            <span class="csw-row-label">${escapeHtml(item.label || item.prompt)}</span>
            ${(read().display?.labelOnly ?? true) ? '' : `<span class="csw-row-prompt">${escapeHtml(item.summary || item.prompt)}</span>`}
          </span>
          <span class="csw-row-arrow" aria-hidden="true">${iconSvg('chevron-right')}</span>
        </button>
      `,
        )
        .join('')}</div>
      <section class="csw-prompt-preview" data-preview-index="${previewIndex}" aria-label="建议完整内容">
        <div class="csw-prompt-preview-scroll" tabindex="0">
          <div class="csw-prompt-preview-content">
            <span class="csw-prompt-preview-kicker">${previewIndex + 1} / ${read().prompts.length}</span>
            <span class="csw-prompt-preview-title">${escapeHtml(previewItem.label || previewItem.prompt)}</span>
            <span class="csw-prompt-preview-body">${escapeHtml(previewItem.prompt)}</span>
          </div>
        </div>
      </section>
    </div>`;
  }

  function nextEmptyState() {
    if (read().bridgeError || read().bridgeStatus === 'failed') return bridgeErrorPresentation();
    if (read().bridgeStatus === 'ok') {
      return {
        title: '暂无建议',
        message: '',
      };
    }
    if (read().bridgeStatus === 'disabled') {
      return {
        title: '功能已关闭',
        message: '',
      };
    }
    if ((read().settings?.generationMode || 'manual') === 'manual') {
      return {
        title: '当前为手动模式',
        message: '',
        state: 'manual',
      };
    }
    return {
      title: '等待回答完成',
      message: '',
    };
  }

  function attachNextEvents(root) {
    container = root;
    root.querySelectorAll('[data-quick-prompt]').forEach((button) => {
      button.addEventListener('click', () => {
        const item = read().settings?.quickPrompts?.[Number(button.dataset.quickPrompt)];
        if (item?.prompt) command('quick-fill', { index: Number(button.dataset.quickPrompt) });
      });
    });
    root.querySelectorAll('.csw-row').forEach((button) => {
      button.addEventListener('pointerenter', () => schedulePromptPreview(button));
      button.addEventListener('pointerleave', cancelScheduledPromptPreview);
      button.addEventListener('focus', () => showPromptPreview(button, true));
      button.addEventListener('click', (event) => {
        if (event.detail >= 2) {
          event.preventDefault();
          if (clickTimer) window.clearTimeout(clickTimer);
          clickTimer = 0;
          showPromptPreview(button, true);
          selectPrompt(button, promptClickSubmits(event.detail));
          return;
        }

        if (clickTimer) window.clearTimeout(clickTimer);
        const generation = read().promptToken;
        clickTimer = window.setTimeout(() => {
          clickTimer = 0;
          if (generation !== read().promptToken || !button.isConnected) return;
          showPromptPreview(button, true);
          selectPrompt(button, promptClickSubmits(1));
        }, PROMPT_CLICK_DELAY_MS);
      });
      button.addEventListener('dblclick', (event) => event.preventDefault());
    });
  }

  function clearPromptInteractionTimers() {
    if (previewTimer) window.clearTimeout(previewTimer);
    if (clickTimer) window.clearTimeout(clickTimer);
    previewTimer = 0;
    clickTimer = 0;
  }

  function schedulePromptPreview(button) {
    if (previewTimer) window.clearTimeout(previewTimer);
    previewTimer = 0;
    showPromptPreview(button);
  }

  function cancelScheduledPromptPreview() {
    if (previewTimer) window.clearTimeout(previewTimer);
    previewTimer = 0;
  }

  function showPromptPreview(button, immediate = false) {
    const index = Number(button.dataset.index);
    const item = read().prompts[index];
    const preview = container?.querySelector('.csw-prompt-preview');
    if (!item?.prompt || !preview) return;

    if (Number(preview.dataset.previewIndex) === index) {
      container.querySelectorAll('.csw-row').forEach((row) => {
        const active = row === button;
        row.dataset.previewActive = String(active);
        row.setAttribute('aria-current', active ? 'true' : 'false');
      });
      preview.removeAttribute('data-switching');
      return;
    }

    const applyPreview = () => {
      if (!button.isConnected || !preview.isConnected) return;
      container.querySelectorAll('.csw-row').forEach((row) => {
        const active = row === button;
        row.dataset.previewActive = String(active);
        row.setAttribute('aria-current', active ? 'true' : 'false');
      });
      const title = preview.querySelector('.csw-prompt-preview-title');
      const kicker = preview.querySelector('.csw-prompt-preview-kicker');
      const body = preview.querySelector('.csw-prompt-preview-body');
      const scroll = preview.querySelector('.csw-prompt-preview-scroll');
      if (kicker) kicker.textContent = `${index + 1} / ${read().prompts.length}`;
      if (title) title.textContent = item.label || item.prompt;
      if (body) body.textContent = item.prompt;
      if (scroll) scroll.scrollTop = 0;
      preview.dataset.previewIndex = String(index);
      reading.selected = index;
      reading.previewTop = 0;
      changed();
      window.requestAnimationFrame(() => {
        preview.removeAttribute('data-switching');
        if (preview.isConnected) changed();
      });
    };

    if (immediate) {
      if (previewTimer) window.clearTimeout(previewTimer);
      previewTimer = 0;
      preview.removeAttribute('data-switching');
      applyPreview();
      return;
    }
    const generation = read().promptToken;
    previewTimer = window.setTimeout(() => {
      previewTimer = 0;
      if (generation !== read().promptToken || !button.matches(':hover, :focus, :focus-within'))
        return;
      preview.dataset.switching = 'true';
      applyPreview();
    }, PROMPT_PREVIEW_SWITCH_MS);
  }

  function selectPrompt(button, submit) {
    const item = read().prompts[Number(button.dataset.index)];
    if (!item?.prompt) return;
    command('fill', { index: Number(button.dataset.index), submit });
  }

  function promptClickSubmits(clickDetail, value = read().display?.promptClickMode || 'fill') {
    const mode = value;
    if (mode === 'direct') return true;
    if (mode === 'fill') return false;
    return clickDetail >= 2;
  }

  function contentKey() {
    const snapshot = read();
    return JSON.stringify([
      snapshot.prompts,
      snapshot.promptToken,
      snapshot.display,
      snapshot.settings?.quickPrompts,
      snapshot.settings?.generationMode,
      snapshot.bridgeStatus,
      snapshot.bridgeError,
      snapshot.scanStatus,
      snapshot.scanBusy,
    ]);
  }
  return {
    html: nextHtml,
    key: contentKey,
    bind: attachNextEvents,
    clear: clearPromptInteractionTimers,
  };
}
