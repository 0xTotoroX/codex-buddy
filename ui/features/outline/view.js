/* [INPUT]: Outline projection and guarded navigation callback.
 * [OUTPUT]: Original outline rows, hanging numbering and turn navigation shared by all surfaces.
 * [POS]: Content only; Codex parsing and scrolling stay in the adapter.
 * [PROTOCOL]: Keep features/outline/AGENTS.md in sync. */
import { escapeAttr, escapeHtml, normalizeText } from '../../shared/text.js';
import { OUTLINE_INDENT_STEP, FRIENDLY_BRIDGE_ERRORS } from '../../shared/constants.js';
import { iconSvg } from '../../shared/icons/index.js';
export function alignOutlineNestedText(root) {
  const rows = Array.from(root?.querySelectorAll?.('.csw-outline-row[data-outline-id]') || []);
  const numberedAncestors = [];
  rows.forEach((row) => {
    const level = Math.max(0, Number(row.dataset.level) || 0);
    while (numberedAncestors.length && numberedAncestors.at(-1).level >= level)
      numberedAncestors.pop();

    const ancestor = numberedAncestors.at(-1);
    if (row.dataset.numbered === 'true') {
      row.style.removeProperty('--csw-outline-hanging-indent');
      const prefix = row.querySelector('.csw-outline-prefix');
      numberedAncestors.push({
        level,
        width: Math.max(0, (prefix?.getBoundingClientRect().width || 0) + 8 - OUTLINE_INDENT_STEP),
      });
      return;
    }

    row.style.setProperty('--csw-outline-hanging-indent', ancestor ? `${ancestor.width}px` : '0px');
  });
}

export function outlineHtml(snapshot) {
  if (snapshot.outlineStatus === 'pending' && !snapshot.outlineItems.length) {
    return `<div class="csw-empty" data-kind="outline" role="status">
        <div class="csw-empty-title">等待回答完成</div>
      </div>`;
  }
  if (snapshot.outlineStatus === 'error') {
    return `<div class="csw-empty" data-kind="outline">
        <div class="csw-empty-title">${escapeHtml(outlineErrorTitle(snapshot.outlineError))}</div>
      </div>`;
  }
  if (!snapshot.outlineItems.length) {
    return `<div class="csw-empty" data-kind="outline">
        <div class="csw-empty-title">暂无大纲</div>
      </div>`;
  }
  return `<div class="csw-outline-view">
      <div class="csw-outline-list" role="list">${snapshot.outlineItems
        .map((item) => {
          const displayLevel = item.displayLevel ?? 0;
          const numberPrefix = item.numberPrefix || '';
          const labelText = item.labelText || item.text;
          return `
        <button class="csw-outline-row" type="button" role="listitem" data-outline-id="${escapeAttr(item.id)}" data-level="${displayLevel}" data-numbered="${numberPrefix ? 'true' : 'false'}" aria-label="${escapeAttr(item.text)}" style="--csw-outline-indent:${Math.min(3, Math.max(0, displayLevel)) * OUTLINE_INDENT_STEP}px">
          <span class="csw-outline-heading-marker" aria-hidden="true"></span>
          <span class="csw-outline-prefix" aria-hidden="true">${escapeHtml(numberPrefix)}</span>
          <span class="csw-outline-label">${escapeHtml(labelText)}</span>
        </button>
      `;
        })
        .join('')}
      </div>
      <div class="csw-outline-toolbar" role="toolbar" aria-label="本轮导航">
        <button class="csw-outline-nav-button" type="button" data-outline-anchor="start" title="本轮开头" aria-label="定位到本轮开头">${iconSvg('turn-start')}</button>
        <button class="csw-outline-nav-button" type="button" data-outline-anchor="end" title="本轮结尾" aria-label="定位到本轮结尾">${iconSvg('turn-end')}</button>
      </div>
    </div>`;
}

function outlineErrorTitle(error = '') {
  const text = normalizeText(error);
  if (/找不到对应的小节/i.test(text)) return '找不到对应内容，刷新后再试';
  return (
    FRIENDLY_BRIDGE_ERRORS.find((item) => item.pattern.test(text))?.title ||
    '大纲暂不可用，稍后重试'
  );
}

export function attachOutlineEvents(root, command) {
  root.querySelectorAll('[data-outline-id]').forEach((button) => {
    button.addEventListener('click', () =>
      command('outline-jump', { id: button.dataset.outlineId }),
    );
  });
  root.querySelectorAll('[data-outline-anchor]').forEach((button) => {
    button.addEventListener('click', () =>
      command('outline-anchor', { anchor: button.dataset.outlineAnchor }),
    );
  });
}
