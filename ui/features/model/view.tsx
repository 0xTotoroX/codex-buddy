/* [INPUT]: Existing model control envelope, serialized actions and optional surface header slot.
 * [OUTPUT]: Favorites matrix, complete grouped picker, wrapping presets and capability-driven selection.
 * [POS]: Reusable business view; surfaces own placement and theme.
 * [PROTOCOL]: Keep AGENTS.md in this module in sync. */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { iconSvg } from '../../shared/icons/index.js';
import type { Reading } from '../../shared/features';
import { groupedModels, orderedModelIds, type ModelState, type Selection } from './catalog';
export type { ModelState } from './catalog';
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
    [drop, setDrop] = useState(''),
    [columnWidth, setColumnWidth] = useState<number | null>(null),
    [metrics, setMetrics] = useState({ available: 0, widths: [] as number[] }),
    [presetDraft, setPresetDraft] = useState<{
      id: string;
      name: string;
      selection: Selection;
      creating: boolean;
    } | null>(null);
  const matrix = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const pickerToggle = useRef<HTMLButtonElement>(null);
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
      setOthers(false);
      pickerToggle.current?.focus({ preventScroll: true });
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
    ...new Set(models.flatMap((m) => (m.reasoning.length ? m.reasoning : ['']))),
  ].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  // 按实际表头文字保留思考列的可读宽度，不用最长标题把每一列都撑宽。
  useLayoutEffect(() => {
    const node = matrix.current;
    if (!node) return;
    const labels = [...node.querySelectorAll<HTMLElement>('[data-reasoning-label]')];
    const measure = () => {
      if (!node.clientWidth) return;
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
  }, [columns.join('|')]);
  const widths = columns.length ? columns.map((_, i) => metrics.widths[i] || 63) : [28];
  const reasoningWidth = widths.reduce((sum, width) => sum + width, 0) + (widths.length - 1) * 4;
  const maxNameWidth = metrics.available
    ? Math.max(100, Math.min(560, Math.floor(metrics.available - 8 - reasoningWidth)))
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
  const allButton = (
    <button
      ref={pickerToggle}
      className="model-picker-toggle"
      data-model-picker
      aria-label="所有"
      aria-expanded={others}
      aria-haspopup="dialog"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        border: 0,
        background: 'transparent',
      }}
      onClick={() => {
        setPresetDraft(null);
        setOthers(!others);
      }}
    >
      所有{icon('chevron-down')}
    </button>
  );
  return (
    <section
      ref={root}
      className="feature-model"
      data-header-actions={!!headerActions}
      style={
        {
          '--name-width': `${nameWidth}px`,
          '--columns': Math.max(1, columns.length),
          '--reasoning-min-width': `${reasoningWidth}px`,
          '--reasoning-columns': widths.map((width) => `minmax(${width}px, 1fr)`).join(' '),
        } as CSSProperties
      }
    >
      {headerActions ? (
        createPortal(allButton, headerActions)
      ) : (
        <header className="model-toolbar">{allButton}</header>
      )}
      <div
        className="model-scroll"
        ref={matrix}
        onScroll={(event) => {
          if (event.currentTarget.clientWidth) reading.modelLeft = event.currentTarget.scrollLeft;
        }}
      >
        <div className="model-matrix">
          <div className="model-intrinsic-width" data-intrinsic-width hidden />
          <div className="model-primary">
            <button
              type="button"
              className="model-column-resize"
              role="separator"
              aria-label="模型名称列宽"
              aria-orientation="vertical"
              aria-valuemin={100}
              aria-valuemax={maxNameWidth}
              aria-valuenow={nameWidth}
              aria-disabled={busy}
              tabIndex={busy ? -1 : 0}
              data-resizing={!!resize.current}
              onPointerDown={(event) => {
                if (event.button !== 0 || busy) return;
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.focus({ preventScroll: true });
                resize.current = {
                  pointer: event.pointerId,
                  x: event.clientX,
                  scale:
                    matrix.current!.getBoundingClientRect().width / matrix.current!.offsetWidth ||
                    1,
                  width: nameWidth,
                  value: nameWidth,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
                setColumnWidth(nameWidth);
              }}
              onPointerMove={(event) => {
                const drag = resize.current;
                if (!drag || drag.pointer !== event.pointerId) return;
                drag.value = clampWidth(drag.width + (event.clientX - drag.x) / drag.scale);
                setColumnWidth(drag.value);
              }}
              onPointerUp={(event) => {
                const drag = resize.current;
                if (!drag || drag.pointer !== event.pointerId) return;
                resize.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
                if (drag.value !== drag.width) void saveWidth(drag.value);
                else setColumnWidth(null);
              }}
              onLostPointerCapture={() => {
                if (!resize.current) return;
                resize.current = null;
                setColumnWidth(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && resize.current) {
                  event.stopPropagation();
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
              {icon('grip')}
            </button>
            <div className="model-matrix-head">
              <span className="model-fixed-tools">
                <button
                  className="model-fast"
                  aria-label="Fast"
                  aria-pressed={s.current?.speed === 'fast'}
                  disabled={
                    busy ||
                    !allowed ||
                    !s.current ||
                    !s.models.find((m) => m.id === s.current?.model)?.fast
                  }
                  onClick={() =>
                    s.current &&
                    void apply({
                      ...s.current,
                      speed: s.current.speed === 'fast' ? 'standard' : 'fast',
                    })
                  }
                >
                  {icon('bolt')}
                </button>
              </span>
              <div>
                {columns.map((c) => (
                  <span key={c}>
                    <span data-reasoning-label>{label(c) || '选择'}</span>
                  </span>
                ))}
              </div>
            </div>
            {!!models.length && !visible.length && (
              <p className="model-empty-favorites">暂无模型</p>
            )}
            {rows(visible)}
            {!models.length && <p>暂无可用模型</p>}
          </div>
        </div>
      </div>
      <section className="model-collections" aria-label="收藏">
        <div className="model-collections-heading">
          <span>收藏</span>
          {!!prefs.presets.length && (
            <button
              aria-label="模型工具"
              aria-expanded={tools}
              onClick={() => setTools((reading.modelTools = !tools))}
            >
              {icon('more')}
            </button>
          )}
        </div>
        <div className="model-presets">
          {prefs.presets.map((p) => (
            <button
              key={p.id}
              disabled={busy || !allowed || !valid(p.selection)}
              aria-pressed={
                s.current?.model === p.selection.model &&
                s.current.reasoning === p.selection.reasoning &&
                s.current.speed === p.selection.speed
              }
              onClick={() => void apply(p.selection)}
            >
              {p.name}
            </button>
          ))}
          <button
            className="model-add-preset"
            aria-label="保存预设"
            disabled={busy || !allowed || !s.current}
            onClick={() => {
              if (s.current) {
                setOthers(false);
                setPresetDraft({
                  id: crypto.randomUUID(),
                  name: '',
                  selection: { ...s.current },
                  creating: true,
                });
              }
            }}
          >
            {icon('plus')}
          </button>
        </div>
        {presetDraft && (
          <form
            key={presetDraft.id}
            className="model-preset-editor"
            aria-label={presetDraft.creating ? '保存模型预设' : '重命名模型预设'}
            onSubmit={async (event) => {
              event.preventDefault();
              const name = presetDraft.name.trim();
              if (busy || !prefs.enabled || !name) return;
              const preset = { id: presetDraft.id, name, selection: presetDraft.selection };
              const result = await save({
                presets: presetDraft.creating
                  ? [...prefs.presets, preset]
                  : prefs.presets.map((item) => (item.id === preset.id ? { ...item, name } : item)),
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
            <button type="submit" disabled={busy || !prefs.enabled || !presetDraft.name.trim()}>
              保存
            </button>
            <button type="button" disabled={busy} onClick={() => setPresetDraft(null)}>
              取消
            </button>
          </form>
        )}
        {tools && !!prefs.presets.length && (
          <div className="model-tools">
            {prefs.presets.map((p) => (
              <div className="model-preset" key={p.id}>
                <span>{p.name}</span>
                <button
                  aria-label={`重命名预设 ${p.name}`}
                  disabled={busy}
                  onClick={() =>
                    setPresetDraft({ ...p, selection: { ...p.selection }, creating: false })
                  }
                >
                  改名
                </button>
                <button
                  aria-label={`删除预设 ${p.name}`}
                  disabled={busy}
                  onClick={() =>
                    void save({ presets: prefs.presets.filter((item) => item.id !== p.id) })
                  }
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      {others && (
        <div className="model-picker" ref={picker} role="dialog" aria-label="所有模型">
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
                setOthers(false);
                pickerToggle.current?.focus({ preventScroll: true });
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
