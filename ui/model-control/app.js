/*
 * [INPUT]: #token/#lease、/api/model-control/* 投影、原生几何与鼠标边界事件。
 * [OUTPUT]: 紧凑模型矩阵、版本保护写入、开合/内容高度 IPC；独立四主题、屏幕/位置设置。
 * [POS]: 独立 ES module 页面；不访问官方宿主、CDP 或模型发送接口。
 * [PROTOCOL]: 请求携带 Bearer 与 X-Model-Control-Lease；窗口几何和公开地图由父任务维护。
 */
import { icons, text, button, reconcile, describe, validate, moved } from './view.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.hash.slice(1));
const token = params.get('token');
const lease = params.get('lease');
history.replaceState(null, '', location.pathname + location.search);
const defaults = { edge: 'right', keepOpen: false, modelColumnWidth: 144, pinned: [], presets: [] };
let envelope = { snapshot: null, preferences: defaults, revision: 0 };
let expanded = false,
  keyboard = false,
  inside = false,
  hoverArmed = true;
let busy = false,
  reading = false,
  stopped = false,
  dragging = null;
let epoch = 0,
  enterTimer,
  leaveTimer,
  pollTimer;
let othersOpen = false,
  editor = null,
  undo = null,
  menuOpener = null;
let previewId = null,
  columns = [],
  widthDraft = null;
let nativeState = {};
let pointerButtons = 0;
let nativePointer = false,
  searchOpen = false,
  sizeFrame;
let lastNativeError = '';
let online = false,
  message = '';
const statusLabels = {
  ready: '已同步',
  unavailable: '来源不可用',
  waiting: '等待来源就绪',
  busy: '来源正忙',
  conflict: '目标冲突，请刷新确认',
};
const prefs = () => envelope.preferences;
const snapshot = () => envelope.snapshot;
const models = () => snapshot()?.models || [];
const editable = (node) => node?.matches('input, textarea, select, [contenteditable="true"]');
const canApply = () =>
  online &&
  !busy &&
  ['ready', 'waiting'].includes(snapshot()?.status) &&
  models().length > 0 &&
  !snapshot()?.generating &&
  !!snapshot()?.target?.id;
const canSave = () => canApply() && !validate(snapshot()?.current, models());
const reasonBlocked = () =>
  !online
    ? '连接不可用，请刷新后重试'
    : snapshot()?.generating
      ? '正在生成，暂不能修改配置'
      : snapshot()?.message || statusLabels[snapshot()?.status] || '等待来源就绪';

for (const [id, name] of Object.entries({
  'keep-open': 'pin',
  'menu-button': 'more',
  collapse: 'minus',
  refresh: 'refresh',
  fast: 'bolt',
}))
  $(id).innerHTML = icons[name];
$('save').innerHTML = icons.plus;

function native(message) {
  if (window.ipc?.postMessage) window.ipc.postMessage(JSON.stringify(message));
  else if (
    message.action === 'expand' ||
    message.action === 'collapse' ||
    message.action === 'edge'
  ) {
    window.dispatchEvent(
      new CustomEvent('model-control-native', {
        detail: {
          expanded:
            message.action === 'expand' ? true : message.action === 'collapse' ? false : expanded,
          edge: message.edge || document.body.dataset.edge,
          keyboard: message.keyboard ?? keyboard,
        },
      }),
    );
  }
}
function focusWindow() {
  native({ action: 'focus' });
}
function expand(activate = false) {
  clearTimeout(enterTimer);
  if (!expanded) native({ action: 'expand', keyboard: activate });
  if (activate) {
    keyboard = true;
    focusWindow();
  }
}
function collapse() {
  clearTimeout(enterTimer);
  clearTimeout(leaveTimer);
  hoverArmed = false;
  keyboard = false;
  closeEditor();
  closeMenu(false);
  setSearch(false);
  document.activeElement?.blur();
  native({ action: 'collapse' });
}
function scheduleCollapse() {
  clearTimeout(leaveTimer);
  if (inside || !expanded) return;
  leaveTimer = setTimeout(() => {
    if (
      !inside &&
      !prefs().keepOpen &&
      !keyboard &&
      !editable(document.activeElement) &&
      !dragging &&
      !pointerButtons &&
      !busy &&
      !editor &&
      !searchOpen &&
      $('menu').hidden
    )
      collapse();
  }, 450);
}
function applyAppearance(detail) {
  document.body.dataset.material = detail.effectiveMaterial || 'black';
  if (typeof detail.nativeDark === 'boolean')
    document.body.dataset.nativeDark = String(detail.nativeDark);
  document.body.dataset.nativeBackdrop = String(detail.nativeBackdrop === true);
  document.body.dataset.liquidVariant = detail.liquidVariant || 'regular';
  const offset = detail.appearance?.fontOffset;
  if (Number.isFinite(offset))
    document.documentElement.style.setProperty(
      '--model-font-offset',
      `${Math.max(-3, Math.min(11, offset))}px`,
    );
}
function pointerChanged(detail) {
  pointerButtons = detail.buttons || 0;
  inside = detail.inside === true;
  if (typeof detail.hoverSuppressed === 'boolean') hoverArmed = !detail.hoverSuppressed;
  if (inside) {
    clearTimeout(leaveTimer);
    if (!expanded && hoverArmed && !dragging && !detail.buttons && !detail.option) expand(false);
  } else {
    if (!detail.hoverSuppressed) hoverArmed = true;
    scheduleCollapse();
  }
}
window.addEventListener('model-control-pointer', ({ detail }) => {
  nativePointer = true;
  pointerChanged(detail || {});
});
function setSearch(open) {
  searchOpen = open;
  $('search-bar').hidden = !open;
  document.body.dataset.search = String(open);
  for (const id of ['fast', 'save']) $(id).hidden = open;
  renderPresets();
  if (open) {
    closeMenu(false);
    focusWindow();
    $('search').focus();
  } else {
    $('search').value = '';
    $('search').blur();
    render();
    scheduleCollapse();
  }
}
// Keep this quadratic contour aligned with model_control_geometry::surface_contains.
function shapeSurface(node) {
  const w = node.clientWidth,
    h = node.clientHeight;
  if (!w || !h) return;
  const edge = document.body.dataset.edge;
  const a = edge === 'top' ? h : w,
    b = edge === 'top' ? w : h;
  const p = (x, y) =>
    edge === 'left' ? `${w - x} ${y}` : edge === 'top' ? `${y} ${h - x}` : `${x} ${y}`;
  const contour = (depth, length, point) => {
    const lip = Math.min(8, depth / 2, length / 4);
    const r = Math.min(18, depth - lip, (length - 2 * lip) / 2);
    return `M ${point(depth, 0)} Q ${point(depth, lip)} ${point(depth - lip, lip)} L ${point(r, lip)} Q ${point(0, lip)} ${point(0, lip + r)} L ${point(0, length - lip - r)} Q ${point(0, length - lip)} ${point(r, length - lip)} L ${point(depth - lip, length - lip)} Q ${point(depth, length - lip)} ${point(depth, length)} Z`;
  };
  const clip = `path('${contour(a, b, p)}')`;
  node.style.setProperty('--shell-clip', clip);
  node.style.clipPath = clip;
  // Same thin silhouette at the edge; only the outline moves, never the text.
  const depth = Math.min(a, 10),
    length = Math.min(b, 80);
  const q = (x, y) => p(a - depth + x, (b - length) / 2 + y);
  node.style.setProperty('--compact-clip', `path('${contour(depth, length, q)}')`);
}
// Natural content height is independent of the current native viewport.
function queueSize() {
  cancelAnimationFrame(sizeFrame);
  sizeFrame = requestAnimationFrame(() => {
    if (!expanded || stopped || nativeState.hidden) return;
    const panel = $('panel');
    shapeSurface(panel);
    const natural = [...panel.children]
      .filter(
        (n) =>
          (!n.hidden && ['HEADER', 'SECTION', 'FOOTER'].includes(n.tagName)) ||
          (n.id === 'notice-area' && !n.hidden),
      )
      .reduce(
        (height, n) =>
          height +
          (n.classList.contains('model-section')
            ? $('model-scroll').scrollHeight
            : n.getBoundingClientRect().height),
        36,
      );
    native({ action: 'content-size', height: Math.ceil(Math.max(144, natural)) });
  });
}
window.addEventListener('model-control-native', (event) => {
  const detail = event.detail || {};
  applyAppearance(detail);
  const wasExpanded = expanded,
    wasKeyboard = nativeState.keyboard === true;
  nativeState = { ...nativeState, ...detail };
  const error = detail.error || detail.shortcutError || detail.preferenceError;
  if (typeof error === 'string' && error && error !== lastNativeError) notify(error);
  lastNativeError = error || '';
  if (typeof detail.expanded === 'boolean') expanded = detail.expanded;
  if (typeof detail.keyboard === 'boolean') keyboard = detail.keyboard;
  if (['right', 'left', 'top'].includes(detail.edge)) document.body.dataset.edge = detail.edge;
  if (Number.isFinite(detail.availableHeight))
    document.documentElement.style.setProperty('--available-height', `${detail.availableHeight}px`);
  const top = document.body.dataset.edge === 'top';
  const notched = top && nativeState.notchWidth > 0 && nativeState.notchHeight > 0;
  document.body.dataset.notched = String(notched);
  const finite = (value, fallback) => (Number.isFinite(value) && value > 0 ? value : fallback);
  const compactWidth = finite(
    nativeState.compactWidth,
    top ? (notched ? nativeState.notchWidth + 20 : 80) : 10,
  );
  const compactHeight = finite(
    nativeState.compactHeight,
    top ? (notched ? nativeState.notchHeight : 10) : 80,
  );
  const notchX = Number.isFinite(nativeState.notchX)
    ? nativeState.notchX
    : ((expanded ? innerWidth : compactWidth) - nativeState.notchWidth) / 2;
  const style = document.documentElement.style;
  style.setProperty(
    '--compact-width',
    `${notched ? Math.min(10, Math.max(0, notchX)) : compactWidth}px`,
  );
  style.setProperty('--compact-height', `${compactHeight}px`);
  style.setProperty('--handle-left', `${notched ? Math.max(0, notchX - 10) : 0}px`);
  style.setProperty(
    '--content-top',
    `${notched ? finite(nativeState.contentOffsetY, nativeState.notchHeight) : 0}px`,
  );
  const mask = $('notch-mask');
  mask.hidden = !notched;
  mask.style.width = `${finite(nativeState.notchWidth, 0)}px`;
  mask.style.height = `${finite(nativeState.notchHeight, 0)}px`;
  mask.style.left = `${notchX}px`;
  $('panel').hidden = !expanded || nativeState.hidden === true;
  $('handle').hidden = expanded || nativeState.hidden === true;
  if (!expanded) {
    closeMenu(false);
    closeEditor();
    keyboard = false;
  }
  // Native preference/geometry notifications must not steal an editor's focus.
  if (
    expanded &&
    keyboard &&
    (!wasExpanded ||
      (!wasKeyboard && !editor && !editable(document.activeElement) && $('menu').hidden))
  )
    requestAnimationFrame(() =>
      $('panel').querySelector('button:not(:disabled)')?.focus({ preventScroll: true }),
    );
  shapeSurface($('handle'));
  updateLayout();
});
for (const root of [$('handle'), $('panel')]) {
  root.addEventListener('pointerenter', (event) => {
    if (!nativePointer) pointerChanged({ inside: true, option: event.altKey });
  });
  root.addEventListener('pointerleave', () => {
    if (!nativePointer) pointerChanged({ inside: false });
  });
}
document.addEventListener('focusout', () => setTimeout(scheduleCollapse, 0));
window.addEventListener('blur', () => {
  keyboard = false;
  scheduleCollapse();
});
document.addEventListener('pointerdown', (event) => {
  keyboard = false;
  if (!event.target.closest('#menu, #menu-button') && !$('menu').hidden) closeMenu(false);
  if (editable(event.target)) focusWindow();
});

async function request(path, payload) {
  if (!token || !lease) throw new Error('缺少窗口凭据，请重新打开模型控制');
  const response = await fetch(`/api/model-control/${path}`, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Model-Control-Lease': lease,
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.message || `请求失败 (${response.status})`), {
      status: response.status,
    });
  return data;
}
function accept(data) {
  if (!data?.snapshot || !data.preferences || !Number.isInteger(data.revision))
    throw new Error('服务返回了无效状态');
  envelope = {
    snapshot: data.snapshot,
    preferences:
      data.revision >= envelope.revision
        ? { ...defaults, ...data.preferences }
        : envelope.preferences,
    revision: Math.max(envelope.revision, data.revision),
  };
  online = true;
  if (undo && (undo.target.id !== snapshot().target?.id || undo.revision !== snapshot().revision))
    undo = null;
  render();
}
function notify(value) {
  message = value;
  renderNotice();
}
function renderNotice() {
  $('notice-area').hidden = !message && !undo;
  text($('notice'), message);
  $('undo').hidden = !undo;
  $('undo').disabled = !canApply();
  $('undo').title = undo ? describe(undo.selection, models()) : '';
  queueSize();
}
async function readState() {
  if (stopped || reading || busy) return;
  reading = true;
  const started = epoch;
  try {
    const data = await request('state');
    if (started === epoch && !stopped) accept(data);
  } catch (error) {
    if (started === epoch && !stopped) {
      online = false;
      notify(error.message);
      render();
    }
  } finally {
    reading = false;
  }
}
async function mutate(run) {
  if (busy || stopped) return false;
  busy = true;
  epoch++;
  render();
  try {
    return await run();
  } catch (error) {
    online = false;
    notify(error.message);
    return false;
  } finally {
    busy = false;
    render();
    scheduleCollapse();
  }
}
async function savePreferences(patch, revision = envelope.revision) {
  return mutate(async () => {
    try {
      accept(await request('preferences', { revision, patch }));
      return true;
    } catch (error) {
      if (error.status === 409) {
        accept(await request('state'));
        notify('偏好已在其他窗口更改，已刷新；本次修改未覆盖。');
        closeEditor();
        closeMenu(false);
        return false;
      }
      throw error;
    }
  });
}
async function apply(selection, restore = false) {
  if (!canApply()) {
    notify(reasonBlocked());
    return;
  }
  const source = snapshot();
  const target = { ...source.target };
  let writeStarted = false;
  // A cell resolves its speed after explicit first-click readback. Hover/polling
  // still never opens the official menu, and presets retain their full selection.
  const resolveSelection = typeof selection === 'function' ? selection : () => selection;
  undo = null;
  await mutate(async () => {
    notify('正在核对并应用配置…');
    try {
      if (!source.current) {
        accept(await request('refresh', {}));
        if (
          snapshot()?.target?.id !== target.id ||
          snapshot()?.status !== 'ready' ||
          !snapshot()?.current
        )
          throw new Error(snapshot()?.message || '目标已变化或配置无法读取');
      }
      const resolved = resolveSelection();
      const invalid = validate(resolved, models());
      if (invalid) throw new Error(invalid);
      const frozen = Object.freeze({
        target: Object.freeze(target),
        expectedRevision: snapshot().revision,
        selection: Object.freeze({ ...resolved }),
      });
      writeStarted = true;
      const data = await request('apply', frozen);
      accept(data);
      const result = data.result;
      const previous = result?.previous?.selection || result?.previous?.current || result?.previous;
      if (
        !restore &&
        previous &&
        !validate(previous, models()) &&
        snapshot().target?.id === frozen.target.id &&
        result?.snapshot?.target?.id === frozen.target.id
      ) {
        undo = {
          target: frozen.target,
          revision: snapshot().revision,
          selection: {
            model: previous.model,
            reasoning: previous.reasoning,
            speed: previous.speed,
          },
        };
      }
      const labels = {
        success: '配置已应用',
        partial: '仅部分配置生效，请核对实际配置',
        failed: '配置未成功应用',
      };
      notify(
        `${labels[result?.status] || '请核对实际配置'}${result?.message ? `：${result.message}` : ''}`,
      );
    } catch (error) {
      // An uncertain write is never retried, and desired values never become actual values.
      try {
        accept(await request('state'));
      } catch {
        online = false;
      }
      notify(
        writeStarted
          ? `未确认应用结果：${error.message}。请核对实际配置后再操作。`
          : `未执行切换：${error.message}`,
      );
    }
  });
}
function manualSelection(model, reasoning) {
  return {
    model: model.id,
    reasoning,
    speed: snapshot()?.current?.speed === 'fast' && model.fast ? 'fast' : 'standard',
  };
}

function updateLayout() {
  const font =
    parseFloat(
      getComputedStyle(document.querySelector('.model-label strong') || $('panel')).fontSize,
    ) || 13;
  const width = Math.min(280, Math.max(100, widthDraft ?? prefs().modelColumnWidth));
  const needed = Math.max(42, ...columns.map((value) => value.length * font * 0.56 + 12));
  const style = document.documentElement.style;
  style.setProperty('--name-width', `${width}px`);
  style.setProperty('--columns', String(Math.max(1, columns.length)));
  style.setProperty('--matrix-width', `${width + 8 + columns.length * needed}px`);
  $('resize').setAttribute('aria-valuenow', String(Math.round(width)));
  document.body.dataset.layout = 'matrix';
  queueSize();
}
function render() {
  const source = snapshot();
  document.body.dataset.status = online ? source?.status || 'waiting' : 'unavailable';
  text($('target'), source?.target?.title || '尚未关联任务');
  $('target').title = [
    source?.target?.title,
    source?.target?.id,
    describe(source?.current, models()),
  ]
    .filter(Boolean)
    .join(' · ');
  text($('actual'), source?.current ? describe(source.current, models()) : '尚未读取');
  text(
    $('status'),
    !online
      ? '连接不可用'
      : source?.generating
        ? '正在生成 · 等待回答完成'
        : source?.status === 'ready' && source?.current
          ? ''
          : source?.message || statusLabels[source?.status] || '尚未读取 · 点击选择',
  );
  $('keep-open').setAttribute('aria-pressed', String(prefs().keepOpen));
  $('keep-open').disabled = busy || !online;
  $('save').disabled = !canSave();
  $('refresh').disabled = busy;
  renderPresets();
  renderModels();
  updateLayout();
  renderNotice();
  const model = models().find((item) => item.id === source?.current?.model);
  $('fast').disabled =
    !canApply() || !source?.current || !!validate(source.current, models()) || !model?.fast;
  $('fast').setAttribute('aria-pressed', String(source?.current?.speed === 'fast'));
  $('fast').title = !model?.fast
    ? '当前模型不支持 Fast'
    : source?.current?.speed === 'fast'
      ? 'Fast · 点击切换为 Standard'
      : 'Standard · 点击启用 Fast';
  text($('speed-note'), '速度选择会直接应用到当前模型');
  if (editor) {
    const stale =
      editor.kind === 'save' &&
      (!canSave() ||
        editor.target.id !== source?.target?.id ||
        editor.sourceRevision !== source?.revision);
    $('editor-submit').disabled = busy || stale;
    if (stale) text($('editor-description'), '实际配置已变化，请取消后重新保存当前配置。');
  }
  for (const node of $('menu').querySelectorAll('[data-write]'))
    node.disabled = busy || !online || node.dataset.unavailable === 'true';
}
function visiblePresets() {
  const query = $('search').value.trim().toLocaleLowerCase();
  return prefs().presets.filter((preset) =>
    `${preset.name} ${preset.selection.model} ${describe(preset.selection, models())}`
      .toLocaleLowerCase()
      .includes(query),
  );
}
function renderPresets() {
  $('presets').hidden = searchOpen && !$('search').value.trim();
  reconcile(
    $('presets'),
    visiblePresets(),
    (preset) => preset.id,
    (preset) => {
      const chip = document.createElement('div');
      chip.className = 'preset-chip';
      chip.draggable = true;
      const choose = button('', () => {
        const item = prefs().presets.find((item) => item.id === chip.dataset.key);
        if (item) apply(item.selection);
      });
      choose.setAttribute('aria-describedby', 'preview');
      const more = button('预设菜单', () => openPresetMenu(chip.dataset.key, more), 'more');
      more.className = 'icon-button';
      chip.append(choose, more);
      chip.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        openPresetMenu(chip.dataset.key, more);
      });
      for (const event of ['pointerenter', 'focusin'])
        chip.addEventListener(event, () => {
          previewId = chip.dataset.key;
          renderPreview();
        });
      chip.addEventListener('pointerleave', () => {
        if (!chip.contains(document.activeElement)) {
          previewId = null;
          renderPreview();
        }
      });
      chip.addEventListener('focusout', (event) => {
        if (!chip.contains(event.relatedTarget) && !chip.matches(':hover')) {
          previewId = null;
          renderPreview();
        }
      });
      bindSort(chip, 'presets');
      return chip;
    },
    (chip, preset) => {
      const [choose, more] = chip.children;
      text(choose, preset.name);
      choose.setAttribute('aria-label', `应用预设 ${preset.name}`);
      const invalid = validate(preset.selection, models());
      choose.disabled = !canApply() || !!invalid;
      choose.title = `${describe(preset.selection, models())}${invalid ? ` · ${invalid}` : ''}`;
      choose.setAttribute(
        'aria-pressed',
        String(JSON.stringify(snapshot()?.current) === JSON.stringify(preset.selection)),
      );
      more.setAttribute('aria-label', `预设 ${preset.name} 菜单`);
      more.title = `预设 ${preset.name} 菜单`;
      more.disabled = busy;
      chip.draggable = !busy;
    },
  );
  renderPreview();
}
function renderPreview() {
  const preset = prefs().presets.find((item) => item.id === previewId);
  $('preview').hidden = !preset;
  text(
    $('preview'),
    preset
      ? `${describe(preset.selection, models())}${validate(preset.selection, models()) ? ` · ${validate(preset.selection, models())}` : ''}`
      : '',
  );
}
function renderModels() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const visible = models().filter((model) =>
    `${model.label} ${model.id}`.toLocaleLowerCase().includes(query),
  );
  columns = [...new Set(visible.flatMap((model) => model.reasoning))];
  const ordered = prefs()
    .pinned.map((id) => visible.find((model) => model.id === id))
    .filter(Boolean);
  const current = visible.find(
    (model) => model.id === snapshot()?.current?.model && !prefs().pinned.includes(model.id),
  );
  if (!ordered.length) ordered.push(...visible);
  else if (current) ordered.push(current);
  const other = visible.filter((model) => !ordered.includes(model));
  for (const [id, list] of [
    ['pinned', ordered],
    ['others', other],
  ])
    reconcile($(id), list, (model) => model.id, createModelRow, updateModelRow);
  const open = othersOpen || !!query;
  $('others').hidden = !open;
  $('others-toggle').hidden = !other.length;
  $('others-toggle').setAttribute('aria-expanded', String(open));
  const disclosure = `${icons[open ? 'chevron-down' : 'chevron-right']}<span>其他模型 (${other.length})</span>`;
  if ($('others-toggle').innerHTML !== disclosure) $('others-toggle').innerHTML = disclosure;
  $('empty').hidden = !!visible.length;
  // Only this noninteractive heading is replaced when capabilities change.
  const headingKey = JSON.stringify(columns);
  if ($('matrix-head').dataset.key !== headingKey) {
    const label = document.createElement('span');
    label.textContent = '模型';
    const values = document.createElement('div');
    for (const value of columns) {
      const span = document.createElement('span');
      span.textContent = value;
      span.title = value;
      values.append(span);
    }
    $('matrix-head').replaceChildren(label, values);
    $('matrix-head').dataset.key = headingKey;
  }
}
function createModelRow() {
  const row = document.createElement('div');
  row.className = 'model-row';
  const name = document.createElement('div');
  name.className = 'model-name';
  const label = document.createElement('div');
  label.className = 'model-label';
  label.append(document.createElement('strong'), document.createElement('small'));
  const more = button('模型菜单', () => openModelMenu(row.dataset.key, more), 'more');
  more.className = 'icon-button';
  name.append(label, more);
  const choices = document.createElement('div');
  choices.className = 'choices';
  row.append(name, choices);
  name.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    openModelMenu(row.dataset.key, more);
  });
  bindSort(row, 'pinned', name);
  return row;
}
function updateModelRow(row, model) {
  const label = row.querySelector('strong');
  text(label, model.label);
  label.title = model.label;
  const pinned = prefs().pinned.includes(model.id);
  const current = snapshot()?.current?.model === model.id;
  text(
    row.querySelector('small'),
    current ? (pinned ? '当前' : '当前 · 未固定') : pinned ? '已固定' : '',
  );
  const more = row.querySelector('button');
  more.setAttribute('aria-label', `模型 ${model.label} 菜单`);
  more.title = `模型 ${model.label} 菜单`;
  more.disabled = busy;
  row.querySelector('.model-name').draggable = pinned && !busy;
  const reasoning = columns;
  reconcile(
    row.querySelector('.choices'),
    reasoning,
    (value) => value,
    (value) => {
      const choice = button(value, () => {
        const live = models().find((item) => item.id === row.dataset.key);
        if (live) apply(() => manualSelection(live, choice.dataset.key));
      });
      return choice;
    },
    (choice, value) => {
      const supported = model.reasoning.includes(value);
      const downgrade = snapshot()?.current?.speed === 'fast' && !model.fast;
      text(choice, supported ? '●' : '—');
      choice.disabled = !supported || !canApply();
      const title = `${model.label} · ${value} · ${manualSelection(model, value).speed === 'fast' ? 'Fast' : 'Standard'}${downgrade ? '（不支持 Fast，将使用 Standard）' : ''}`;
      choice.title = supported ? title : `${model.label} 不支持 ${value}`;
      choice.setAttribute('aria-label', choice.title);
      choice.setAttribute(
        'aria-pressed',
        String(supported && current && snapshot()?.current?.reasoning === value),
      );
      choice.dataset.model = model.id;
      choice.dataset.reasoning = value;
      choice.classList.toggle('unsupported', !supported);
    },
  );
}

function closeMenu(restore = true) {
  $('menu').hidden = true;
  $('menu-button').setAttribute('aria-expanded', 'false');
  if (restore && menuOpener?.isConnected) menuOpener.focus({ preventScroll: true });
  menuOpener = null;
  scheduleCollapse();
}
function openMenu(title, opener) {
  closeEditor();
  closeMenu(false);
  focusWindow();
  menuOpener = opener;
  const heading = document.createElement('h2');
  heading.textContent = title;
  $('menu').replaceChildren(heading);
  $('menu').hidden = false;
  $('menu').setAttribute('aria-label', title);
  $('menu').setAttribute('role', 'menu');
  $('menu').dataset.nav = '';
  $('menu-button').setAttribute('aria-expanded', 'true');
}
function menuAction(label, action, { write = true, disabled = false, icon, pressed } = {}) {
  const node = button(label, action);
  if (icon) {
    node.innerHTML = icons[icon];
    const span = document.createElement('span');
    span.textContent = label;
    node.append(span);
  }
  node.setAttribute('role', pressed === undefined ? 'menuitem' : 'menuitemradio');
  if (pressed !== undefined) node.setAttribute('aria-checked', String(pressed));
  if (write) node.dataset.write = '';
  node.dataset.unavailable = String(disabled);
  node.disabled = disabled || (write && (busy || !online));
  $('menu').append(node);
}
function finishMenu() {
  if (keyboard) $('menu').querySelector('button:not(:disabled)')?.focus();
}
function openSettings() {
  if (!$('menu').hidden && menuOpener === $('menu-button')) {
    closeMenu();
    return;
  }
  openMenu('模型快切', $('menu-button'));
  menuAction('搜索模型或预设 · ⌘F', () => setSearch(true), { write: false });
  for (const [edge, label] of [
    ['right', '右侧'],
    ['left', '左侧'],
    ['top', '顶部'],
  ])
    menuAction(
      label,
      async () => {
        if (await savePreferences({ edge })) {
          native({ action: 'edge', edge });
          closeMenu();
        }
      },
      { pressed: prefs().edge === edge },
    );
  menuAction('屏幕与位置…', () => openPlacement(), { write: false });
  menuAction(
    '主题…',
    () => {
      openMenu('主题', $('menu-button'));
      for (const [theme, label] of [
        ['black', '纯黑'],
        ['matte', '哑光'],
        ['frosted', '磨砂'],
        ['native-glass', '液态'],
      ])
        menuAction(
          label,
          async () => {
            if (await savePreferences({ theme })) closeMenu();
          },
          { pressed: (prefs().theme || 'black') === theme },
        );
      finishMenu();
    },
    { write: false },
  );
  menuAction('收起面板', collapse, { write: false, icon: 'minus' });
  menuAction(
    '退出模型控制',
    async () => {
      await mutate(async () => {
        await request('close', {});
        stopped = true;
        clearInterval(pollTimer);
        clearTimeout(enterTimer);
        clearTimeout(leaveTimer);
        native({ action: 'hide' });
        $('panel').hidden = true;
        $('handle').hidden = true;
      });
    },
    { write: false, icon: 'close' },
  );
  finishMenu();
}
async function openPlacement() {
  openMenu('屏幕与位置', $('menu-button'));
  const menu = $('menu');
  try {
    const { screens } = await request('displays');
    if (menu.hidden || menu.getAttribute('aria-label') !== '屏幕与位置') return;
    for (const screen of [{ id: '', label: '自动选择屏幕' }, ...screens])
      menuAction(
        screen.label,
        async () => {
          if (await savePreferences({ screen: screen.id })) closeMenu();
        },
        { pressed: prefs().screen === screen.id },
      );
    for (const [position, label] of [
      [0.2, '靠前 · 20%'],
      [0.5, '居中 · 50%'],
      [0.8, '靠后 · 80%'],
    ])
      menuAction(
        label,
        async () => {
          if (await savePreferences({ position })) closeMenu();
        },
        { pressed: prefs().position === position },
      );
    finishMenu();
  } catch (error) {
    notify(error.message);
    closeMenu();
  }
}
function openModelMenu(id, opener) {
  const model = models().find((item) => item.id === id);
  if (!model) return;
  openMenu(model.label, opener);
  const index = prefs().pinned.indexOf(id);
  menuAction(
    index < 0 ? '固定模型' : '取消固定',
    async () => {
      const next = prefs().pinned.filter((item) => item !== id);
      if (index < 0) next.push(id);
      if (await savePreferences({ pinned: next })) closeMenu();
    },
    { icon: 'pin' },
  );
  if (index >= 0) addReorderActions('pinned', id);
  finishMenu();
}
function openPresetMenu(id, opener) {
  const preset = prefs().presets.find((item) => item.id === id);
  if (!preset) return;
  openMenu(preset.name, opener);
  menuAction('重命名', () => openEditor('rename', preset));
  addReorderActions('presets', id);
  menuAction(
    '删除预设',
    async () => {
      if (await savePreferences({ presets: prefs().presets.filter((item) => item.id !== id) }))
        closeMenu();
    },
    { icon: 'close' },
  );
  finishMenu();
}
function addReorderActions(field, id) {
  const list = prefs()[field],
    index = list.findIndex((item) => (item.id || item) === id);
  for (const [offset, label, icon] of [
    [-1, '向前移动', 'turn-start'],
    [1, '向后移动', 'turn-end'],
  ])
    menuAction(
      label,
      async () => {
        const current = prefs()[field],
          from = current.findIndex((item) => (item.id || item) === id);
        if (await savePreferences({ [field]: moved(current, from, from + offset) })) closeMenu();
      },
      { disabled: index + offset < 0 || index + offset >= list.length, icon },
    );
}
function openEditor(kind, preset) {
  if (kind === 'save' && !canSave()) return;
  const opener = kind === 'save' ? $('save') : menuOpener;
  closeMenu(false);
  focusWindow();
  editor = {
    kind,
    opener,
    id: preset?.id,
    revision: envelope.revision,
    target: { ...snapshot()?.target },
    sourceRevision: snapshot()?.revision,
    selection: { ...(preset?.selection || snapshot()?.current) },
  };
  $('editor').hidden = false;
  $('preset-name').value =
    preset?.name ||
    `${models().find((model) => model.id === snapshot().current.model)?.label || snapshot().current.model} ${snapshot().current.reasoning}`;
  text($('editor-description'), describe(editor.selection, models()));
  $('preset-name').focus();
  $('preset-name').select();
  render();
}
function closeEditor() {
  if (!editor) return;
  const opener = editor.opener;
  editor = null;
  $('editor').hidden = true;
  if (expanded && opener?.isConnected) opener.focus({ preventScroll: true });
}
$('editor').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!editor || busy || $('editor-submit').disabled) return;
  const name = $('preset-name').value.trim();
  if (!name) {
    $('preset-name').focus();
    return;
  }
  const item = editor;
  const next =
    item.kind === 'save'
      ? [...prefs().presets, { id: crypto.randomUUID(), name, selection: item.selection }]
      : prefs().presets.map((preset) => (preset.id === item.id ? { ...preset, name } : preset));
  if (await savePreferences({ presets: next }, item.revision)) {
    closeEditor();
    notify('预设已保存');
  }
});

function bindSort(node, field, handle = node) {
  handle.addEventListener('dragstart', (event) => {
    if (busy || !online) {
      event.preventDefault();
      return;
    }
    const list = structuredClone(prefs()[field]);
    dragging = { kind: 'sort', field, id: node.dataset.key, list, revision: envelope.revision };
    node.dataset.dragging = 'true';
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', node.dataset.key);
    clearTimeout(enterTimer);
    clearTimeout(leaveTimer);
  });
  node.addEventListener('dragover', (event) => {
    if (dragging?.kind === 'sort' && dragging.field === field) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
  });
  node.addEventListener('drop', (event) => {
    if (dragging?.kind !== 'sort' || dragging.field !== field) return;
    event.preventDefault();
    const drag = dragging;
    const from = drag.list.findIndex((item) => (item.id || item) === drag.id);
    const to = drag.list.findIndex((item) => (item.id || item) === node.dataset.key);
    if (from !== to && to >= 0)
      savePreferences({ [field]: moved(drag.list, from, to) }, drag.revision);
    dragging = null;
    scheduleCollapse();
  });
  handle.addEventListener('dragend', () => {
    delete node.dataset.dragging;
    dragging = null;
    scheduleCollapse();
  });
}
let suppressHandleClick = false;
$('handle').addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  clearTimeout(enterTimer);
  clearTimeout(leaveTimer);
  suppressHandleClick = false;
  dragging = {
    kind: 'position',
    pointer: event.pointerId,
    x: event.screenX,
    y: event.screenY,
    moved: false,
  };
  $('handle').setPointerCapture(event.pointerId);
});
$('handle').addEventListener('pointermove', (event) => {
  if (dragging?.kind !== 'position' || dragging.pointer !== event.pointerId) return;
  const top = document.body.dataset.edge === 'top';
  const pixels = top ? event.screenX - dragging.x : event.screenY - dragging.y;
  if (!dragging.moved && Math.abs(pixels) < 4) return;
  dragging.moved = true;
  suppressHandleClick = true;
  native({
    action: 'position',
    delta: pixels / Math.max(1, top ? screen.availWidth : screen.availHeight),
  });
  dragging.x = event.screenX;
  dragging.y = event.screenY;
});
function endPosition(event) {
  if (dragging?.kind !== 'position') return;
  dragging = null;
  if ($('handle').hasPointerCapture(event.pointerId))
    $('handle').releasePointerCapture(event.pointerId);
  scheduleCollapse();
}
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
  $('handle').addEventListener(type, endPosition);
$('handle').addEventListener('click', (event) => {
  if (!suppressHandleClick) expand(event.detail === 0);
  suppressHandleClick = false;
});
$('resize').addEventListener('pointerdown', (event) => {
  if (busy || !online || event.button !== 0) return;
  event.preventDefault();
  dragging = {
    kind: 'width',
    pointer: event.pointerId,
    x: event.clientX,
    width: prefs().modelColumnWidth,
    revision: envelope.revision,
  };
  $('resize').setPointerCapture(event.pointerId);
});
$('resize').addEventListener('pointermove', (event) => {
  if (dragging?.kind !== 'width' || dragging.pointer !== event.pointerId) return;
  widthDraft = Math.max(100, Math.min(280, dragging.width + event.clientX - dragging.x));
  updateLayout();
});
function endResize(event) {
  if (dragging?.kind !== 'width') return;
  const drag = dragging;
  dragging = null;
  const width = widthDraft;
  widthDraft = null;
  if ($('resize').hasPointerCapture(event.pointerId))
    $('resize').releasePointerCapture(event.pointerId);
  if (event.type === 'pointerup' && width !== null && width !== drag.width)
    savePreferences({ modelColumnWidth: Math.round(width) }, drag.revision);
  else updateLayout();
  scheduleCollapse();
}
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
  $('resize').addEventListener(type, endResize);
$('resize').addEventListener('dblclick', () => savePreferences({ modelColumnWidth: 144 }));
$('resize').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  keyboard = true;
  savePreferences({
    modelColumnWidth:
      event.key === 'Home'
        ? 144
        : Math.min(
            280,
            Math.max(100, prefs().modelColumnWidth + (event.key === 'ArrowLeft' ? -8 : 8)),
          ),
  });
});
$('keep-open').addEventListener('click', () => savePreferences({ keepOpen: !prefs().keepOpen }));
$('collapse').addEventListener('click', collapse);
$('menu-button').addEventListener('click', openSettings);
$('save').addEventListener('click', () => openEditor('save'));
$('editor-cancel').addEventListener('click', closeEditor);
$('others-toggle').addEventListener('click', () => {
  othersOpen = !othersOpen;
  renderModels();
  updateLayout();
});
$('search').addEventListener('input', () => {
  renderPresets();
  renderModels();
  updateLayout();
});
$('refresh').addEventListener('click', () =>
  mutate(async () => {
    accept(await request('refresh', {}));
    notify('已刷新模型与实际配置');
  }),
);
$('fast').addEventListener('click', () => {
  if (!$('fast').disabled && snapshot()?.current)
    apply({
      ...snapshot().current,
      speed: snapshot().current.speed === 'fast' ? 'standard' : 'fast',
    });
});
$('target').addEventListener('click', () => {
  openMenu('关联目标与实际配置', $('target'));
  const details = document.createElement('p');
  details.textContent = $('target').title;
  $('menu').append(details);
});
$('undo').addEventListener('click', () => {
  const previous = undo;
  if (
    !previous ||
    previous.target.id !== snapshot()?.target?.id ||
    previous.revision !== snapshot()?.revision
  ) {
    undo = null;
    notify('目标或配置已变化，无法恢复之前配置。');
    return;
  }
  apply(previous.selection, true);
});
document.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    if (editor) closeEditor();
    else if (!$('menu').hidden) closeMenu();
    else if (searchOpen) setSearch(false);
    else collapse();
    return;
  }
  if (
    expanded &&
    ((event.key.toLowerCase() === 'f' && (event.metaKey || event.ctrlKey)) ||
      (event.key === '/' && !editable(event.target)))
  ) {
    event.preventDefault();
    setSearch(true);
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (
    ['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(event.key)
  ) {
    keyboard = true;
    focusWindow();
  }
  if (!expanded || editable(event.target)) return;
  if (keyboard && !event.repeat && /^[1-9]$/.test(event.key) && $('menu').hidden && !editor) {
    const preset = visiblePresets()[Number(event.key) - 1];
    if (preset) {
      event.preventDefault();
      apply(preset.selection);
    }
    return;
  }
  if (!event.key.startsWith('Arrow')) return;
  const group = event.target.closest('[data-nav]');
  if (!group) return;
  const choices = [...group.querySelectorAll('button:not(:disabled)')].filter(
    (node) => node.getClientRects().length,
  );
  const index = choices.indexOf(document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  let next;
  if (event.target.dataset.reasoning && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
    const rows = [...group.children];
    const row = event.target.closest('.model-row');
    const offset = event.key === 'ArrowUp' ? -1 : 1;
    const target = rows[rows.indexOf(row) + offset];
    next =
      [...(target?.querySelectorAll('.choices button:not(:disabled)') || [])].find(
        (node) => node.dataset.reasoning === event.target.dataset.reasoning,
      ) || target?.querySelector('.choices button:not(:disabled)');
  } else
    next =
      choices[
        (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + choices.length) %
          choices.length
      ];
  next?.focus({ preventScroll: false });
});
new ResizeObserver(updateLayout).observe($('model-scroll'));
// Font changes (accessibility settings or zoom) also change measured layout.
new ResizeObserver(updateLayout).observe($('resize'));
render();
native({ action: 'ready' });
readState();
pollTimer = setInterval(readState, 1200);
window.addEventListener('pagehide', () => {
  stopped = true;
  clearInterval(pollTimer);
  clearTimeout(enterTimer);
  clearTimeout(leaveTimer);
});
