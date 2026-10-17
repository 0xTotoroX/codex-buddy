/* [INPUT]: 认证性能 API、页面可见性与独立偏好修订号。
 * [OUTPUT]: Codex 集成总开关和按需资源读数；隐藏页面不采样，不保留历史正文。
 * [POS]: 系统设置展示；宿主页指标与 Buddy 自身耗时明确区分。
 * [PROTOCOL]: 变更时同步 settings/AGENTS.md。 */
import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import { Feedback, Toggle } from './settings-controls';

type Preferences = { integrationEnabled: boolean; monitoringEnabled: boolean; revision: number };
type Sample = {
  sampledAt: number;
  backend: { pid: number; cpuPercent: number | null; memoryBytes: number | null };
  host: null | {
    intervalMs: number;
    busyMs: number;
    work: Record<string, { count: number; totalMs: number; maxMs: number }>;
    hostJsHeapBytes: number | null;
    hostLongTasks: number;
    hostLongestTaskMs: number;
  };
};
type State = {
  preferences: Preferences;
  connectionStatus: string;
  sample: Sample | null;
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
const memory = (bytes: number | null | undefined) =>
  bytes == null ? '—' : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const labels: Record<string, string> = {
  scan: '聊天检查',
  render: '工作台绘制',
  features: '功能状态',
  composer: '提示词入口',
  'terms-check': '术语检查',
  'terms-scan': '术语扫描',
};

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
  const host = state?.connectionStatus === 'connected' ? sample?.host : null;
  const sampled = host && host.intervalMs > 0;
  return (
    <section className="settings-section" aria-label="性能与开关">
      <Toggle
        label="连接到 Codex"
        checked={state?.preferences.integrationEnabled ?? true}
        disabled={!live || !state || busy}
        onChange={(integrationEnabled) => void save({ integrationEnabled })}
      />
      <p className="text-sm text-muted-foreground">
        关闭后移除 Codex
        内的界面和监听。功能配置、任务与草稿保留，设置页和独立提醒事项同步继续运行。
      </p>
      <p className="text-sm" role="status">
        {!state
          ? '正在读取…'
          : !state.preferences.integrationEnabled
            ? 'Codex 集成已暂停'
            : state.connectionStatus === 'connected'
              ? '已连接 Codex'
              : '已开启，等待连接 Codex'}
      </p>
      <Toggle
        label="性能监测"
        checked={monitoring}
        disabled={!live || !state || busy}
        onChange={(monitoringEnabled) => void save({ monitoringEnabled })}
      />
      <Feedback text={message} failed />
      {monitoring && (
        <>
          <p className="text-sm text-muted-foreground">
            本页可见时每 5 秒读取一次。CPU 100% 表示占用一个核心；离开页面后最多 12 秒停止宿主计时。
          </p>
          <dl className="space-y-3" aria-label="性能读数">
            {[
              [
                'Buddy 后台 CPU',
                sample?.backend.cpuPercent == null
                  ? '等待下一次采样'
                  : `${sample.backend.cpuPercent.toFixed(1)}%`,
              ],
              ['Buddy 后台物理内存', memory(sample?.backend.memoryBytes)],
              [
                'Buddy 在宿主内的已测工作',
                sampled
                  ? `${host.busyMs.toFixed(1)} ms / ${(host.intervalMs / 1000).toFixed(1)} 秒`
                  : '—',
              ],
              ['宿主整页 JS 内存', memory(host?.hostJsHeapBytes)],
              [
                '宿主整页长任务（超过 50 ms）',
                sampled
                  ? `${host.hostLongTasks} 次 · 最长 ${host.hostLongestTaskMs.toFixed(1)} ms`
                  : '—',
              ],
            ].map(([name, value]) => (
              <div className="settings-row" key={name}>
                <dt>{name}</dt>
                <dd className="tabular-nums text-right">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-muted-foreground">
            后台读数不含独立窗口。宿主内耗时仅覆盖已加计时的同步工作，不是 Buddy 的全部
            CPU。整页内存和长任务包含 Codex 自身，不能算作 Buddy 独占。
          </p>
          {sampled && (
            <details>
              <summary className="text-sm cursor-pointer">查看工作明细</summary>
              <dl className="space-y-2 mt-3">
                {Object.entries(host.work).map(([name, work]) => (
                  <div className="settings-row" key={name}>
                    <dt>{labels[name] || name}</dt>
                    <dd className="tabular-nums">
                      {work.count} 次 · {work.totalMs.toFixed(1)} ms
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </>
      )}
    </section>
  );
}
