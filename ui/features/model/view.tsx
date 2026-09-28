/* [INPUT]: Existing model control envelope and serialized actions.
 * [OUTPUT]: Compact model matrix, favorites, persisted drag order, presets and capability-driven selection.
 * [POS]: Reusable business view; surfaces own placement and theme.
 * [PROTOCOL]: Keep AGENTS.md in this module in sync. */
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { iconSvg } from '../../shared/icons/index.js';
import type { Reading } from '../../shared/features';
type Selection = { model: string; reasoning: string; speed: string };
export type ModelState = {
  revision: number;
  snapshot: {
    target: unknown;
    revision: string;
    status: string;
    message: string;
    current: Selection | null;
    models: { id: string; label: string; reasoning: string[]; fast: boolean }[];
  };
  preferences: {
    enabled: boolean;
    modelColumnWidth?: number;
    pinned: string[];
    modelOrder?: string[] | null;
    presets: { id: string; name: string; selection: Selection }[];
  };
};
const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const icon = (name: string) => <span dangerouslySetInnerHTML={{ __html: iconSvg(name) }} />;
export function ModelView({
  state,
  action,
  busy,
  reading,
}: {
  reading: Reading;
  state: ModelState;
  action: (data: unknown, action: string) => Promise<unknown>;
  busy: boolean;
}) {
  const [tools, setTools] = useState(reading.modelTools || false),
    [others, setOthers] = useState(reading.modelOthers || false),
    [drop, setDrop] = useState(''),
    [columnWidth, setColumnWidth] = useState<number | null>(null);
  const matrix = useRef<HTMLDivElement>(null);
  const resize = useRef<{ pointer: number; x: number; width: number; value: number } | null>(null);
  useLayoutEffect(() => {
    if (matrix.current) matrix.current.scrollLeft = reading.modelLeft || 0;
  }, []);
  const s = state.snapshot,
    prefs = state.preferences;
  const allowed = !!s.target && ['ready', 'waiting'].includes(s.status) && prefs.enabled;
  const apply = (selection: Selection, preserveSpeed = false) =>
    action({ target: s.target, expectedRevision: s.revision, selection, preserveSpeed }, 'apply');
  const save = (patch: object) => action({ revision: state.revision, patch }, 'preferences');
  const nameWidth = columnWidth ?? prefs.modelColumnWidth ?? 140;
  const clampWidth = (width: number) => Math.max(100, Math.min(280, Math.round(width)));
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
  const modelOrder = [
    ...new Set([...(prefs.modelOrder || prefs.pinned), ...s.models.map((m) => m.id)]),
  ];
  const models = modelOrder.flatMap((id) => {
    const model = s.models.find((m) => m.id === id);
    return model ? [model] : [];
  });
  const visible = models.filter((m) => prefs.pinned.includes(m.id));
  const remaining = models.filter((m) => !prefs.pinned.includes(m.id));
  const dragType = 'application/x-codex-buddy-model';
  const order = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  const columns = [
    ...new Set(models.flatMap((m) => (m.reasoning.length ? m.reasoning : ['']))),
  ].sort((a, b) => order.indexOf(a) - order.indexOf(b));
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
          if (
            id === m.id ||
            !models.some((model) => model.id === id) ||
            prefs.pinned.includes(id) !== prefs.pinned.includes(m.id)
          )
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
            title={`${label(m.label)} · 拖动排序`}
            draggable={!busy && prefs.enabled}
            onDragStart={(event) => {
              event.stopPropagation();
              event.dataTransfer.setData(dragType, m.id);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => setDrop('')}
          >
            {label(m.label)}
          </strong>
          <button
            className="model-visibility"
            data-pinned={prefs.pinned.includes(m.id)}
            disabled={busy || !prefs.enabled}
            aria-label={`${prefs.pinned.includes(m.id) ? '隐藏' : '设为常用'} ${label(m.label)}`}
            title={prefs.pinned.includes(m.id) ? '收进其他模型' : '移到常用模型'}
            onClick={() =>
              void save({
                pinned: prefs.pinned.includes(m.id)
                  ? prefs.pinned.filter((id) => id !== m.id)
                  : [...prefs.pinned, m.id],
              })
            }
          >
            {icon('chevron-down')}
          </button>
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
                title={
                  supported
                    ? `${label(m.label)} · ${label(reasoning) || '选择'}`
                    : '此模型不支持此推理强度'
                }
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
  return (
    <section
      className="feature-model"
      style={
        {
          '--name-width': `${nameWidth}px`,
          '--columns': Math.max(1, columns.length),
        } as CSSProperties
      }
    >
      <header className="model-toolbar">
        <button
          className="model-fast"
          aria-label="Fast"
          title="Fast"
          aria-pressed={s.current?.speed === 'fast'}
          disabled={
            busy || !allowed || !s.current || !s.models.find((m) => m.id === s.current?.model)?.fast
          }
          onClick={() =>
            s.current &&
            void apply({ ...s.current, speed: s.current.speed === 'fast' ? 'standard' : 'fast' })
          }
        >
          {icon('bolt')}
        </button>
        <div className="model-presets">
          {prefs.presets.map((p) => (
            <button
              key={p.id}
              disabled={busy || !allowed || !valid(p.selection)}
              onClick={() => void apply(p.selection)}
            >
              {p.name}
            </button>
          ))}
        </div>
        <button
          aria-label="保存预设"
          title="保存当前预设"
          disabled={busy || !allowed || !s.current}
          onClick={() => {
            const name = prompt('预设名称');
            if (name?.trim())
              void save({
                presets: [
                  ...prefs.presets,
                  { id: crypto.randomUUID(), name: name.trim(), selection: s.current },
                ],
              });
          }}
        >
          {icon('plus')}
        </button>
        {!!prefs.presets.length && (
          <button
            aria-label="模型工具"
            title="模型工具"
            aria-expanded={tools}
            onClick={() => setTools((reading.modelTools = !tools))}
          >
            {icon('more')}
          </button>
        )}
      </header>
      {tools && !!prefs.presets.length && (
        <div className="model-tools">
          {prefs.presets.map((p) => (
            <div className="model-preset" key={p.id}>
              <span>{p.name}</span>
              <button
                aria-label={`重命名预设 ${p.name}`}
                disabled={busy}
                onClick={() => {
                  const name = prompt('预设名称', p.name);
                  if (name?.trim())
                    void save({
                      presets: prefs.presets.map((item) =>
                        item.id === p.id ? { ...item, name: name.trim() } : item,
                      ),
                    });
                }}
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
      <div
        className="model-scroll"
        ref={matrix}
        onScroll={(event) => {
          if (event.currentTarget.clientWidth) reading.modelLeft = event.currentTarget.scrollLeft;
        }}
      >
        <div className="model-matrix">
          <div
            className="model-column-resize"
            role="separator"
            aria-label="模型名称列宽"
            aria-orientation="vertical"
            aria-valuemin={100}
            aria-valuemax={280}
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
                x: event.screenX,
                width: nameWidth,
                value: nameWidth,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              setColumnWidth(nameWidth);
            }}
            onPointerMove={(event) => {
              const drag = resize.current;
              if (!drag || drag.pointer !== event.pointerId) return;
              drag.value = clampWidth(drag.width + event.screenX - drag.x);
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
          />
          <div className="model-matrix-head">
            <span>模型</span>
            <div>
              {columns.map((c) => (
                <span key={c}>{label(c) || '选择'}</span>
              ))}
            </div>
          </div>
          {rows(visible)}
          {!!remaining.length && (
            <button
              className="model-disclosure"
              aria-expanded={others}
              onClick={() => setOthers((reading.modelOthers = !others))}
            >
              其他模型 ({remaining.length})
            </button>
          )}
          {others && rows(remaining)}
          {!models.length && <p>暂无可用模型</p>}
        </div>
      </div>
      <footer className="model-footer">
        {(!prefs.enabled || s.message) && (
          <span role="status">
            {!prefs.enabled ? '模型快切已停用，请在设置页开启。' : s.message}
          </span>
        )}
        <button
          data-refresh="model"
          aria-label="刷新可用模型"
          title="刷新可用模型"
          disabled={busy || !prefs.enabled}
          onClick={() => void action({}, 'refresh')}
        >
          {icon('refresh')}
        </button>
      </footer>
    </section>
  );
}
