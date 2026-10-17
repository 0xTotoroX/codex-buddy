/* [INPUT]: 宿主中的同步工作，以及设置页发出的短期采样请求。
 * [OUTPUT]: 有界、无正文的执行耗时与宿主页长任务/JS内存；采样租约到期自动清理。
 * [POS]: 只测量已标记同步工作，不把异步等待或整个宿主页开销归属 Buddy。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
let observer = null;
/** @type {ReturnType<typeof setTimeout> | 0} */
let timer = 0;
let started = 0;
let depth = 0;
let busyMs = 0;
let longTasks = 0;
let longestTaskMs = 0;
let work = {};

export function measureWork(name, action) {
  if (!started) return action();
  const at = performance.now();
  depth++;
  try {
    return action();
  } finally {
    const elapsed = performance.now() - at;
    if (--depth === 0) busyMs += elapsed;
    const metric = (work[name] ||= { count: 0, totalMs: 0, maxMs: 0 });
    metric.count++;
    metric.totalMs += elapsed;
    metric.maxMs = Math.max(metric.maxMs, elapsed);
  }
}

export function stopPerformance() {
  clearTimeout(timer);
  observer?.disconnect();
  observer = null;
  timer = started = busyMs = longTasks = longestTaskMs = 0;
  work = {};
}

export function samplePerformance() {
  const now = performance.now();
  const intervalMs = started ? now - started : 0;
  const memory = /** @type {Performance & {memory?:{usedJSHeapSize:number}}} */ (performance)
    .memory;
  const snapshot = {
    intervalMs,
    busyMs,
    work,
    hostLongTasks: longTasks,
    hostLongestTaskMs: longestTaskMs,
    hostJsHeapBytes: memory?.usedJSHeapSize ?? null,
    visible: !document.hidden,
  };
  if (!started && globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask')) {
    observer = new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        longTasks++;
        longestTaskMs = Math.max(longestTaskMs, entry.duration);
      }
    });
    observer.observe({ type: 'longtask' });
  }
  started = now;
  busyMs = longTasks = longestTaskMs = 0;
  work = {};
  clearTimeout(timer);
  timer = setTimeout(stopPerformance, 12000);
  return snapshot;
}
