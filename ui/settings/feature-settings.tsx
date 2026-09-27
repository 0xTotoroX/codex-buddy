/* [INPUT]: Authenticated feature placements. [OUTPUT]: Four-feature reveal and placement settings.
 * [POS]: Low-frequency presentation preferences; does not enable business services.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useState } from 'react';
import { request } from './api';
import { titles, type FeatureState } from '../features/types';
export function FeatureSettings({
  notify,
  desktopSupported,
}: {
  notify: (message: string, failed?: boolean) => void;
  desktopSupported: boolean;
}) {
  const [state, setState] = useState<FeatureState>({ features: [] }),
    [busy, setBusy] = useState(false);
  const read = () => request<FeatureState>('features', { op: 'state' }).then(setState);
  useEffect(() => {
    void read().catch(() => {});
    const timer = setInterval(() => void read().catch(() => {}), 2000);
    return () => clearInterval(timer);
  }, []);
  async function change(id: string, op: string, placement?: string) {
    setBusy(true);
    try {
      setState(await request<FeatureState>('features', { op, id, placement }));
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-6 space-y-3">
      <h3 className="text-sm font-medium">功能显示位置</h3>
      {Object.entries(titles).map(([id, title]) => {
        const item = state.features.find((e) => e.id === id);
        return (
          <div className="flex items-center gap-3" key={id}>
            <span className="flex-1 text-sm">{title}</span>
            <select
              className="rounded border bg-transparent px-2 py-1 text-sm"
              aria-label={`${title}默认位置`}
              disabled={busy || !!item?.pending}
              value={
                item?.placement ||
                (id === 'model' ? 'edge' : id === 'board' ? 'desktop' : 'sidebar')
              }
              onChange={(e) => void change(id, 'move', e.target.value)}
            >
              <option value="sidebar">侧栏</option>
              <option value="overlay">页面浮层</option>
              <option value="desktop" disabled={!desktopSupported}>
                桌面窗口
              </option>
              {id === 'model' && <option value="edge">贴边控制条</option>}
            </select>
            <button
              className="rounded border px-3 py-1 text-sm"
              disabled={busy || !!item?.pending}
              onClick={() => void change(id, 'reveal')}
            >
              {item?.pending ? '正在移动…' : item?.open ? '唤起' : '打开'}
            </button>
          </div>
        );
      })}
    </section>
  );
}
