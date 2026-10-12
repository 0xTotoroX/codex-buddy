/* [INPUT]: 术语状态、当前聊天涉及编号、窗口阅读状态与受限操作。
 * [OUTPUT]: 术语积木、详情、收藏及已掌握；复用既有容器，不增加侧栏占位。
 * [POS]: 仅消费后台投影，不采集或改写宿主聊天。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useState, useRef, useLayoutEffect } from 'react';
import { createTermPopover } from '../terminology/popover.js';
import { resolveTypography } from '../shared/typography';
import { sessionTypography } from '../codex/typography.js';
import { inheritedAppearance } from '../terminology/appearance.js';
import type { Appearance } from '../surfaces/theme/appearance';
import type { Reading } from '../shared/features';
export type Term = {
  id: string;
  name: string;
  english: string;
  definition: string;
  category: string[];
};
export type TermData = {
  entries: Term[];
  preferences: {
    favorites: string[];
    mastered: string[];
    cardMaterial?: string | null;
    cardStyle?: string;
    cardLiquidVariant?: string;
    cardCustomColor?: string;
    cardWidth?: number;
  };
  appearance?: Appearance;
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
  const [reveal, setReveal] = useState(0);
  const favorites = state.preferences.favorites || [],
    mastered = state.preferences.mastered || [];
  const ids =
    filter === 'current' ? state.involved || [] : filter === 'favorites' ? favorites : mastered;
  const terms = state.entries.filter((t) => ids.includes(t.id));
  const term = terms.find((t) => t.id === selected);
  const module = useRef<HTMLDivElement>(null),
    anchor = useRef<HTMLButtonElement | null>(null);
  const popup = useRef<ReturnType<typeof createTermPopover> | null>(null);
  const lastOpened = useRef(-1);
  const latest = useRef({ action });
  latest.current = { action };
  useLayoutEffect(() => {
    popup.current = createTermPopover();
    return () => popup.current?.destroy();
  }, []);
  useLayoutEffect(() => {
    const view = popup.current;
    if (!view) return;
    if (!term || !anchor.current?.isConnected) {
      void view.hide();
      return;
    }
    const perform = async (action: string, id: string) => {
      const result = await latest.current.action({ action, id });
      if (result === null) throw Error('操作未完成，请重试');
    };
    const options = {
      preferences: state.preferences,
      appearance: {
        ...(state.appearance || inheritedAppearance(module.current!)),
        typography: state.appearance?.typographyPreferences
          ? resolveTypography(state.appearance.typography, state.appearance.typographyPreferences)
          : sessionTypography(module.current!),
      },
      locked,
      favorite: favorites.includes(term.id),
      mastered: mastered.includes(term.id),
      returnFocus: anchor.current,
      onFavorite: (id: string, value: boolean) => perform(value ? 'favorite' : 'unfavorite', id),
      onMaster: (id: string, value: boolean) => perform(value ? 'master' : 'restore', id),
    };
    if (view.termId === term.id && view.open) view.update(term, options);
    else if (lastOpened.current !== reveal) {
      lastOpened.current = reveal;
      view.show(
        term,
        () => (anchor.current?.isConnected ? anchor.current.getBoundingClientRect() : null),
        options,
      );
    }
  }, [term, state.preferences, state.appearance, state.context, locked, reveal]);

  return (
    <div className="term-module" ref={module}>
      <style>{`.term-module{padding:12px 14px;min-width:0;color:var(--ink);font-size:inherit;line-height:inherit}.term-module nav{display:flex;gap:18px;margin-bottom:16px;flex-wrap:wrap}.term-module nav button{border:0;background:none;color:var(--muted);padding:4px 0;font:inherit;cursor:pointer}.term-module nav button[aria-pressed=true]{color:var(--ink);font-weight:600}.term-bricks{display:flex;flex-wrap:wrap;gap:8px;align-content:flex-start}.term-brick{border:1px solid var(--line);border-radius:8px;padding:6px 10px;color:var(--ink);background:var(--surface);font:inherit;line-height:1.4;cursor:pointer;max-width:100%;overflow-wrap:anywhere;transition:background 120ms,transform 120ms}.term-brick:active{transform:scale(.97)}.term-brick[aria-pressed=true]{background:var(--hover);border-color:var(--muted)}.term-brick[data-mastered=true]{color:var(--muted)}.term-module .term-status{font-size:.85em;color:var(--muted);margin:12px 0}.term-module button:focus-visible{outline:2px solid currentColor;outline-offset:3px}@media(prefers-reduced-motion:reduce){.term-brick{transition:none}}`}</style>
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
            onClick={(event) => {
              anchor.current = event.currentTarget;
              setReveal((n) => n + 1);
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
          正在核对上下文词义…
        </p>
      )}
      {filter === 'current' && state.phase === 'error' && (
        <p className="term-status" role="status">
          {state.message || '本次词义核对未完成，仅保留已确认的结果。'}
        </p>
      )}
    </div>
  );
}
