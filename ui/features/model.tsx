/* [INPUT]: Existing model control envelope and serialized actions.
 * [OUTPUT]: Original compact model matrix, presets and capability-driven selection.
 * [POS]: Reusable business view; surfaces own placement and theme.
 * [PROTOCOL]: Keep features/AGENTS.md in sync. */
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { iconSvg } from '../panel/icons/index.js';
import type { Reading } from './types';
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
  const [search, setSearch] = useState(reading.modelSearch || ''),
    [tools, setTools] = useState(reading.modelTools || false),
    [others, setOthers] = useState(reading.modelOthers || false),
    [menu, setMenu] = useState('');
  const matrix = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (matrix.current) matrix.current.scrollLeft = reading.modelLeft || 0;
  }, []);
  const s = state.snapshot,
    prefs = state.preferences;
  const allowed = !!s.target && ['ready', 'waiting'].includes(s.status) && prefs.enabled;
  const apply = (selection: Selection, preserveSpeed = false) =>
    action({ target: s.target, expectedRevision: s.revision, selection, preserveSpeed }, 'apply');
  const save = (patch: object) => action({ revision: state.revision, patch }, 'preferences');
  const valid = (selection: Selection) =>
    s.models.some(
      (m) =>
        m.id === selection.model &&
        (m.reasoning.includes(selection.reasoning) ||
          (!m.reasoning.length && !selection.reasoning)) &&
        (selection.speed !== 'fast' || m.fast),
    );
  const models = s.models.filter((m) =>
    `${m.id} ${m.label}`.toLowerCase().includes(search.toLowerCase()),
  );
  const pinned = prefs.pinned.map((id) => models.find((m) => m.id === id)).filter((m) => !!m);
  const current = models.find((m) => m.id === s.current?.model && !prefs.pinned.includes(m.id));
  const visible = pinned.length ? [...pinned, ...(current ? [current] : [])] : models;
  const remaining = models.filter((m) => !visible.includes(m));
  const order = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  const columns = [
    ...new Set(models.flatMap((m) => (m.reasoning.length ? m.reasoning : ['']))),
  ].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const rows = (items: typeof models) =>
    items.map((m) => (
      <div className="model-row" key={m.id}>
        <div className="model-name">
          <strong title={label(m.label)}>{label(m.label)}</strong>
          <button
            aria-label={`模型 ${label(m.label)} 菜单`}
            onClick={() => setMenu(menu === m.id ? '' : m.id)}
          >
            {icon('more')}
          </button>
          {menu === m.id && (
            <div className="model-menu">
              <button
                disabled={busy || !prefs.enabled}
                aria-label={`置顶 ${m.label}`}
                aria-pressed={prefs.pinned.includes(m.id)}
                onClick={() =>
                  void save({
                    pinned: prefs.pinned.includes(m.id)
                      ? prefs.pinned.filter((id) => id !== m.id)
                      : [...prefs.pinned, m.id],
                  })
                }
              >
                {prefs.pinned.includes(m.id) ? '取消常用' : '设为常用'}
              </button>
            </div>
          )}
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
          '--name-width': `${prefs.modelColumnWidth || 140}px`,
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
        <button
          aria-label="模型工具"
          title="模型工具"
          aria-expanded={tools}
          onClick={() => setTools((reading.modelTools = !tools))}
        >
          {icon('more')}
        </button>
      </header>
      {tools && (
        <div className="model-tools">
          <input
            type="search"
            aria-label="搜索模型"
            placeholder="搜索模型…"
            value={search}
            onChange={(e) => {
              reading.modelSearch = e.target.value;
              setSearch(e.target.value);
            }}
          />
          <label>
            模型名称列宽
            <input
              type="range"
              aria-label="模型名称列宽"
              min="100"
              max="280"
              defaultValue={prefs.modelColumnWidth || 140}
              onPointerUp={(e) => void save({ modelColumnWidth: Number(e.currentTarget.value) })}
              onKeyUp={(e) => void save({ modelColumnWidth: Number(e.currentTarget.value) })}
            />
          </label>
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
            aria-expanded={others || !!search}
            onClick={() => setOthers((reading.modelOthers = !others))}
          >
            其他模型 ({remaining.length})
          </button>
        )}
        {(others || search) && rows(remaining)}
        {!models.length && <p>没有匹配的模型</p>}
      </div>
      <footer className="model-footer">
        <span role="status">
          {!prefs.enabled
            ? '模型快切已停用，请在设置页开启。'
            : s.message ||
              (s.current
                ? `${label(s.current.model)} · ${label(s.current.reasoning)} · ${s.current.speed === 'fast' ? 'Fast' : 'Standard'}`
                : '等待识别当前模型')}
        </span>
        <button
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
