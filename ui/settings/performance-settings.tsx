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
          <p className="performance-control-note" role="status">
            <span>
              {!state
                ? '正在读取…'
                : !state.preferences.integrationEnabled
                  ? 'Codex 集成已暂停'
                  : state.connectionStatus === 'connected'
                    ? '已连接 Codex'
                    : '已开启，等待连接 Codex'}
            </span>
            {' · '}关闭可暂停宿主集成，功能与数据保留。
          </p>
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
      <details className="performance-scope">
        <summary>这些读数如何计算</summary>
        <p>
          CPU 100%
          表示占用一个核心；后台内存不含独立窗口。宿主内耗时仅覆盖已计时的同步工作，整页内存和长任务包含
          Codex 自身。
        </p>
        <p>
          本页可见时每 5 秒读取，离开后最多 12
          秒停止宿主计时。历史仅在本页内存中保留，关闭监测后清空。暂停集成保留独立任务窗口和提醒事项同步。
        </p>
      </details>
    </section>
  );
}
