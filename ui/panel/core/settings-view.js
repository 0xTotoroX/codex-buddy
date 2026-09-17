/*
 * [INPUT]: 只读设置、窗口偏好与 runtime/settings-sync 操作。
 * [OUTPUT]: 胶囊设置页模板与控件绑定，三材质入口及内嵌与弹出端的 Clear 星星切换。
 * [POS]: 设置视图边界，不管理后台请求生命周期。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import {
  GENERATION_MODES,
  IS_POPOUT,
  MAX_FONT,
  MIN_FONT,
  PROMPT_CLICK_MODES,
  PROMPT_CLICK_MODE_KEY,
} from '../runtime/constants.js';
import {
  bumpFontSize,
  effectiveFontSize,
  fontSizeLabel,
  iconSvg,
  currentAppearance,
  materialButtonLabel,
  materialValueLabel,
  toggleLabelOnly,
  toggleMaterial,
  toggleLiquidVariant,
} from './panel-appearance.js';
import {
  escapeAttr,
  escapeHtml,
  normalizeGenerationMode,
  normalizePromptClickMode,
  normalizeText,
  outlineEnabled,
  outlineState,
  runtimeEnabled,
  runtimeState,
  shellState,
  stepwiseEnabled,
  stepwiseGenerationMode,
  stepwiseState,
  storage,
} from '../runtime/state.js';
import {
  openSettings,
  setGenerationMode,
  statusLine,
  testSettings,
} from '../runtime/settings-sync.js';
import {
  resolveFabExpression,
  stepwiseWaitingForManualRefresh,
  usesOutlineExpression,
} from './shell.js';

function settingsModelLabel(settings) {
  if (settings && !stepwiseEnabled(settings)) {
    return outlineEnabled(settings) ? '回答大纲' : '未启用';
  }
  const raw = normalizeText(settings?.model);
  if (!raw) return settings ? '未配置' : '读取中';
  const leaf = raw.split('/').pop() || raw;
  return leaf
    .replace(/^gpt[-_:]?/i, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => (/^\d/.test(part) ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join(' ');
}

function settingsRuntimePresentation(settings) {
  if (!settings) return { label: '正在读取设置', tone: 'busy' };
  if (!runtimeEnabled(settings)) return { label: '已关闭', tone: 'idle' };
  if (
    stepwiseEnabled(settings) &&
    (!settings.baseUrlConfigured || !settings.model || !settings.apiKeyConfigured)
  ) {
    return { label: '等待配置', tone: 'error' };
  }
  const expressionNow = Date.now();
  const outlineExpression = usesOutlineExpression(expressionNow);
  const expression = resolveFabExpression(expressionNow);
  const detail =
    (outlineExpression
      ? {
          idle: '等待回答',
          answering: '回答中',
          surprise: '正在整理回答',
          generating: '正在整理大纲',
          ready: `${outlineState.outlineItems.length} 个章节已准备`,
          empty: '暂无大纲',
          error: '生成失败',
          hidden: '已关闭',
        }
      : {
          idle: '等待回答',
          answering: '回答中',
          surprise: '正在整理回答',
          generating: '正在生成建议',
          ready: `${stepwiseState.prompts.length} 条建议已准备`,
          empty: '暂无建议',
          error: '生成失败',
          hidden: '已关闭',
        })[expression] || '等待回答';
  if (!outlineExpression && stepwiseWaitingForManualRefresh(settings)) {
    return { label: '当前为手动模式', tone: 'idle' };
  }
  return { label: detail, tone: statusTone(expression) };
}

function settingsCommandHtml(action, icon, label, title, options = {}) {
  return `
      <button class="csw-command-button" type="button" data-action="${escapeAttr(action)}" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}" ${options.disabled ? 'disabled' : ''}>
        <span class="csw-command-icon" data-busy="${options.busy === true}" aria-hidden="true">${iconSvg(icon)}</span>
        <span class="csw-command-label">${escapeHtml(label)}</span>
      </button>
    `;
}

function promptClickModeLabel(value = shellState.promptClickMode) {
  return {
    direct: '直接发送',
    hybrid: '单击填入 · 双击发送',
    fill: '仅填入',
  }[normalizePromptClickMode(value)];
}

function generationModeLabel(value = stepwiseGenerationMode()) {
  return normalizeGenerationMode(value) === 'manual' ? '手动刷新' : '自动生成';
}

function nextGenerationMode(value = stepwiseGenerationMode()) {
  const index = GENERATION_MODES.indexOf(normalizeGenerationMode(value));
  return GENERATION_MODES[(index + 1) % GENERATION_MODES.length];
}

function nextPromptClickMode(value = shellState.promptClickMode) {
  const index = PROMPT_CLICK_MODES.indexOf(normalizePromptClickMode(value));
  return PROMPT_CLICK_MODES[(index + 1) % PROMPT_CLICK_MODES.length];
}

function generationModeButtonLabel(value = stepwiseGenerationMode()) {
  return `模式：${generationModeLabel(value)}；切换为${generationModeLabel(nextGenerationMode(value))}`;
}

function promptClickModeButtonLabel(value = shellState.promptClickMode) {
  return `点击：${promptClickModeLabel(value)}；切换为${promptClickModeLabel(nextPromptClickMode(value))}`;
}

function toggleGenerationMode(event) {
  event?.preventDefault();
  event?.stopPropagation();
  return setGenerationMode(nextGenerationMode());
}

function togglePromptClickMode(event) {
  event?.preventDefault();
  event?.stopPropagation();
  return writePromptClickMode(nextPromptClickMode());
}

function appearanceSettingsHtml() {
  const appearance = currentAppearance();
  return `
      <div class="csw-control-deck" aria-label="外观、字号与显示">
        <div class="csw-control-group">
          <span class="csw-control-label">外观</span>
          <span class="csw-control-row">
            <button class="csw-control-button" type="button" data-action="material" data-material="${appearance.material}" title="${escapeAttr(materialButtonLabel())}" aria-label="${escapeAttr(materialButtonLabel())}"><span data-material-value>${materialValueLabel()}</span></button>
            <button class="csw-control-button csw-liquid-star" type="button" data-action="liquid-variant" aria-label="通透液态（Clear）" aria-pressed="${appearance.liquidVariant === 'clear'}" title="Regular 标准 / Clear 通透" ${appearance.material === 'native-glass' ? '' : 'hidden'}>${iconSvg('star')}</button>
          </span>
        </div>
        <div class="csw-control-group">
          <span class="csw-control-label" title="同时调整下一步与大纲内容字号">字号</span>
          <span class="csw-stepper" aria-label="下一步与大纲内容字号">
            <button class="csw-step-button" type="button" data-action="font-dec" title="减小字体" aria-label="减小字体" ${effectiveFontSize() <= MIN_FONT ? 'disabled' : ''}>−</button>
            <span class="csw-step-value" aria-live="polite">${fontSizeLabel()}</span>
            <button class="csw-step-button" type="button" data-action="font-inc" title="增大字体" aria-label="增大字体" ${effectiveFontSize() >= MAX_FONT ? 'disabled' : ''}>+</button>
          </span>
        </div>
        <div class="csw-control-group">
          <span class="csw-control-label">显示</span>
          <span class="csw-control-row">
            <button class="csw-control-button" type="button" data-action="label-only" aria-pressed="${shellState.labelOnly}" title="切换显示方式：${shellState.labelOnly ? '标题 + 摘要' : '仅标题'}"><span data-label-only-value>${shellState.labelOnly ? '仅标题' : '标题 + 摘要'}</span></button>
          </span>
        </div>
      </div>
    `;
}

function settingsHtml() {
  const settings = runtimeState.settingsLoaded ? runtimeState.settings : null;
  const runtime = settingsRuntimePresentation(settings);
  const model = settingsModelLabel(settings);
  const notice = settings ? settingsNotice(settings) : '';
  const noticeTone = /失败|错误|未配置|关闭|不可用|需要/i.test(notice) ? 'warn' : 'plain';
  const testing = runtimeState.settingsStatus === '正在检查连接';
  return `
      <div class="csw-settings">
        <section class="csw-settings-surface" data-loading="${!settings}" aria-label="悬浮球设置" aria-busy="${!settings}">
          <div class="csw-settings-hero">
            <div class="csw-model-pane">
              <strong class="csw-model-value" title="${escapeAttr(settings?.model || model)}">${escapeHtml(model)}</strong>
              <span class="csw-runtime-line">
                <span class="csw-runtime-dot" data-tone="${escapeAttr(runtime.tone)}" aria-hidden="true"></span>
                <span class="csw-runtime-copy">${escapeHtml(runtime.label)}</span>
              </span>
            </div>
            ${appearanceSettingsHtml()}
          </div>
          <div class="csw-settings-footer" aria-label="配置摘要与设置操作">
            <div class="csw-runtime-grid" aria-label="配置摘要">
              <div class="csw-generation-mode" data-generation-mode-control>
                <span class="csw-metric-label">模式</span>
                <button class="csw-metric-action" type="button" data-action="generation-mode" title="${escapeAttr(generationModeButtonLabel())}" aria-label="${escapeAttr(generationModeButtonLabel())}">
                  <span data-generation-mode-value>${generationModeLabel()}</span>
                </button>
              </div>
              <div class="csw-click-mode" data-prompt-click-control>
                <span class="csw-metric-label">点击</span>
                <button class="csw-metric-action" type="button" data-action="prompt-click-mode" title="${escapeAttr(promptClickModeButtonLabel())}" aria-label="${escapeAttr(promptClickModeButtonLabel())}">
                  <span data-prompt-click-mode-value>${promptClickModeLabel()}</span>
                </button>
              </div>
            </div>
            <div class="csw-command-deck" aria-label="设置操作">
              ${settingsCommandHtml('open-settings', 'open-config', '配置', '在浏览器中配置')}
              ${settingsCommandHtml('test-settings', testing ? 'refresh' : 'connection', '检查', '检查连接', { disabled: settings?.enabled !== true, busy: testing })}
            </div>
            ${notice ? `<div class="csw-settings-notice" data-tone="${noticeTone}" aria-live="polite">${escapeHtml(notice)}</div>` : ''}
          </div>
        </section>
      </div>
    `;
}

function settingsNotice(settings) {
  const status = runtimeState.settingsStatus || '';
  const line = statusLine(settings);
  if (!status || status === line) {
    if (
      stepwiseEnabled(settings) &&
      settings.baseUrlConfigured &&
      settings.model &&
      settings.apiKeyConfigured
    )
      return '';
    if (outlineEnabled(settings) && !stepwiseEnabled(settings)) return '';
    return line;
  }
  return status;
}

function attachSettingsEvents() {
  shellState.panel
    .querySelector('[data-action=liquid-variant]')
    ?.addEventListener('click', toggleLiquidVariant);
  shellState.panel
    .querySelector("[data-action='material']")
    ?.addEventListener('click', toggleMaterial);
  shellState.panel
    .querySelector("[data-action='label-only']")
    ?.addEventListener('click', toggleLabelOnly);
  shellState.panel
    .querySelector("[data-action='font-dec']")
    ?.addEventListener('click', () => bumpFontSize(-1));
  shellState.panel
    .querySelector("[data-action='font-inc']")
    ?.addEventListener('click', () => bumpFontSize(1));
  shellState.panel
    .querySelector("[data-action='open-settings']")
    ?.addEventListener('click', () => void openSettings());
  shellState.panel
    .querySelector("[data-action='test-settings']")
    ?.addEventListener('click', () => void testSettings());
  shellState.panel
    .querySelector("[data-action='generation-mode']")
    ?.addEventListener('click', (event) => {
      void toggleGenerationMode(event);
    });
  shellState.panel
    .querySelector("[data-action='prompt-click-mode']")
    ?.addEventListener('click', togglePromptClickMode);
}

function writePromptClickMode(value) {
  shellState.promptClickMode = normalizePromptClickMode(value);
  storage.set(PROMPT_CLICK_MODE_KEY, shellState.promptClickMode);
  const trigger = shellState.panel?.querySelector("[data-action='prompt-click-mode']");
  const display = trigger?.querySelector('[data-prompt-click-mode-value]');
  const label = promptClickModeButtonLabel();
  if (trigger) {
    trigger.title = label;
    trigger.setAttribute('aria-label', label);
  }
  if (display) display.textContent = promptClickModeLabel();
  return shellState.promptClickMode;
}

function updateGenerationModeControl(value = stepwiseGenerationMode(), busy = false) {
  const mode = normalizeGenerationMode(value);
  const trigger = shellState.panel?.querySelector("[data-action='generation-mode']");
  const display = trigger?.querySelector('[data-generation-mode-value]');
  const label = generationModeButtonLabel(mode);
  if (trigger) {
    trigger.title = label;
    trigger.setAttribute('aria-label', label);
    trigger.setAttribute('aria-busy', String(busy));
    trigger.disabled = busy;
  }
  if (display) display.textContent = generationModeLabel(mode);
}

function statusTone(expression) {
  if (expression === 'error') return 'error';
  if (expression === 'answering' || expression === 'generating') return 'busy';
  if (expression === 'ready' || expression === 'surprise') return 'ready';
  return 'idle';
}

export { attachSettingsEvents, settingsHtml, statusTone, updateGenerationModeControl };
