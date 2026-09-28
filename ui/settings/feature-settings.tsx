/* [INPUT]: 四功能的归属、版本化布局与旧布局兼容读取。
 * [OUTPUT]: 唯一主界面形式、功能放置与四功能布局设置。
 * [POS]: 设置页编排；写入 features，不再写旧两功能 dockLayout/popoutLayout。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import { Field, Feedback } from './settings-controls';
import { NativeSelect } from './components/ui/native-select';
import { titles, type FeatureState } from '../shared/features';
import { resolveFeatureLayout } from '../surfaces/workspace/layout';
import { layoutGroups } from '../surfaces/workspace/layout-tree';
export function FeatureSettings({
  live,
  desktopSupported,
  onPlacement,
}: {
  live: boolean;
  desktopSupported: boolean;
  onPlacement: (placement: string) => void;
}) {
  const [state, setState] = useState<FeatureState>({ features: [] }),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [readError, setReadError] = useState('');
  const writing = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    if (!live) {
      setReady(false);
      return;
    }
    let disposed = false;
    const read = async () => {
      if (writing.current) return;
      const version = ++generation.current;
      try {
        const next = await request<FeatureState>('features', { op: 'state' });
        if (!disposed && version === generation.current) {
          setState(next);
          setReady(true);
          setReadError('');
        }
      } catch (e) {
        if (!disposed) setReadError((e as Error).message);
      }
    };
    void read();
    const timer = setInterval(() => void read(), 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [live]);
  const primary = state.mainPlacement || 'sidebar';
  useEffect(() => onPlacement(primary), [primary, onPlacement]);
  async function change(input: object) {
    if (writing.current) return;
    writing.current = true;
    generation.current++;
    setBusy(true);
    setError('');
    try {
      const next = await request<FeatureState>('features', input);
      setState((previous) => ({
        ...next,
        legacyLayouts: next.legacyLayouts ?? previous.legacyLayouts,
      }));
    } catch (e) {
      setError((e as Error).message);
      try {
        setState(await request<FeatureState>('features', { op: 'state' }));
      } catch {}
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  const labels = { sidebar: '侧栏', overlay: '页面浮层', desktop: '桌面窗口', edge: '贴边 / 刘海' };
  const moving =
    !live || !ready || busy || !!state.pendingPlacement || state.features.some((e) => !!e.pending);
  const ids = Object.keys(titles).filter(
    (id) =>
      state.features.find((e) => e.id === id)?.placement !== 'edge' &&
      (id !== 'model' || state.features.some((e) => e.id === id)),
  );
  const layout: NonNullable<FeatureState['layouts']>[string] = resolveFeatureLayout(
    state.layouts?.[primary],
    state.legacyLayouts?.[primary],
    ids,
  );
  const mode =
    layout.groups.length === 1
      ? 'tabs'
      : layout.groups.some((g) => 'groups' in g || g.ids.length > 1)
        ? 'custom'
        : layout.axis;
  function arrange(mode: string) {
    const ordered = [...new Set([...layoutGroups(layout).flatMap((g) => g.ids), ...ids])];
    if (!ordered.length) return;
    void change({
      op: 'main-layout',
      placement: primary,
      expectedLayout: state.layouts?.[primary] ?? null,
      layout: {
        axis: mode === 'tabs' ? 'auto' : mode,
        groups:
          mode === 'tabs'
            ? [
                {
                  ids: ordered,
                  active: ordered.includes(state.activeFeature || '')
                    ? state.activeFeature
                    : ordered[0],
                  weight: 1,
                },
              ]
            : ordered.map((id) => ({ ids: [id], active: id, weight: 1 })),
      },
    });
  }
  return (
    <section className="settings-section">
      <h2>主界面</h2>
      <div className="settings-choice" role="group" aria-label="主界面形式">
        {(['sidebar', 'overlay', 'desktop'] as const).map((p) => (
          <button
            type="button"
            key={p}
            aria-pressed={(state.pendingPlacement || primary) === p}
            disabled={moving || (p === 'desktop' && !desktopSupported)}
            onClick={() => void change({ op: 'main-placement', placement: p })}
          >
            {labels[p]}
          </button>
        ))}
      </div>
      <p className="settings-hint mb-5">主界面只保留一份，贴边窗口可以独立显示。</p>
      {Object.entries(titles).map(([id, title]) => (
        <Field key={id} id={`placement-${id}`} label={title}>
          <NativeSelect
            id={`placement-${id}`}
            aria-label={`${title}默认位置`}
            disabled={moving}
            value={
              state.features.find((e) => e.id === id)?.placement === 'edge' ||
              (!state.features.some((e) => e.id === id) && id === 'model')
                ? 'edge'
                : primary
            }
            onChange={(e) => void change({ op: 'move', id, placement: e.target.value })}
          >
            <option value={primary}>{labels[primary]}</option>
            <option value="edge" disabled={!desktopSupported}>
              贴边 / 刘海
            </option>
          </NativeSelect>
        </Field>
      ))}
      <Field id="main-layout" label="主界面布局">
        <NativeSelect
          id="main-layout"
          disabled={moving || !ids.length}
          value={mode}
          onChange={(e) => arrange(e.target.value)}
        >
          <option value="tabs">标签组</option>
          <option value="vertical">上下分栏</option>
          <option value="horizontal">左右分栏</option>
          <option value="auto">自动分栏</option>
          {mode === 'custom' && (
            <option value="custom" disabled>
              自定义分栏
            </option>
          )}
        </NativeSelect>
      </Field>
      <Feedback text={error || readError} failed />
    </section>
  );
}
