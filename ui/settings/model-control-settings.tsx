/* [INPUT]: Model feature state and enable/disable commands. [OUTPUT]: Independent model feature switch.
 * [POS]: Business enablement only; all placement and themes belong to shared settings.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useState } from 'react';
import { request } from './api';
import { Button } from './components/ui/button';
export function ModelControlSettings({ live }: { live: boolean }) {
  const [enabled, setEnabled] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    if (!live) return;
    let disposed = false;
    void request<{ preferences: { enabled: boolean } }>('model-control/state')
      .then((value) => {
        if (!disposed) setEnabled(value.preferences.enabled);
      })
      .catch((error) => {
        if (!disposed) setMessage(String(error));
      });
    return () => {
      disposed = true;
    };
  }, [live]);
  async function change(open: boolean) {
    setBusy(true);
    try {
      await request(`model-control/${open ? 'open' : 'close'}`, {});
      setEnabled(open);
      setMessage(open ? '模型快切已打开' : '模型快切已停用');
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      id="settings-model-control"
      tabIndex={-1}
      aria-label="模型快切设置"
      className="mb-5 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium">模型快切</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            切换当前聊天的模型、推理强度和速度，支持置顶与预设。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!live || busy} onClick={() => void change(true)}>
            {enabled ? '打开模型快切' : '开启模型快切'}
          </Button>
          {enabled && (
            <Button variant="ghost" disabled={!live || busy} onClick={() => void change(false)}>
              停用
            </Button>
          )}
        </div>
      </div>
      {message && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {message}
        </p>
      )}
    </section>
  );
}
