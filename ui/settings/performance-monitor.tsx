/* [INPUT]: 性能设置传入的样本、采样与连接状态，performance-history 的有界历史。
 * [OUTPUT]: CPU/内存走势、宿主工作明细和整页长任务轨迹；关闭时清空历史。
 * [POS]: 设置页内的纯展示监视窗，无独立计时器、请求或动画循环。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
import { useEffect, useId, useState } from 'react';
import {
  appendPerformancePoint,
  chartGeometry,
  numberOrNull,
  type PerformanceSample,
  type PerformancePoint,
} from './performance-history';
import './performance-monitor.css';

const labels: Record<string, string> = {
  scan: '聊天检查',
  render: '工作台绘制',
  features: '功能状态',
  composer: '提示词入口',
  'terms-check': '术语检查',
  'terms-scan': '术语扫描',
};
const memory = (bytes: number | null | undefined) =>
  bytes == null ? '—' : (bytes / 1024 / 1024).toFixed(1);
const clock = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour12: false });

function Trend({
  history,
  metric,
  ceiling,
  unit,
}: {
  history: PerformancePoint[];
  metric: 'cpu' | 'memory';
  ceiling: number;
  unit: string;
}) {
  const id = useId();
  const { segments, minutes } = chartGeometry(history, metric, ceiling);
  const end = segments.at(-1)?.at(-1);
  return (
    <div className="performance-trend">
      <span className="performance-axis">
        {metric === 'memory' ? memory(ceiling) : ceiling}
        {unit}
      </span>
      <svg
        viewBox="0 0 304 92"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${metric === 'cpu' ? 'Buddy 后台 CPU' : 'Buddy 后台物理内存'}最近${minutes}分钟走势，${history.filter((p) => p[metric] !== null).length}个采样点`}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="currentColor" stopOpacity=".22" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          className="performance-grid"
          d="M0 8H304 M0 46H304 M0 84H304 M76 8V84 M152 8V84 M228 8V84"
        />
        {segments.map((segment, index) => {
          const line = segment.map(({ x, y }, i) => `${i ? 'L' : 'M'}${x + 2},${y}`).join(' ');
          return (
            <g key={index}>
              {segment.length > 1 && (
                <path
                  d={`${line} L${segment.at(-1)!.x + 2},84 L${segment[0].x + 2},84 Z`}
                  fill={`url(#${id})`}
                />
              )}
              <path className="performance-line" d={line} />
            </g>
          );
        })}
        {end && (
          <g>
            <circle cx={end.x + 2} cy={end.y} r="7" fill="currentColor" opacity=".12" />
            <circle cx={end.x + 2} cy={end.y} r="2.8" fill="currentColor">
              <title>
                {clock(end.point.at)} ·{' '}
                {metric === 'memory' ? memory(end.point.memory) : end.point.cpu?.toFixed(1)}
                {unit}
              </title>
            </circle>
          </g>
        )}
      </svg>
      <div className="performance-chart-foot">
        <span>−{minutes} 分钟</span>
        <span>{history.length ? '最新样本' : '等待采样'}</span>
      </div>
    </div>
  );
}

export function PerformanceMonitor({
  sample,
  enabled,
  active,
  connected,
  failed,
}: {
  sample: PerformanceSample | null;
  enabled: boolean;
  active: boolean;
  connected: boolean;
  failed: boolean;
}) {
  const [history, setHistory] = useState<PerformancePoint[]>([]);
  useEffect(() => {
    if (!enabled) {
      setHistory([]);
      return;
    }
    if (sample) setHistory((previous) => appendPerformancePoint(previous, sample));
  }, [enabled, sample]);
  // 保存失败或断连时不把上次成功读数伪装成当前数据；历史只留作参考。
  const current = enabled && !failed ? sample : null;
  const cpu = numberOrNull(current?.backend.cpuPercent);
  const bytes = numberOrNull(current?.backend.memoryBytes);
  const host = connected && current?.host && current.host.intervalMs > 0 ? current.host : null;
  const points = enabled ? history : [];
  const cpuCeiling = Math.max(5, Math.ceil(Math.max(0, ...points.map((p) => p.cpu ?? 0)) / 5) * 5);
  const memoryCeiling =
    Math.max(
      32,
      Math.ceil(Math.max(0, ...points.map((p) => (p.memory ?? 0) / 1048576)) / 32) * 32,
    ) * 1048576;
  const work = Object.entries(labels).map(([name, label]) => ({ label, ...host?.work[name] }));
  const maximumWork = Math.max(1, ...work.map((item) => item.totalMs ?? 0));
  const status = !enabled
    ? '监测已暂停'
    : failed
      ? '采样暂不可用'
      : !active
        ? '采样已暂停'
        : !current
          ? '等待首个样本'
          : '正在采样';
  const ticks = points.slice(-36);
  const maxTasks = Math.max(1, ...ticks.map((point) => point.longTasks ?? 0));
  return (
    <div className="performance-dashboard" data-paused={!enabled} aria-label="运行监视器">
      <header className="performance-monitor-head">
        <div>
          <span className="performance-indicator" data-running={enabled && active && !!current} />
          <strong>运行监视器</strong>
          <span className="performance-status">{status}</span>
        </div>
        <span className="performance-cadence">
          {current ? clock(current.sampledAt) : '—'}
          <span> · 5 秒</span>
        </span>
      </header>
      <div className="performance-primary" aria-label="性能读数">
        <section className="performance-instrument" data-metric="cpu" aria-label="Buddy 后台 CPU">
          <div className="performance-instrument-title">
            <h3>后台 CPU</h3>
            <span>单核 100%</span>
          </div>
          <div className="performance-value-row">
            <p className="performance-value">
              {cpu == null ? (
                '—'
              ) : (
                <>
                  {cpu.toFixed(1)}
                  <small>%</small>
                </>
              )}
            </p>
            <svg className="performance-dial" viewBox="0 0 64 64" aria-hidden="true">
              <circle className="performance-dial-track" cx="32" cy="32" r="26" />
              <circle
                className="performance-dial-value"
                cx="32"
                cy="32"
                r="26"
                pathLength="100"
                strokeDasharray={`${Math.min(cpu ?? 0, 100)} 100`}
              />
              <path
                d="M24 33h5l3-9 4 16 3-7h4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                opacity=".65"
              />
            </svg>
          </div>
          <Trend history={points} metric="cpu" ceiling={cpuCeiling} unit="%" />
        </section>
        <section
          className="performance-instrument"
          data-metric="memory"
          aria-label="Buddy 后台物理内存"
        >
          <div className="performance-instrument-title">
            <h3>物理内存</h3>
            <span>Buddy 后台</span>
          </div>
          <div className="performance-value-row">
            <p className="performance-value">
              {memory(bytes)}
              <small> MB</small>
            </p>
          </div>
          <Trend history={points} metric="memory" ceiling={memoryCeiling} unit=" MB" />
        </section>
      </div>
      {!enabled && <p className="performance-empty">开启上方“性能监测”，开始记录实时走势。</p>}
      {enabled && !failed && cpu === null && (
        <p className="performance-empty">
          {current ? '等待下一次采样，计算 CPU 用量。' : '正在等待性能数据…'}
        </p>
      )}
      <div className="performance-host-work">
        <div>
          <h3>Buddy 在宿主内的已测工作</h3>
          <p>已计时的同步工作</p>
        </div>
        <p className="performance-work-value">
          {host ? host.busyMs.toFixed(1) : '—'}
          <span> ms{host ? ` / ${(host.intervalMs / 1000).toFixed(1)} 秒` : ''}</span>
        </p>
        <div className="performance-work-track" aria-hidden="true">
          <div
            style={{
              transform: `scaleX(${host ? Math.min(1, host.busyMs / host.intervalMs) : 0})`,
            }}
          />
        </div>
      </div>
      <section className="performance-host" aria-label="Codex 整页指标">
        <div className="performance-host-heading">
          <h3>Codex 整页</h3>
          <span>包含 Codex 自身，非 Buddy 独占</span>
        </div>
        <div className="performance-host-metrics">
          <div>
            <span>JS 内存</span>
            <strong>
              {memory(host?.hostJsHeapBytes)}
              <small> MB</small>
            </strong>
          </div>
          <div>
            <span>长任务 · 超过 50 ms</span>
            <strong data-alert={!!host?.hostLongTasks}>
              {host ? host.hostLongTasks : '—'}
              <small> 次</small>
            </strong>
          </div>
          <div>
            <span>最长任务</span>
            <strong>
              {host ? host.hostLongestTaskMs.toFixed(0) : '—'}
              <small> ms</small>
            </strong>
          </div>
        </div>
        <div className="performance-events" aria-label="最近采样中的整页长任务次数">
          {Array.from({ length: 36 }, (_, index) => {
            const point = ticks[index - (36 - ticks.length)];
            const count = point?.longTasks;
            return (
              <span
                key={index}
                data-event={count != null && count > 0}
                data-known={count != null}
                style={{
                  height:
                    count == null || count === 0
                      ? '3px'
                      : `${Math.max(20, (count / maxTasks) * 100)}%`,
                }}
                title={
                  point
                    ? `${clock(point.at)} · ${count == null ? '未采到宿主数据' : `${count} 次长任务`}`
                    : '尚无样本'
                }
              />
            );
          })}
        </div>
      </section>
      <footer className="performance-monitor-foot">
        <span>本页记录 · 最多 5 分钟</span>
        <span>隐藏后停止请求</span>
      </footer>
      {host && (
        <details className="performance-details">
          <summary>查看工作明细</summary>
          <div className="performance-work-list">
            {work.map((item) => (
              <div className="performance-work-item" key={item.label}>
                <div>
                  <span>{item.label}</span>
                  <span>
                    {(item.totalMs ?? 0).toFixed(1)} ms <small>· {item.count ?? 0} 次</small>
                  </span>
                </div>
                <div className="performance-mini-track">
                  <span style={{ transform: `scaleX(${(item.totalMs ?? 0) / maximumWork})` }} />
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
