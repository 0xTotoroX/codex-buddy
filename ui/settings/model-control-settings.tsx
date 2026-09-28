/* [INPUT]: Model feature state and enable/disable commands. [OUTPUT]: Independent model feature switch.
 * [POS]: Business enablement only; all placement and themes belong to shared settings.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useRef, useState } from 'react';
import { FeatureSwitch, Feedback } from './settings-controls';
import { request } from './api';
export function ModelControlSettings({ live }: { live: boolean }) {
  const [enabled, setEnabled] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const writing = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    if (!live) return;
    let disposed = false;
    const load = async () => {
      if (writing.current) return;
      const version = ++generation.current;
      try {
        const value = await request<{ preferences: { enabled: boolean } }>('model-control/state');
        if (!disposed && version === generation.current) setEnabled(value.preferences.enabled);
      } catch (error) {
        if (!disposed) setMessage(String(error));
      }
    };
    void load();
    window.addEventListener('focus', load);
    const timer = setInterval(() => void load(), 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [live]);
  async function change(open: boolean) {
    if (writing.current) return;
    writing.current = true;
    generation.current++;
    setBusy(true);
    setMessage('');
    try {
      await request(`model-control/${open ? 'open' : 'close'}`, {});
      setEnabled(open);
    } catch (error) {
      setMessage(String(error));
    } finally {
      writing.current = false;
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
