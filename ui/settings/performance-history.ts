/* [INPUT]: 性能 API 的低频样本。
 * [OUTPUT]: 最多60点/5分钟的数值历史，去重、进程切换重置及缺测断线。
 * [POS]: 监视窗的纯数据处理；不采样、不持久化、不保存正文。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
export type PerformanceSample = {
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
export type PerformancePoint = {
  at: number;
  pid: number;
  cpu: number | null;
  memory: number | null;
  longTasks: number | null;
};
const HISTORY_MS = 5 * 60_000;
const HISTORY_LIMIT = 60;
export const numberOrNull = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export function appendPerformancePoint(
  history: PerformancePoint[],
  sample: PerformanceSample,
): PerformancePoint[] {
  if (!Number.isFinite(sample.sampledAt)) return history;
  const last = history.at(-1);
  if (last?.pid === sample.backend.pid && last.at >= sample.sampledAt) return history;
  const kept =
    last?.pid === sample.backend.pid
      ? history.filter((point) => point.at > sample.sampledAt - HISTORY_MS)
      : [];
  return [
    ...kept.slice(-(HISTORY_LIMIT - 1)),
    {
      at: sample.sampledAt,
      pid: sample.backend.pid,
      cpu: numberOrNull(sample.backend.cpuPercent),
      memory: numberOrNull(sample.backend.memoryBytes),
      longTasks:
        sample.host && sample.host.intervalMs > 0 ? numberOrNull(sample.host.hostLongTasks) : null,
    },
  ];
}
export function chartGeometry(points: PerformancePoint[], key: 'cpu' | 'memory', ceiling: number) {
  const end = points.at(-1)?.at ?? 0;
  const span = Math.min(
    HISTORY_MS,
    Math.max(60_000, Math.ceil((end - (points[0]?.at ?? end)) / 60_000) * 60_000),
  );
  const segments: { x: number; y: number; point: PerformancePoint }[][] = [];
  let previous: PerformancePoint | undefined;
  for (const point of points) {
    const value = point[key];
    if (value === null) {
      previous = undefined;
      continue;
    }
    if (!previous || point.at - previous.at > 12_500) segments.push([]);
    segments.at(-1)!.push({
      x: Math.max(0, 300 * (1 - (end - point.at) / span)),
      y: 84 - Math.min(1, value / ceiling) * 76,
      point,
    });
    previous = point;
  }
  return { segments, minutes: span / 60_000 };
}
