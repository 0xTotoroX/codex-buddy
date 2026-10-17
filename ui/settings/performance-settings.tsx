/* [INPUT]: 认证性能 API、页面可见性与独立偏好修订号。
 * [OUTPUT]: 集成/监测开关与实时仪表窗；隐藏页面不采样，展示历史有界且不持久化。
 * [POS]: 系统设置展示；宿主页指标与 Buddy 自身耗时明确区分。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import { Feedback, Toggle } from './settings-controls';
import { PerformanceMonitor } from './performance-monitor';
import type { PerformanceSample } from './performance-history';

type Preferences = { integrationEnabled: boolean; monitoringEnabled: boolean; revision: number };
type State = {
  preferences: Preferences;
  connectionStatus: string;
  sample: PerformanceSample | null;
  connectionError?: string;
};
async function readState(path: string, body?: unknown): Promise<State> {
  const value = await request<State>(path, body);
  if (
    typeof value?.preferences?.integrationEnabled !== 'boolean' ||
    typeof value.preferences.monitoringEnabled !== 'boolean' ||
    !Number.isSafeInteger(value.preferences.revision)
  )
    throw Error('当前后台尚未提供性能设置，请重新打开 CodexBuddy 后再试。');
  return value;
}
export function PerformanceSettings({ live, active }: { live: boolean; active: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const writing = useRef(false),
    generation = useRef(0);
  const monitoring = state?.preferences.monitoringEnabled === true;
  useEffect(() => {
    if (!live || !active) return;
    let stopped = false,
      reading = false;
    const load = async () => {
      if (stopped || reading || writing.current || document.hidden) return;
      reading = true;
      const version = ++generation.current;
      try {
        const next = await readState(`performance${monitoring ? '?sample=1' : ''}`);
        if (!stopped && version === generation.current) {
          setState(next);
          setMessage('');
        }
      } catch (error) {
        if (!stopped && version === generation.current) setMessage(String(error));
      } finally {
        reading = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    document.addEventListener('visibilitychange', load);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, [active, live, monitoring]);
  async function save(patch: Partial<Preferences>) {
    if (!state || writing.current) return;
    writing.current = true;
    generation.current++;
    setBusy(true);
    setMessage('');
    try {
      const next = await readState('performance', {
        expectedRevision: state.preferences.revision,
        ...patch,
      });
      setState(next);
      setMessage(next.connectionError || '');
    } catch (error) {
      setMessage(String(error));
      try {
        setState(await readState('performance'));
      } catch {
        /* 保留最后确认的值。 */
      }
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  const sample = monitoring && !message ? state?.sample : null;
  return (
    <section className="settings-section" aria-label="性能与开关">
      <div className="performance-controls">
        <div>
          <Toggle
            label="连接到 Codex"
            checked={state?.preferences.integrationEnabled ?? true}
            disabled={!live || !state || busy}
            onChange={(integrationEnabled) => void save({ integrationEnabled })}
          />
          {(!state ||
            !state.preferences.integrationEnabled ||
            state.connectionStatus !== 'connected') && (
            <p className="performance-control-note" role="status">
              {!state
                ? '正在读取…'
                : !state.preferences.integrationEnabled
                  ? 'Codex 集成已暂停'
                  : '等待连接 Codex'}
            </p>
          )}
        </div>
        <Toggle
          label="性能监测"
          checked={monitoring}
          disabled={!live || !state || busy}
          onChange={(monitoringEnabled) => void save({ monitoringEnabled })}
        />
      </div>
      <Feedback text={message} failed />
      <PerformanceMonitor
        sample={sample ?? null}
        enabled={monitoring}
        active={active}
        connected={state?.connectionStatus === 'connected'}
        failed={!!message}
      />
    </section>
  );
}
