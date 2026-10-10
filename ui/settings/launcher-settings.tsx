/* [INPUT]: Existing appearance preferences and revision-checked settings API.
 * [OUTPUT]: Persisted default click action for the eyes launcher.
 * [POS]: Shared web/plugin settings control; no navigation on preference change.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useState } from 'react';
import { request } from './api';
import { Field, Feedback } from './settings-controls';
import { NativeSelect } from './components/ui/native-select';
import type { AppearanceSettings } from '../shared/contracts';
export function LauncherSettings({
  value,
  outsideAvailable,
}: {
  value?: AppearanceSettings;
  outsideAvailable: boolean;
}) {
  const [prefs, setPrefs] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (value)
      setPrefs((current) => (!current || value.revision >= current.revision ? value : current));
  }, [value]);
  async function change(launcherAction: string) {
    if (!prefs || busy) return;
    setBusy(true);
    setError('');
    try {
      setPrefs(
        await request<AppearanceSettings>('appearance', {
          expectedRevision: prefs.revision,
          launcherAction,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
      try {
        setPrefs(await request<AppearanceSettings>('appearance'));
      } catch {}
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-section">
      <Field id="launcher-click-action" label="眼睛单击默认动作">
        <NativeSelect
          id="launcher-click-action"
          disabled={!prefs || busy}
          value={prefs?.launcherAction ?? 'inside'}
          onChange={(e) => void change(e.target.value)}
        >
          <option value="inside">内 · 聊天内工作台</option>
          <option value="outside" disabled={!outsideAvailable}>
            外 · 桌面浮窗
          </option>
          <option value="settings">设置</option>
        </NativeSelect>
      </Field>
      <Feedback text={error} failed />
    </div>
  );
}
