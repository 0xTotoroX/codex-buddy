/* [INPUT]: Model feature state and enable/disable commands. [OUTPUT]: Independent model feature switch.
 * [POS]: Business enablement only; all placement and themes belong to shared settings.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useState } from 'react';
import { FeatureSwitch, Feedback } from './settings-controls';
import { request } from './api';
export function ModelControlSettings({ live }: { live: boolean }) {
  const [enabled, setEnabled] = useState<boolean | null>(null),
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
      className="settings-section"
    >
      <FeatureSwitch
        name="模型快切"
        checked={enabled ?? false}
        disabled={!live || busy || enabled === null}
        onChange={(value) => void change(value)}
        onOpen={() => void change(true)}
      />
      <Feedback text={message} />
    </section>
  );
}
