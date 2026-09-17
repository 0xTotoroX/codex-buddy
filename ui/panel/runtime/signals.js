/*
 * [INPUT]: 各模块的同步变更通知。
 * [OUTPUT]: 固定同步通知类型和订阅；bindingUnavailable 通知使在途结果失效。
 * [POS]: 向上通知边界；不查询状态、不调用业务或 DOM。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

/** @typedef {{render: {preserveMorph?: boolean,allowDuringTransition?:boolean,viewIndicatorFrom?:string}|undefined, scan: number, bindingUnavailable: undefined, context: undefined, runtime: boolean, complete: number, settings: undefined, preview: undefined, generationControl: {mode:string,busy:boolean}, verify: undefined, theme: undefined, windowToggle: undefined}} SignalMap */
/** @type {Map<keyof SignalMap, Set<Function>>} */
const listeners = new Map();

/** @template {keyof SignalMap} K @param {K} kind @param {(value:SignalMap[K])=>void} handler */
function onSignal(kind, handler) {
  if (!listeners.has(kind)) listeners.set(kind, new Set());
  listeners.get(kind).add(handler);
  return () => listeners.get(kind)?.delete(handler);
}

/** @template {keyof SignalMap} K @param {K} kind @param {SignalMap[K]} value */
function emitSignal(kind, value) {
  for (const handler of listeners.get(kind) || []) handler(value);
}

export { emitSignal, onSignal };
