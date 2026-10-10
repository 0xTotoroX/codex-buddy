/* [INPUT]: Existing appearance preferences and revision-checked settings API.
 * [OUTPUT]: Persisted destination for the workbench settings button.
 * [POS]: Shared web/plugin settings control; no navigation on preference change.
 * [PROTOCOL]: Keep settings/AGENTS.md in sync. */
import { useEffect, useState } from 'react';
import { request } from './api';
import { Field, Feedback } from './settings-controls';
import { NativeSelect } from './components/ui/native-select';
import type { AppearanceSettings } from '../shared/contracts';
export function SettingsEntry({ value }: { value?: AppearanceSettings }) {
  const [prefs, setPrefs] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (value)
      setPrefs((current) => (!current || value.revision >= current.revision ? value : current));
  }, [value]);
  async function change(settingsTarget: string) {
    if (!prefs || busy) return;
    setBusy(true);
    setError('');
    try {
      setPrefs(
        await request<AppearanceSettings>('appearance', {
          expectedRevision: prefs.revision,
          settingsTarget,
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
      <Field id="settings-open-target" label="设置按钮打开方式">
        <NativeSelect
          id="settings-open-target"
          disabled={!prefs || busy}
          value={prefs?.settingsTarget ?? 'plugin'}
          onChange={(e) => void change(e.target.value)}
        >
          <option value="plugin">插件侧栏</option>
          <option value="web">网页</option>
        </NativeSelect>
      </Field>
      <Feedback text={error} failed />
    </div>
  );
}
