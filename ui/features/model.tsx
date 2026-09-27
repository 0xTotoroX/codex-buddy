/* [INPUT]: Existing model control envelope and serialized actions.
 * [OUTPUT]: Capability-driven model/reasoning/speed controls and shared presets.
 * [POS]: Reusable model view; never claims a selection before server readback.
 * [PROTOCOL]: Keep features/AGENTS.md in sync. */
import { useState } from 'react';
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
    pinned: string[];
    presets: { id: string; name: string; selection: Selection }[];
  };
};
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
  const [search, setSearch] = useState(reading.modelSearch || '');
  const s = state.snapshot,
    prefs = state.preferences;
  const allowed = !!s.target && ['ready', 'waiting'].includes(s.status) && prefs.enabled;
  const apply = (selection: Selection, preserveSpeed = false) =>
    action({ target: s.target, expectedRevision: s.revision, selection, preserveSpeed }, 'apply');
  const valid = (selection: Selection) =>
    s.models.some(
      (m) =>
        m.id === selection.model &&
        (m.reasoning.includes(selection.reasoning) ||
          (!m.reasoning.length && !selection.reasoning)) &&
        (selection.speed !== 'fast' || m.fast),
    );
  const savePresets = (presets: ModelState['preferences']['presets']) =>
    action({ revision: state.revision, patch: { presets } }, 'preferences');
  const models = [...s.models]
    .sort((a, b) => Number(prefs.pinned.includes(b.id)) - Number(prefs.pinned.includes(a.id)))
    .filter((m) => `${m.id} ${m.label}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <section className="feature-model">
      <p role="status">
        {s.message ||
          (s.current
            ? `${s.current.model} · ${s.current.reasoning} · ${s.current.speed}`
            : '等待识别当前模型')}
      </p>
      {!prefs.enabled && <p>模型快切已停用，请在设置页开启。</p>}
      <div className="feature-actions">
        <button disabled={busy || !prefs.enabled} onClick={() => void action({}, 'refresh')}>
          刷新
        </button>
        {prefs.presets.map((p) => (
          <span className="model-preset" key={p.id}>
            <button
              disabled={busy || !allowed || !valid(p.selection)}
              onClick={() => void apply(p.selection)}
            >
              {p.name}
            </button>
            <button
              aria-label={`重命名预设 ${p.name}`}
              disabled={busy || !prefs.enabled}
              onClick={() => {
                const name = prompt('预设名称', p.name);
                if (name?.trim())
                  void savePresets(
                    prefs.presets.map((item) =>
                      item.id === p.id ? { ...item, name: name.trim() } : item,
                    ),
                  );
              }}
            >
              改名
            </button>
            <button
              aria-label={`删除预设 ${p.name}`}
              disabled={busy || !prefs.enabled}
              onClick={() => void savePresets(prefs.presets.filter((item) => item.id !== p.id))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        type="search"
        placeholder="搜索模型…"
        aria-label="搜索模型"
        value={search}
        onChange={(e) => {
          reading.modelSearch = e.target.value;
          setSearch(e.target.value);
        }}
      />
      {models.map((m) => (
        <section className="model-row" key={m.id}>
          <div>
            <strong>{m.label}</strong>
            <button
              aria-label={`置顶 ${m.label}`}
              aria-pressed={prefs.pinned.includes(m.id)}
              disabled={busy || !prefs.enabled}
              onClick={() =>
                void action(
                  {
                    revision: state.revision,
                    patch: {
                      pinned: prefs.pinned.includes(m.id)
                        ? prefs.pinned.filter((id) => id !== m.id)
                        : [...prefs.pinned, m.id],
                    },
                  },
                  'preferences',
                )
              }
            >
              置顶
            </button>
          </div>
          <div className="feature-actions">
            {(m.reasoning.length ? m.reasoning : ['']).map((reasoning) => (
              <button
                key={reasoning}
                disabled={busy || !allowed}
                aria-pressed={s.current?.model === m.id && s.current.reasoning === reasoning}
                onClick={() => void apply({ model: m.id, reasoning, speed: 'standard' }, true)}
              >
                {reasoning || '选择'}
              </button>
            ))}
          </div>
        </section>
      ))}
      {s.current && (
        <div className="feature-actions">
          <button
            disabled={busy || !allowed}
            aria-pressed={s.current.speed === 'standard'}
            onClick={() => void apply({ ...s.current!, speed: 'standard' })}
          >
            标准
          </button>
          <button
            disabled={busy || !allowed || !s.models.find((m) => m.id === s.current?.model)?.fast}
            aria-pressed={s.current.speed === 'fast'}
            onClick={() => void apply({ ...s.current!, speed: 'fast' })}
          >
            Fast
          </button>
          <button
            disabled={busy || !allowed}
            onClick={() => {
              const name = prompt('预设名称');
              if (name?.trim())
                void action(
                  {
                    revision: state.revision,
                    patch: {
                      presets: [
                        ...prefs.presets,
                        { id: crypto.randomUUID(), name: name.trim(), selection: s.current },
                      ],
                    },
                  },
                  'preferences',
                );
            }}
          >
            保存预设
          </button>
        </div>
      )}
    </section>
  );
}
