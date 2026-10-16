/* [INPUT]: Model state and revision-checked API. [OUTPUT]: Feature switch, serialized organization settings and read-only preview snapshot.
 * [POS]: Business enablement only; all placement and themes belong to shared settings.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useRef, useState } from 'react';
import { FeatureSwitch, Feedback } from './settings-controls';
import { request } from './api';
import { ModelOrganization } from './model-organization';
import type { ModelState, ModelPreferences } from '../features/model/catalog';
export function ModelControlSettings({
  live,
  detailed = true,
  onSnapshot,
}: {
  live: boolean;
  detailed?: boolean;
  onSnapshot?: (state: ModelState | null) => void;
}) {
  const [state, setState] = useState<ModelState | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const writing = useRef(false);
  const generation = useRef(0);
  useEffect(() => onSnapshot?.(state), [state, onSnapshot]);
  useEffect(() => {
    if (!live) return;
    let disposed = false;
    const load = async () => {
      if (writing.current) return;
      const version = ++generation.current;
      try {
        const value = await request<ModelState>('model-control/state');
        if (!disposed && version === generation.current) {
          setEnabled(value.preferences.enabled);
          setState(value);
        }
      } catch (error) {
        if (!disposed && version === generation.current) setMessage(String(error));
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
      const value = await request<ModelState>('model-control/state');
      setState(value);
      setEnabled(value.preferences.enabled);
    } catch (error) {
      setMessage(String(error));
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  async function operate(patch?: Partial<ModelPreferences>) {
    if (writing.current || !state) return false;
    writing.current = true;
    generation.current++;
    setBusy(true);
    setMessage('');
    try {
      const value = await request<ModelState>(
        patch ? 'model-control/preferences' : 'model-control/refresh',
        patch ? { revision: state.revision, patch } : {},
      );
      setState(value);
      setEnabled(value.preferences.enabled);
      return true;
    } catch (error) {
      setMessage(
        String(error).includes('model_control_conflict')
          ? '模型设置已在其他窗口更新，已重新读取。请检查后再保存。'
          : String(error),
      );
      try {
        const value = await request<ModelState>('model-control/state');
        setState(value);
        setEnabled(value.preferences.enabled);
      } catch {
        /* 保留旧状态和失败草稿。 */
      }
      return false;
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
      />
      <Feedback text={message} />
      <div hidden={!detailed}>
        {state?.snapshot?.models && (
          <ModelOrganization
            state={state}
            busy={busy || !live}
            save={(patch) => operate(patch)}
            refresh={async () => {
              await operate();
            }}
          />
        )}
      </div>
    </section>
  );
}
