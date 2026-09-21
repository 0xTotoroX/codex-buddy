/*
 * [INPUT]: 回答上下文、独立生成版本、模型桥接与宿主写入接口。
 * [OUTPUT]: 建议生成、按聊天/回答保留的有限内存缓存、预览与草稿保护；来源失联时禁止生成和填入。
 * [POS]: Stepwise 功能单元；不依赖大纲，通过通知请求外壳反馈。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import {
  EDITABLE_SUBMIT_DELAY_MS,
  INSTANCE_ID,
  IS_POPOUT,
  MAX_PROMPT_SUMMARY_LENGTH,
} from './runtime/constants.js';
import {
  assistantMessageId,
  chatBusy,
  composerCandidates,
  bindingSourceReady,
  contextMatches,
  contextSnapshot,
  findLatestAssistantMessage,
  findPreviousUserText,
  mainComposerCandidate,
  setScanStatus,
} from './host/context.js';
import {
  bridgeCall,
  clamp,
  configuredMaxPromptItems,
  contextState,
  hashText,
  isCurrentRuntime,
  normalizeGenerationMode,
  normalizeText,
  runtimeState,
  shellState,
  shortText,
  stepwiseEnabled,
  stepwiseGenerationMode,
  stepwiseInputText,
  stepwiseState,
} from './runtime/state.js';
import {
  composerRootForContext,
  rawComposerText,
  setEditableText,
  setNativeValue,
  submitComposerWhenReady,
} from './host/composer.js';
import { emitSignal } from './runtime/signals.js';
import { pushDiagnostic, rectSummary } from './runtime/diagnostics.js';
import { remotePanelAction } from './popout/transport.js';

function uniquePrompts(items) {
  const seen = new Set();
  const result = [];
  const maxItems = configuredMaxPromptItems();
  for (const item of Array.isArray(items) ? items : []) {
    const prompt = normalizeText(typeof item === 'string' ? item : item.prompt);
    const dedupeKey = prompt.replace(/\s+/g, ' ');
    if (!prompt || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push({
      label: leadingPromptText(
        typeof item === 'string' ? labelForPrompt(prompt) : item.label || labelForPrompt(prompt),
        36,
      ),
      summary: leadingPromptText(
        typeof item === 'string'
          ? summaryForPrompt(prompt)
          : item.summary || summaryForPrompt(prompt),
        MAX_PROMPT_SUMMARY_LENGTH,
      ),
      prompt,
    });
    if (result.length >= maxItems) break;
  }
  return result;
}

function normalizePromptState(items = stepwiseState.prompts) {
  const normalized = uniquePrompts(items);
  stepwiseState.prompts = normalized;
  shellState.promptPreviewIndex = normalized.length
    ? clamp(Number(shellState.promptPreviewIndex) || 0, 0, normalized.length - 1)
    : 0;
  return normalized;
}

function leadingPromptText(value, limit) {
  const characters = Array.from(normalizeText(value).replace(/\s+/g, ' '));
  if (characters.length <= limit) return characters.join('');
  return `${characters
    .slice(0, Math.max(0, limit - 1))
    .join('')
    .trimEnd()}…`;
}

function summaryForPrompt(prompt) {
  return leadingPromptText(prompt, MAX_PROMPT_SUMMARY_LENGTH);
}

function labelForPrompt(prompt) {
  const text = normalizeText(prompt);
  /** @type {[RegExp, string][]} */
  const rules = [
    [/diff|风险分级|改动.*总结/i, '查看 diff'],
    [/commit|提交/i, '整理 commit'],
    [/截图验证|遮挡|浮球|面板/i, '验证界面'],
    [/设置|配置|Bridge|API/i, '检查配置'],
    [/用户脚本|reload|生效/i, '检查脚本'],
    [/只读验证|确认.*生效|验证步骤/i, '验证生效'],
    [/错误|失败|最小复现|排查/i, '继续排查'],
    [/P0|P1|P2|执行顺序/i, '分级排序'],
    [/维护成本|长期稳定性|审查/i, '重新审查'],
    [/文件路径|当前状态|继续追踪/i, '列出路径'],
    [/下一步|改哪些文件/i, '继续下一步'],
    [/遗漏的风险|回滚方式/i, '风险回滚'],
  ];

  for (const [pattern, label] of rules) {
    if (pattern.test(text)) return label;
  }

  return (
    text
      .replace(/^(帮我|请|把|给我|继续|检查|执行一次|基于刚才的)/, '')
      .replace(/[，。,.].*$/, '')
      .trim()
      .slice(0, 10) || '继续'
  );
}

function payloadItems(payload) {
  return Array.isArray(payload?.items) ? payload.items : [];
}

function payloadPrompts(payload) {
  return uniquePrompts(
    payloadItems(payload).filter((item) => item && typeof item.prompt === 'string'),
  );
}

function bridgeRequestKey(userText, assistantText, answerHash = contextState.lastAssistantHash) {
  return hashText(
    `${contextState.activeContext.sessionId || contextState.activeContext.paneKey}\n${answerHash}\n${shortText(userText, 2400)}\n\n--- assistant ---\n\n${assistantText}`,
  );
}

// 保留最近 32 次结果，切换聊天可复用；不把建议或聊天正文写入持久存储。
function cacheBridgeResult(key, result) {
  stepwiseState.bridgeCache.delete(key);
  stepwiseState.bridgeCache.set(key, result);
  while (stepwiseState.bridgeCache.size > 32)
    stepwiseState.bridgeCache.delete(stepwiseState.bridgeCache.keys().next().value);
}

function requestBridgeStepwise(
  key,
  userText,
  assistantText,
  requestMode = stepwiseGenerationMode(),
  options = {},
) {
  if (
    !stepwiseEnabled() ||
    !key ||
    stepwiseState.bridgePendingHash === key ||
    stepwiseState.bridgeCache.has(key)
  )
    return;

  const normalizedMode = normalizeGenerationMode(requestMode);
  if (normalizedMode === 'manual' && options.userInitiated !== true) return;
  const requestContext = contextSnapshot();
  const requestEpoch = stepwiseState.stepwiseEpoch;
  const requestId = ++stepwiseState.bridgeRequestSequence;
  const requestAssistantMessageId = requestContext.assistantMessageId;
  const requestOwned = () =>
    stepwiseState.bridgePendingHash === key &&
    stepwiseState.bridgePendingRequestId === requestId &&
    stepwiseState.bridgePendingMode === normalizedMode;
  const requestCurrent = () =>
    stepwiseEnabled() &&
    stepwiseGenerationMode() === normalizedMode &&
    requestEpoch === stepwiseState.stepwiseEpoch &&
    contextMatches(requestContext) &&
    contextState.activeContext.assistantMessageId === requestAssistantMessageId &&
    stepwiseState.bridgeActiveKey === key &&
    !chatBusy();
  stepwiseState.bridgePendingHash = key;
  stepwiseState.bridgePendingRequestId = requestId;
  stepwiseState.bridgePendingMode = normalizedMode;
  stepwiseState.bridgeStatus = 'pending';
  stepwiseState.bridgeError = '';
  stepwiseState.promptContext = requestContext;
  pushDiagnostic('request:started', {
    id: requestId,
    epoch: requestEpoch,
    runtime: runtimeState.runtimeGeneration,
    trigger: options.userInitiated === true ? 'user' : 'automatic',
  });
  emitSignal('render', undefined);

  bridgeCall('/stepwise/generate', {
    request: {
      lastUserMessage: userText,
      lastAssistantMessage: assistantText,
      threadTitle: document.title || '',
      pageUrl: location.href,
      sessionId: requestContext.sessionId,
      answerId: requestAssistantMessageId,
      context: requestContext,
      instanceId: INSTANCE_ID,
      answerHash: contextState.lastAssistantHash,
      generationRevision: runtimeState.settings?.generationRevision,
      generationMode: normalizedMode,
      userInitiated: options.userInitiated === true,
    },
  })
    .then((payload) => {
      if (!requestOwned() || !requestCurrent()) return;
      const prompts = payload?.disabled || payload?.error ? [] : payloadPrompts(payload);
      const bridgeStatus = payload?.disabled ? 'disabled' : payload?.error ? 'failed' : 'ok';
      cacheBridgeResult(key, {
        status: bridgeStatus,
        disabled: Boolean(payload?.disabled),
        error: normalizeText(payload?.error || ''),
        prompts,
      });
      stepwiseState.bridgeStatus = bridgeStatus;
      stepwiseState.bridgeError = normalizeText(payload?.error || '');
      stepwiseState.promptContext = requestContext;
      if (bridgeStatus === 'ok') emitSignal('complete', prompts.length);
    })
    .catch((error) => {
      if (!requestOwned() || !requestCurrent()) return;
      cacheBridgeResult(key, {
        status: 'failed',
        disabled: true,
        error: error.message,
        prompts: [],
      });
      stepwiseState.bridgeStatus = 'failed';
      stepwiseState.bridgeError = error.message;
    })
    .finally(() => {
      if (!requestOwned()) return;
      stepwiseState.bridgePendingHash = '';
      stepwiseState.bridgePendingRequestId = 0;
      stepwiseState.bridgePendingMode = stepwiseGenerationMode();
      if (stepwiseState.bridgeStatus === 'pending') {
        stepwiseState.bridgeStatus = 'idle';
        stepwiseState.bridgeError = '';
        stepwiseState.promptContext = null;
      }
      emitSignal('scan', 0);
    });
}

function forceRefreshStepwise() {
  if (!bindingSourceReady()) return false;
  if (IS_POPOUT) {
    void remotePanelAction('generate');
    return;
  }
  if (!isCurrentRuntime() || !stepwiseEnabled()) return;
  if (stepwiseState.bridgeStatus === 'pending') {
    setScanStatus('manual-refresh-pending', {});
    return;
  }
  if (chatBusy()) {
    if (!stepwiseState.prompts.length) stepwiseState.bridgeError = '回答生成中，结束后再刷新';
    setScanStatus('manual-refresh-busy', {});
    emitSignal('render', undefined);
    return;
  }

  const message = findLatestAssistantMessage();
  if (!message) {
    stepwiseState.bridgeError = '未找到可用于生成的回答';
    stepwiseState.prompts = [];
    stepwiseState.promptContext = null;
    shellState.promptPreviewIndex = 0;
    setScanStatus('manual-refresh-no-assistant', {});
    emitSignal('render', undefined);
    return;
  }

  const nextAssistantMessageId = assistantMessageId(message);
  if (contextState.activeContext.assistantMessageId !== nextAssistantMessageId) {
    contextState.activeContext.assistantMessageId = nextAssistantMessageId;
  }

  const sourceText = normalizeText(message.text);
  const assistantText = stepwiseInputText(sourceText);
  const answerHash = hashText(sourceText);
  const userText = findPreviousUserText(message);
  const bridgeKey = bridgeRequestKey(userText, assistantText, answerHash);
  const generationMode = stepwiseGenerationMode();
  stepwiseState.bridgeActiveKey = bridgeKey;
  stepwiseState.stepwiseEpoch += 1;
  stepwiseState.bridgePendingHash = '';
  stepwiseState.bridgePendingRequestId = 0;
  stepwiseState.bridgePendingMode = generationMode;
  if (bridgeKey) stepwiseState.bridgeCache.delete(bridgeKey);

  contextState.lastAssistantHash = answerHash;
  contextState.lastAssistantAt = 0;
  stepwiseState.currentHash = `${contextState.lastAssistantHash}:manual-refresh`;
  stepwiseState.prompts = [];
  stepwiseState.promptContext = contextSnapshot();
  shellState.promptPreviewIndex = 0;
  stepwiseState.bridgeError = '';
  setScanStatus('manual-refresh', {
    hash: contextState.lastAssistantHash,
    textLength: assistantText.length,
  });
  requestBridgeStepwise(bridgeKey, userText, assistantText, generationMode, {
    userInitiated: true,
  });
  emitSignal('render', undefined);
}

function clearPromptsForNewAssistant(hash) {
  stepwiseState.stepwiseEpoch += 1;
  stepwiseState.bridgeActiveKey = '';
  stepwiseState.bridgePendingHash = '';
  stepwiseState.bridgePendingRequestId = 0;
  stepwiseState.bridgePendingMode = stepwiseGenerationMode();
  stepwiseState.bridgeStatus =
    stepwiseState.bridgePendingMode === 'manual' ? 'manual-ready' : 'idle';
  stepwiseState.currentHash = `${hash}:pending`;
  stepwiseState.prompts = [];
  stepwiseState.promptContext = contextSnapshot();
  shellState.promptPreviewIndex = 0;
  stepwiseState.bridgeError = '';
  emitSignal('render', undefined);
}

function fillComposer(prompt, submit = false, options = {}) {
  if (!bindingSourceReady()) return false;
  if (IS_POPOUT) {
    void remotePanelAction('fill', {
      index: stepwiseState.prompts.findIndex((item) => item.prompt === prompt),
      submit,
    });
    return true;
  }
  const context = stepwiseState.promptContext || contextState.activeContext;
  const epoch = stepwiseState.stepwiseEpoch;
  const generation = runtimeState.runtimeGeneration;
  const intent = {
    context,
    isCurrent: () =>
      isCurrentRuntime(generation) && stepwiseEnabled() && stepwiseState.stepwiseEpoch === epoch,
  };
  const targetRoot = composerRootForContext(context);
  const candidates = targetRoot ? composerCandidates(targetRoot) : [];
  const target = targetRoot ? mainComposerCandidate(candidates, targetRoot) : null;
  pushDiagnostic('fill:start', {
    submit,
    candidateCount: candidates.length,
    paneKey: context?.paneKey || '',
    sessionId: context?.sessionId || '',
    targetTag: target?.tagName || '',
    targetRole: target?.getAttribute?.('role') || '',
    targetClass: String(target?.className || '').slice(0, 120),
    targetRect: rectSummary(target),
    chatRootRect: rectSummary(targetRoot),
    promptLength: normalizeText(prompt).length,
  });
  if (!target) {
    pushDiagnostic('fill:no-main-composer', { candidateCount: candidates.length });
    if (options.remote) return { ok: false, message: '找不到关联的 Codex 输入框。' };
    window.prompt('Copy Stepwise prompt', prompt);
    return false;
  }

  if (!contextMatches(context)) return false;
  const existing = rawComposerText(target);
  let append = false;
  if (options.remote && options.append && hashText(existing) !== options.draftFingerprint)
    return { ok: false, message: '草稿已经变化，请重新选择建议。' };
  if (existing.trim() && normalizeText(existing) !== normalizeText(prompt)) {
    if (options.remote && !options.append)
      return { ok: false, needsConfirmation: true, draftFingerprint: hashText(existing) };
    if (!options.remote && !window.confirm('输入框已有草稿。保留草稿并追加这条建议？'))
      return false;
    if (!contextMatches(context)) return false;
    prompt = `\n\n${prompt}`;
    append = true;
    submit = false;
  }
  target.focus();
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    setNativeValue(target, append ? existing + prompt : prompt);
    target.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }),
    );
    target.dispatchEvent(new Event('change', { bubbles: true }));
    pushDiagnostic('fill:text-control', { valueLength: normalizeText(target.value).length });
    if (submit) submitComposerWhenReady(target, intent, prompt);
    return true;
  }

  if (target.isContentEditable || target.getAttribute('role') === 'textbox') {
    setEditableText(target, prompt, append);
    target.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }),
    );
    pushDiagnostic('fill:editable', { valueLength: normalizeText(target.textContent).length });
    if (submit)
      window.setTimeout(
        () => submitComposerWhenReady(target, intent, prompt),
        EDITABLE_SUBMIT_DELAY_MS,
      );
    return true;
  }

  window.prompt('Copy Stepwise prompt', prompt);
  return false;
}

function resetStepwiseFeature(status = 'idle', { preserveCache = false } = {}) {
  stepwiseState.stepwiseEpoch += 1;
  emitSignal('preview', undefined);
  shellState.promptPreviewIndex = 0;
  stepwiseState.bridgeActiveKey = '';
  stepwiseState.bridgePendingHash = '';
  stepwiseState.bridgePendingRequestId = 0;
  stepwiseState.bridgePendingMode = stepwiseGenerationMode();
  stepwiseState.bridgeStatus = status;
  stepwiseState.bridgeError = '';
  if (!preserveCache) stepwiseState.bridgeCache.clear();
  stepwiseState.prompts = [];
  stepwiseState.promptContext = null;
  stepwiseState.currentHash = '';
}

export {
  bridgeRequestKey,
  clearPromptsForNewAssistant,
  fillComposer,
  forceRefreshStepwise,
  labelForPrompt,
  normalizePromptState,
  requestBridgeStepwise,
  resetStepwiseFeature,
  summaryForPrompt,
};
