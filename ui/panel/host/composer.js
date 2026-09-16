/*
 * [INPUT]: 宿主输入框、已校验上下文与显式写入意图。
 * [OUTPUT]: 输入框定位、保留草稿写入与发送就绪重试。
 * [POS]: 宿主写入边界，不生成建议或调用大纲。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import { SUBMIT_RETRY_DELAY_MS, SUBMIT_RETRY_LIMIT } from '../runtime/constants.js';
import {
  buttonLabel,
  chatRoot,
  composerBusy,
  composerCandidates,
  contextMatches,
  disabledButton,
  iconPathData,
  mainComposerCandidate,
  nearbySubmitButton,
  rootForContext,
} from './context.js';
import { normalizeText } from '../runtime/state.js';
import { pushDiagnostic, rectSummary } from '../runtime/diagnostics.js';

function composerRootForContext(snapshot) {
  if (snapshot?.paneKey) return rootForContext(snapshot.paneKey, snapshot.sessionId);
  return chatRoot();
}

function composerTargetForContext(snapshot) {
  const root = composerRootForContext(snapshot);
  if (!root) return null;
  return mainComposerCandidate(composerCandidates(root), root);
}

function setNativeValue(element, value) {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (descriptor && typeof descriptor.set === 'function') descriptor.set.call(element, value);
  else element.value = value;
}

function composerText(target) {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)
    return normalizeText(target.value);
  return normalizeText(target?.innerText || target?.textContent || '');
}

function pressEnter(target) {
  target.focus();
  const base = {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  const down = target.dispatchEvent(new KeyboardEvent('keydown', base));
  target.dispatchEvent(new KeyboardEvent('keypress', base));
  target.dispatchEvent(new KeyboardEvent('keyup', base));
  pushDiagnostic('submit:enter-fallback', { defaultAllowed: down });
  return true;
}

function submitComposer(target, allowFallback = false) {
  if (!(target instanceof HTMLElement)) return false;
  if (composerBusy(target)) {
    pushDiagnostic('submit:blocked-local-stop', { attemptFallback: allowFallback });
    return false;
  }

  const button = nearbySubmitButton(target);
  if (button) {
    pushDiagnostic('submit:button-click', {
      label: buttonLabel(button),
      disabled: disabledButton(button),
      rect: rectSummary(button),
      className: String(button.className || '').slice(0, 160),
      composerTextLength: composerText(target).length,
      iconPath: iconPathData(button).slice(0, 160),
    });
    button.click();
    return true;
  }

  const pendingButton = nearbySubmitButton(target, { includeDisabled: true });
  if (pendingButton && disabledButton(pendingButton)) {
    pushDiagnostic('submit:button-disabled', {
      label: buttonLabel(pendingButton),
      rect: rectSummary(pendingButton),
      className: String(pendingButton.className || '').slice(0, 160),
      composerTextLength: composerText(target).length,
      iconPath: iconPathData(pendingButton).slice(0, 160),
    });
    return false;
  }

  const form = target.closest('form');
  if (form && allowFallback) {
    pushDiagnostic('submit:form-fallback', { rect: rectSummary(form) });
    try {
      form.requestSubmit();
    } catch {
      pushDiagnostic('submit:form-fallback-failed', {});
      return false;
    }
    return true;
  }

  if (allowFallback) return pressEnter(target);
  pushDiagnostic('submit:no-button-yet', { allowFallback });
  return false;
}

function submitComposerWhenReady(target, intent, expectedText = '', attempt = 0) {
  let currentTarget = target;
  if (!intent.isCurrent() || !intent.context || !contextMatches(intent.context)) return false;
  if (!(currentTarget instanceof HTMLElement)) return false;
  if (!document.contains(currentTarget)) {
    currentTarget = composerTargetForContext(intent.context);
    pushDiagnostic('submit:target-detached', {
      attempt,
      rebound: Boolean(currentTarget),
      paneKey: intent.context.paneKey,
      sessionId: intent.context.sessionId,
    });
    if (!currentTarget) {
      if (attempt >= SUBMIT_RETRY_LIMIT) return false;
      window.setTimeout(
        () => submitComposerWhenReady(target, intent, expectedText, attempt + 1),
        SUBMIT_RETRY_DELAY_MS,
      );
      return false;
    }
  }
  if (normalizeText(expectedText) && composerText(currentTarget) !== normalizeText(expectedText)) {
    pushDiagnostic('submit:composer-changed', {
      attempt,
      expectedLength: normalizeText(expectedText).length,
      actualLength: composerText(currentTarget).length,
    });
    return false;
  }
  if (composerBusy(currentTarget)) {
    if (attempt === 0 || attempt % 10 === 0 || attempt >= SUBMIT_RETRY_LIMIT) {
      pushDiagnostic('submit:blocked-local-stop', {
        attempt,
        retrying: attempt < SUBMIT_RETRY_LIMIT,
        targetRect: rectSummary(currentTarget),
      });
    }
    if (attempt >= SUBMIT_RETRY_LIMIT) {
      pushDiagnostic('submit:blocked-local-stop-timeout', {
        attempt,
        targetRect: rectSummary(currentTarget),
      });
      return false;
    }
    window.setTimeout(
      () => submitComposerWhenReady(currentTarget, intent, expectedText, attempt + 1),
      SUBMIT_RETRY_DELAY_MS,
    );
    return false;
  }
  if (submitComposer(currentTarget, attempt >= SUBMIT_RETRY_LIMIT)) return true;
  if (attempt >= SUBMIT_RETRY_LIMIT) return false;
  window.setTimeout(
    () => submitComposerWhenReady(currentTarget, intent, expectedText, attempt + 1),
    SUBMIT_RETRY_DELAY_MS,
  );
  return false;
}

function setEditableText(target, prompt, append = false) {
  target.focus();
  const selection = window.getSelection?.();
  const range = document.createRange();
  range.selectNodeContents(target);
  if (append) range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);

  let inserted = false;
  try {
    inserted = document.execCommand?.('insertText', false, prompt) === true;
  } catch {
    inserted = false;
  }
  if (!inserted) {
    if (append) target.appendChild(document.createTextNode(prompt));
    else target.textContent = prompt;
  }
}

function rawComposerText(target) {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)
    return target.value;
  const read = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (!(node instanceof Element)) return '';
    if (node.tagName === 'BR') return node.parentElement?.childNodes.length === 1 ? '' : '\n';
    const value = Array.from(node.childNodes, read).join('');
    return /^(P|DIV|LI)$/.test(node.tagName) ? `${value}\n` : value;
  };
  return Array.from(target.childNodes, read).join('').replace(/\n$/, '');
}

export {
  composerRootForContext,
  rawComposerText,
  setEditableText,
  setNativeValue,
  submitComposerWhenReady,
};
