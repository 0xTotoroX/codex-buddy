/* [INPUT]: Existing model control envelope and serialized actions.
 * [OUTPUT]: Title-aligned reasoning headings, content-sized favorites matrix, independent Fast charge/strike and divider controls, recessed preset tags, in-panel catalog and wrapping presets with synchronous draft handoff and capability-driven selection.
 * [POS]: Reusable business view; surfaces own placement and theme.
 * [PROTOCOL]: Keep AGENTS.md in this module in sync. */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ModelHeading } from './heading';
import { useFastMotion } from './fast-motion';
import { iconSvg } from '../../shared/icons/index.js';
import type { ModelPresetDraft, Reading } from '../../shared/features';
import {
  groupedModels,
  orderedModelIds,
  uniquePresetName,
  uniquePresetNames,
  type ModelState,
  type Selection,
} from './catalog';
export type { ModelState } from './catalog';
const dischargeShape =
  'M24 0 L23 43 L27 86 L20 122 L26 166 L23 209 L28 256 L21 295 L25 328 L24 360';
const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const icon = (name: string) => <span dangerouslySetInnerHTML={{ __html: iconSvg(name) }} />;
export function ModelView({
  state,
  action,
  busy,
  reading,
  headerActions,
}: {
  headerActions?: HTMLElement;
  reading: Reading;
  state: ModelState;
  action: (data: unknown, action: string) => Promise<unknown>;
  busy: boolean;
}) {
  const [tools, setTools] = useState(reading.modelTools || false),
    [others, setOthers] = useState(false),
    [browserHeight, setBrowserHeight] = useState(0),
    [drop, setDrop] = useState(''),
    [dragging, setDragging] = useState(false),
    [columnWidth, setColumnWidth] = useState<number | null>(null),
    [metrics, setMetrics] = useState({ available: 0, widths: [] as number[] }),
    [presetDraft, renderPresetDraft] = useState<ModelPresetDraft | null>(() =>
      structuredClone(reading.modelPresetDraft || null),
    );
  function setPresetDraft(draft: ModelPresetDraft | null) {
    // 输入事件内同步交接副本，确保紧接着卸载或移动时 capture 不依赖 effect 时机。
    if (draft) reading.modelPresetDraft = structuredClone(draft);
    else delete reading.modelPresetDraft;
    renderPresetDraft(draft);
  }
  function closeTools() {
    setTools((reading.modelTools = false));
  }
  function renamePreset(p: ModelState['preferences']['presets'][number]) {
    setPresetDraft({ ...p, selection: { ...p.selection }, creating: false });
  }
  const matrix = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const pickerToggle = useRef<HTMLButtonElement>(null);
  const restorePickerFocus = useRef(false);
  useLayoutEffect(() => {
    if (!others && restorePickerFocus.current) {
      restorePickerFocus.current = false;
      pickerToggle.current?.focus({ preventScroll: true });
    }
  }, [others]);
  const headings = useRef<HTMLDivElement>(null);
  const motion = useFastMotion();
  const fastButton = motion.button,
    discharge = motion.beam,
    dischargePath = motion.path;
  const stopDischarge = motion.stop;
  useEffect(() => {
    if (others) stopDischarge();
  }, [others]);
  useEffect(() => {
    if (!others) return;
    const document = root.current!.ownerDocument;
    const outside = (event: PointerEvent) => {
      const path = event.composedPath();
      if (!path.includes(picker.current!) && !path.includes(pickerToggle.current!))
        setOthers(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.stopPropagation();
      restorePickerFocus.current = true;
      setOthers(false);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    picker.current?.querySelector<HTMLButtonElement>('.model-tile')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [others]);
  const resize = useRef<{
    pointer: number;
    x: number;
    y: number;
    moved: boolean;
    width: number;
    value: number;
    scale: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (matrix.current) matrix.current.scrollLeft = reading.modelLeft || 0;
  }, []);
  const s = state.snapshot,
    prefs = state.preferences;
  const allowed = !!s.target && ['ready', 'waiting'].includes(s.status) && prefs.enabled;
  const apply = (selection: Selection, preserveSpeed = false) =>
    action({ target: s.target, expectedRevision: s.revision, selection, preserveSpeed }, 'apply');
  const save = (patch: object) => action({ revision: state.revision, patch }, 'preferences');
  const addPreset = async () => {
    if (busy || !allowed || !s.current) return;
    closeTools();
    setOthers(false);
    const preset = {
      id: crypto.randomUUID(),
      name: uniquePresetName(
        s.models.find((m) => m.id === s.current?.model)?.label || s.current.model,
        prefs.presets,
      ),
      selection: { ...s.current },
    };
    const result = await save({ presets: uniquePresetNames([...prefs.presets, preset]) });
    if (result !== null) setPresetDraft(null);
  };
  const saveWidth = async (width: number) => {
    try {
      await save({ modelColumnWidth: width });
    } finally {
      setColumnWidth(null);
    }
  };
  const valid = (selection: Selection) =>
    s.models.some(
      (m) =>
        m.id === selection.model &&
        (m.reasoning.includes(selection.reasoning) ||
          (!m.reasoning.length && !selection.reasoning)) &&
        (selection.speed !== 'fast' || m.fast),
    );
  const modelOrder = orderedModelIds(s.models, prefs);
  const models = modelOrder.flatMap((id) => {
    const model = s.models.find((m) => m.id === id);
    return model ? [model] : [];
  });
  const visible = models.filter((m) => prefs.pinned.includes(m.id));
  const groups = groupedModels(models, prefs);
  const dragType = 'application/x-codex-buddy-model';
  const order = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  const columns = [
    ...new Set(visible.flatMap((m) => (m.reasoning.length ? m.reasoning : ['']))),
  ].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  // 按实际表头文字保留思考列的可读宽度，不用最长标题把每一列都撑宽。
  useLayoutEffect(() => {
    const node = matrix.current;
    if (!node) return;
    const labels = [
      ...(headings.current?.querySelectorAll<HTMLElement>('[data-reasoning-label]') || []),
    ];
    const measure = () => {
      if (!node.clientWidth || (columns.length && !headings.current?.offsetWidth)) return;
      const widths = labels.map((label) => Math.max(28, label.offsetWidth + 12));
      const available = node.clientWidth;
      setMetrics((previous) =>
        previous.available === available &&
        previous.widths.length === widths.length &&
        widths.every((w, i) => w === previous.widths[i])
          ? previous
          : { available, widths },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    labels.forEach((label) => observer.observe(label));
    measure();
    return () => observer.disconnect();
  }, [columns.join('|'), headerActions]);
  const widths = columns.length ? columns.map((_, i) => metrics.widths[i] || 63) : [28];
  const reasoningWidth = widths.reduce((sum, width) => sum + width, 0) + (widths.length - 1) * 4;
  const maxNameWidth = metrics.available
    ? Math.max(100, Math.min(560, Math.floor(metrics.available - 16 - reasoningWidth)))
    : 560;
  const clampWidth = (width: number) => Math.max(100, Math.min(maxNameWidth, Math.round(width)));
  const nameWidth = clampWidth(columnWidth ?? prefs.modelColumnWidth ?? 140);
  const rows = (items: typeof models) =>
    items.map((m) => (
      <div
        className="model-row"
        data-model-row={m.id}
        data-drop={drop.startsWith(`${m.id}:`) ? drop.split(':').at(-1) : undefined}
        key={m.id}
        onDragOver={(event) => {
          if (busy || !prefs.enabled || !event.dataTransfer.types.includes(dragType)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          const rect = event.currentTarget.getBoundingClientRect();
          setDrop(`${m.id}:${event.clientY < rect.y + rect.height / 2 ? 'before' : 'after'}`);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop('');
        }}
        onDrop={(event) => {
          setDrop('');
          if (busy || !prefs.enabled || !event.dataTransfer.types.includes(dragType)) return;
          event.preventDefault();
          event.stopPropagation();
          const id = event.dataTransfer.getData(dragType);
          if (id === m.id || !models.some((model) => model.id === id) || !prefs.pinned.includes(id))
            return;
          const next = modelOrder.filter((item) => item !== id);
          const rect = event.currentTarget.getBoundingClientRect();
          next.splice(
            next.indexOf(m.id) + (event.clientY >= rect.y + rect.height / 2 ? 1 : 0),
            0,
            id,
          );
          void save({ modelOrder: next });
        }}
      >
        <div className="model-name">
          <strong
            draggable={!busy && prefs.enabled}
            onDragStart={(event) => {
              event.stopPropagation();
              event.dataTransfer.setData(dragType, m.id);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => setDrop('')}
          >
            <span>{label(m.label).split(' · ')[0]}</span>
            {m.label.includes(' · ') && (
              <span className="model-route">{m.label.split(' · ').slice(1).join(' · ')}</span>
            )}
            {models.some((other) => other.id !== m.id && other.label === m.label) && (
              <small className="model-route">{m.id}</small>
            )}
          </strong>
        </div>
        <div className="model-choices">
          {columns.map((reasoning) => {
            const supported =
              m.reasoning.includes(reasoning) || (!m.reasoning.length && !reasoning);
            return (
              <button
                key={reasoning}
                disabled={busy || !allowed || !supported}
                aria-label={`${label(m.label)} · ${label(reasoning) || '选择'}`}
                data-model={m.id}
                data-reasoning={reasoning}
                aria-pressed={
                  supported && s.current?.model === m.id && s.current.reasoning === reasoning
                }
                onClick={() => void apply({ model: m.id, reasoning, speed: 'standard' }, true)}
              >
                {supported ? '●' : '—'}
              </button>
            );
          })}
        </div>
      </div>
    ));
  const presetEditor = presetDraft && (
    <form
      key={presetDraft.id}
      className="model-preset-editor"
      aria-label={presetDraft.creating ? '保存模型预设' : '重命名模型预设'}
      onSubmit={async (event) => {
        event.preventDefault();
        const requestedName = presetDraft.name.trim();
        if (busy || !prefs.enabled || !requestedName) return;
        const name = uniquePresetName(
          requestedName,
          prefs.presets.filter((p) => p.id !== presetDraft.id),
        );
        const preset = { id: presetDraft.id, name, selection: presetDraft.selection };
        const result = await save({
          presets: uniquePresetNames(
            presetDraft.creating
              ? [...prefs.presets, preset]
              : prefs.presets.map((item) => (item.id === preset.id ? { ...item, name } : item)),
          ),
        });
        if (result !== null) setPresetDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          if (event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (!busy) setPresetDraft(null);
        }
      }}
    >
      <input
        aria-label="预设名称"
        placeholder="预设名称"
        autoFocus
        maxLength={256}
        value={presetDraft.name}
        disabled={busy || !prefs.enabled}
        onChange={(event) => setPresetDraft({ ...presetDraft, name: event.target.value })}
      />
      <button
        type="submit"
        aria-label="保存"
        disabled={busy || !prefs.enabled || !presetDraft.name.trim()}
      >
        {icon('check')}
      </button>
      <button type="button" aria-label="取消" disabled={busy} onClick={() => setPresetDraft(null)}>
        {icon('close')}
      </button>
    </form>
  );
  const allButton = (
    <button
      ref={pickerToggle}
      className="model-icon-button model-picker-toggle"
      data-model-picker
      aria-label="所有模型"
      aria-expanded={others}
      onClick={() => {
        if (!others) setBrowserHeight(main.current?.offsetHeight || 0);
        setPresetDraft(null);
        setOthers(!others);
      }}
    >
      {icon('catalog')}
    </button>
  );
  return (
    <section
      ref={root}
      className="feature-model"
      style={
        {
          '--name-width': `${nameWidth}px`,
          '--model-browser-height': `${browserHeight}px`,
          '--columns': Math.max(1, columns.length),
          '--reasoning-min-width': `${reasoningWidth}px`,
          '--reasoning-columns': widths.map((width) => `minmax(${width}px, 1fr)`).join(' '),
        } as CSSProperties
      }
    >
      <div className="model-main" ref={main} data-view={others ? 'all' : 'favorites'}>
        <div className="model-favorites" aria-hidden={others} inert={others}>
          <div
            className="model-scroll"
            ref={matrix}
            onScroll={(event) => {
              if (event.currentTarget.clientWidth)
                reading.modelLeft = event.currentTarget.scrollLeft;
            }}
          >
            <div className="model-matrix">
              <div className="model-intrinsic-width" data-intrinsic-width hidden />
              <ModelHeading
                actions={headerActions}
                matrix={matrix}
                headings={headings}
                nameWidth={nameWidth}
                widths={widths}
                hidden={others}
              >
                <button
                  type="button"
                  ref={fastButton}
                  className="model-icon-button model-fast"
                  aria-label="Fast"
                  aria-pressed={s.current?.speed === 'fast'}
                  data-phase={motion.phase}
                  data-filled={s.current?.speed === 'fast' && motion.phase === 'idle'}
                  style={{ left: nameWidth - 6 }}
                  disabled={
                    busy ||
                    motion.phase !== 'idle' ||
                    !allowed ||
                    !s.current ||
                    !s.models.find((m) => m.id === s.current?.model)?.fast
                  }
                  onClick={async () => {
                    if (!s.current) return;
                    if (s.current.speed !== 'fast') void motion.start();
                    else stopDischarge();
                    const result = await apply({
                      ...s.current,
                      speed: s.current.speed === 'fast' ? 'standard' : 'fast',
                    });
                    if (result === null) stopDischarge();
                  }}
                >
                  {icon('bolt')}
                  <span
                    ref={motion.fill}
                    className="model-fast-fill"
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{ __html: iconSvg('bolt-filled') }}
                  />
                </button>
                <div
                  className="model-choices"
                  style={{
                    gridTemplateColumns: widths.map((width) => `minmax(${width}px, 1fr)`).join(' '),
                  }}
                >
                  {columns.map((c) => (
                    <span key={c}>
                      <span data-reasoning-label>{label(c) || '选择'}</span>
                    </span>
                  ))}
                </div>
              </ModelHeading>
              <div className="model-primary">
                <button
                  type="button"
                  className="model-column-resize"
                  aria-label="调整模型名称宽度"
                  aria-description={`左右拖动或方向键调整，当前 ${nameWidth}px`}
                  data-column-min={100}
                  data-column-max={maxNameWidth}
                  data-column-width={nameWidth}
                  aria-disabled={busy}
                  tabIndex={busy ? -1 : 0}
                  data-resizing={!!resize.current}
                  data-dragging={dragging}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || busy || resize.current) return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.focus({ preventScroll: true });
                    stopDischarge();
                    setDragging(false);
                    resize.current = {
                      pointer: event.pointerId,
                      x: event.clientX,
                      y: event.clientY,
                      moved: false,
                      scale:
                        matrix.current!.getBoundingClientRect().width /
                          matrix.current!.offsetWidth || 1,
                      width: nameWidth,
                      value: nameWidth,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setColumnWidth(nameWidth);
                  }}
                  onPointerMove={(event) => {
                    const drag = resize.current;
                    if (!drag || drag.pointer !== event.pointerId) return;
                    const dx = event.clientX - drag.x;
                    const dy = event.clientY - drag.y;
                    if (!drag.moved && (Math.abs(dx) < 2 || Math.abs(dx) < Math.abs(dy))) return;
                    if (!drag.moved) setDragging(true);
                    drag.moved = true;
                    drag.value = clampWidth(drag.width + (event.clientX - drag.x) / drag.scale);
                    setColumnWidth(drag.value);
                  }}
                  onPointerUp={(event) => {
                    const drag = resize.current;
                    if (!drag || drag.pointer !== event.pointerId) return;
                    setDragging(false);
                    resize.current = null;
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    if (drag.value !== drag.width) void saveWidth(drag.value);
                    else setColumnWidth(null);
                  }}
                  onLostPointerCapture={() => {
                    if (!resize.current) return;
                    setDragging(false);
                    resize.current = null;
                    setColumnWidth(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && resize.current) {
                      event.stopPropagation();
                      setDragging(false);
                      event.currentTarget.releasePointerCapture(resize.current.pointer);
                      resize.current = null;
                      setColumnWidth(null);
                      return;
                    }
                    if (busy || resize.current || !['ArrowLeft', 'ArrowRight'].includes(event.key))
                      return;
                    event.preventDefault();
                    event.stopPropagation();
                    const width = clampWidth(nameWidth + (event.key === 'ArrowLeft' ? -16 : 16));
                    if (width === nameWidth) return;
                    setColumnWidth(width);
                    void saveWidth(width);
                  }}
                >
                  <span className="model-divider-line" />
                </button>
                <div className="model-discharge" ref={discharge} aria-hidden="true">
                  <svg viewBox="0 0 48 360" preserveAspectRatio="none">
                    <g ref={dischargePath}>
                      <path
                        className="model-discharge-glow"
                        d={dischargeShape}
                        vectorEffect="non-scaling-stroke"
                      />
                      <path
                        className="model-discharge-core"
                        d={dischargeShape}
                        vectorEffect="non-scaling-stroke"
                      />
                      <path
                        className="model-discharge-branches"
                        d="M20 122 L12 144 L15 158 M28 256 L35 270 L32 284"
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  </svg>
                </div>
                {!!models.length && !visible.length && (
                  <p className="model-empty-favorites">暂无模型</p>
                )}
                {rows(visible)}
                {!models.length && <p>暂无可用模型</p>}
              </div>
            </div>
          </div>
          <section
            className="model-collections"
            aria-label="收藏"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !event.nativeEvent.isComposing && tools) {
                event.stopPropagation();
                closeTools();
              }
            }}
          >
            <div className="model-presets" data-editing={tools}>
              {prefs.presets.map((p) => (
                <div className="model-preset-tag" key={p.id}>
                  {presetDraft?.id === p.id && !presetDraft.creating ? (
                    presetEditor
                  ) : (
                    <button
                      className="model-preset-choice"
                      disabled={busy}
                      aria-disabled={!tools && (!allowed || !valid(p.selection))}
                      aria-label={p.name}
                      aria-description={
                        tools ? '点击重命名' : p.selection.speed === 'fast' ? 'Fast' : undefined
                      }
                      aria-pressed={
                        !tools &&
                        s.current?.model === p.selection.model &&
                        s.current.reasoning === p.selection.reasoning &&
                        s.current.speed === p.selection.speed
                      }
                      onClick={() => {
                        if (tools) renamePreset(p);
                        else if (allowed && valid(p.selection)) void apply(p.selection);
                      }}
                    >
                      {p.selection.speed === 'fast' && icon('bolt')}
                      <span>{p.name}</span>
                    </button>
                  )}
                  {tools && (
                    <button
                      className="model-preset-delete"
                      aria-label={`删除预设 ${p.name}`}
                      disabled={busy}
                      onClick={async () => {
                        const result = await save({
                          presets: prefs.presets.filter((item) => item.id !== p.id),
                        });
                        if (result !== null && presetDraft?.id === p.id) setPresetDraft(null);
                      }}
                    >
                      {icon('close')}
                    </button>
                  )}
                </div>
              ))}
              {presetDraft?.creating && presetEditor}
              <div className="model-preset-actions">
                <button
                  className="model-icon-button model-preset-edit"
                  aria-label="编辑预设"
                  aria-pressed={tools}
                  disabled={busy || !prefs.presets.length}
                  onClick={() => {
                    setTools((reading.modelTools = !tools));
                    if (tools) setPresetDraft(null);
                  }}
                >
                  {icon('pencil')}
                </button>
                <button
                  className="model-icon-button model-preset-add"
                  aria-label="添加预设"
                  disabled={busy || !allowed || !s.current}
                  onClick={addPreset}
                >
                  {icon('plus')}
                </button>
                {allButton}
              </div>
            </div>
          </section>
        </div>
        {others && (
          <div className="model-picker" ref={picker} role="region" aria-label="所有模型">
            <div className="model-picker-actions">
              <button
                data-refresh="model"
                aria-label="刷新可用模型"
                disabled={busy || !prefs.enabled}
                onClick={() => void action({}, 'refresh')}
              >
                {icon('refresh')}
              </button>
              <button
                aria-label="关闭所有模型"
                onClick={() => {
                  restorePickerFocus.current = true;
                  setOthers(false);
                }}
              >
                {icon('close')}
              </button>
            </div>
            <div className="model-other-list">
              {groups.map((group) => (
                <section
                  className="model-group"
                  data-model-group={group.id}
                  key={group.id}
                  aria-label={group.name}
                >
                  <h3>{group.name}</h3>
                  <div className="model-tiles">
                    {group.models.map((m) => (
                      <button
                        className="model-tile"
                        key={m.id}
                        data-model-tile={m.id}
                        aria-label={m.label}
                        aria-pressed={prefs.pinned.includes(m.id)}
                        disabled={busy || !prefs.enabled}
                        onClick={async (event) => {
                          const button = event.currentTarget;
                          await save({
                            pinned: prefs.pinned.includes(m.id)
                              ? prefs.pinned.filter((id) => id !== m.id)
                              : [...prefs.pinned, m.id],
                          });
                          if (button.isConnected) button.focus({ preventScroll: true });
                        }}
                      >
                        <span>{m.label}</span>
                        {models.some((other) => other.id !== m.id && other.label === m.label) && (
                          <small className="model-route">{m.id}</small>
                        )}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              {!models.length && <p>暂无可用模型</p>}
            </div>
          </div>
        )}
      </div>
      {(!prefs.enabled || s.message) && (
        <footer className="model-footer">
          <span role="status">
            {!prefs.enabled ? '模型快切已停用，请在设置页开启。' : s.message}
          </span>
        </footer>
      )}
    </section>
  );
}
