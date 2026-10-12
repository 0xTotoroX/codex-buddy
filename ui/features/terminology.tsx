/* [INPUT]: 术语状态、当前聊天涉及编号、窗口阅读状态与受限操作。
 * [OUTPUT]: 术语积木、详情、收藏及已掌握；复用既有容器，不增加侧栏占位。
 * [POS]: 仅消费后台投影，不采集或改写宿主聊天。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useState } from 'react';
import type { Reading } from '../shared/features';
import { Icon } from '../shared/icons/react';
export type Term = {
  id: string;
  name: string;
  english: string;
  definition: string;
  category: string[];
};
export type TermData = {
  entries: Term[];
  preferences: { favorites: string[]; mastered: string[] };
  involved: string[];
  context: string;
  phase: string;
  message: string;
};
export function TerminologyView({
  state,
  reading,
  locked,
  action,
}: {
  state: TermData;
  reading: Reading;
  locked: boolean;
  action: (value: Record<string, unknown>) => Promise<unknown>;
}) {
  const [filter, setFilter] = useState(reading.termsFilter || 'current');
  const [selected, setSelected] = useState(reading.termsSelected || '');
  const favorites = state.preferences.favorites || [],
    mastered = state.preferences.mastered || [];
  const ids =
    filter === 'current' ? state.involved || [] : filter === 'favorites' ? favorites : mastered;
  const terms = state.entries.filter((t) => ids.includes(t.id));
  const term = terms.find((t) => t.id === selected);
  return (
    <div className="term-module">
      <style>{`.term-module{padding:12px 14px;min-width:0;color:var(--ink);font-size:14px;line-height:1.7}.term-module nav{display:flex;gap:18px;margin-bottom:16px;flex-wrap:wrap}.term-module nav button{border:0;background:none;color:var(--muted);padding:4px 0;font:inherit;cursor:pointer}.term-module nav button[aria-pressed=true]{color:var(--ink);font-weight:600}.term-bricks{display:flex;flex-wrap:wrap;gap:8px;align-content:flex-start}.term-brick{border:1px solid var(--line);border-radius:8px;padding:6px 10px;color:var(--ink);background:var(--surface);font:inherit;line-height:1.4;cursor:pointer;max-width:100%;overflow-wrap:anywhere;transition:background 120ms,transform 120ms}.term-brick:active{transform:scale(.97)}.term-brick[aria-pressed=true]{background:var(--hover);border-color:var(--muted)}.term-brick[data-mastered=true]{color:var(--muted)}.term-description{padding:20px 0 8px}.term-description header{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.term-description strong{font-size:17px}.term-description small{font-size:12px;color:var(--muted)}.term-description p{margin:12px 0}.term-module-actions{display:flex;justify-content:flex-end;gap:6px}.term-module-actions button{width:32px;height:32px;display:grid;place-items:center;border:0;border-radius:8px;background:transparent;color:var(--muted);cursor:pointer}.term-module-actions button{transition:transform 120ms,background 120ms}.term-module-actions button:active{transform:scale(.92)}.term-module-actions button[aria-pressed=true]{color:var(--ink);background:var(--hover)}.term-module .term-status{font-size:12px;color:var(--muted);margin:12px 0}.term-module button:focus-visible{outline:2px solid currentColor;outline-offset:3px}@media(prefers-reduced-motion:reduce){.term-brick,.term-module-actions button{transition:none}}`}</style>
      <nav aria-label="术语范围">
        {[
          ['current', '当前聊天'],
          ['favorites', '收藏'],
          ['mastered', '已掌握'],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-pressed={filter === id}
            onClick={() => {
              const f = id as typeof filter;
              setFilter(f);
              reading.termsFilter = f;
              setSelected('');
              reading.termsSelected = '';
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="term-bricks">
        {terms.map((t) => (
          <button
            className="term-brick"
            type="button"
            key={t.id}
            aria-pressed={selected === t.id}
            data-mastered={mastered.includes(t.id)}
            onClick={() => {
              setSelected(t.id);
              reading.termsSelected = t.id;
            }}
          >
            {t.name}
          </button>
        ))}
      </div>
      {!terms.length && (
        <p className="term-status">
          {filter === 'current'
            ? state.context
              ? '当前聊天尚未识别到术语'
              : '等待识别当前聊天'
            : filter === 'favorites'
              ? '还没有收藏术语'
              : '还没有已掌握术语'}
        </p>
      )}
      {filter === 'current' && state.phase === 'analyzing' && (
        <p className="term-status" role="status">
          正在识别句段含义…
        </p>
      )}
      {filter === 'current' && state.phase === 'error' && (
        <p className="term-status" role="status">
          {state.message || '本次语义分析未完成，已保留本地匹配结果。'}
        </p>
      )}
      {term && (
        <article className="term-description">
          <header>
            <strong>{term.name}</strong>
            <small>{term.english}</small>
          </header>
          <p>{term.definition}</p>
          <div className="term-module-actions">
            <button
              type="button"
              disabled={locked}
              aria-pressed={favorites.includes(term.id)}
              aria-label={favorites.includes(term.id) ? '取消收藏' : '收藏术语'}
              title={favorites.includes(term.id) ? '取消收藏' : '收藏术语'}
              onClick={() =>
                void action({
                  action: favorites.includes(term.id) ? 'unfavorite' : 'favorite',
                  id: term.id,
                })
              }
            >
              <Icon name={favorites.includes(term.id) ? 'star-filled' : 'star'} />
            </button>
            <button
              type="button"
              disabled={locked}
              aria-pressed={mastered.includes(term.id)}
              aria-label={mastered.includes(term.id) ? '恢复提示' : '已掌握，不再提示'}
              title={mastered.includes(term.id) ? '恢复提示' : '已掌握，不再提示'}
              onClick={() =>
                void action({
                  action: mastered.includes(term.id) ? 'restore' : 'master',
                  id: term.id,
                })
              }
            >
              <Icon name={mastered.includes(term.id) ? 'eye' : 'eye-off'} />
            </button>
          </div>
        </article>
      )}
    </div>
  );
}
