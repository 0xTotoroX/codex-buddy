/*
 * [INPUT]: 本地 DOM 几何与简短诊断字段。
 * [OUTPUT]: 可见区域判断和限量本地诊断。
 * [POS]: 只读辅助层，不记录聊天正文。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import { DIAGNOSTICS_KEY, INSTANCE_ID, MAX_DIAGNOSTICS } from './constants.js';
import { runtimeState } from './state.js';

function rectSummary(node) {
  const rect = visibleRect(node);
  if (!rect) return null;
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function readDiagnostics() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(DIAGNOSTICS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(-MAX_DIAGNOSTICS) : [];
  } catch {
    return [];
  }
}

function writeDiagnostics() {
  try {
    sessionStorage.setItem(
      DIAGNOSTICS_KEY,
      JSON.stringify(runtimeState.diagnostics.slice(-MAX_DIAGNOSTICS)),
    );
  } catch {}
}

function pushDiagnostic(event, details = {}) {
  runtimeState.diagnostics.push({
    at: new Date().toISOString(),
    instanceId: INSTANCE_ID,
    event,
    details,
  });
  if (runtimeState.diagnostics.length > MAX_DIAGNOSTICS) {
    runtimeState.diagnostics.splice(0, runtimeState.diagnostics.length - MAX_DIAGNOSTICS);
  }
  writeDiagnostics();
}

function visibleRect(node) {
  if (!(node instanceof Element)) return null;
  const rect = node.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return rect;
}

function visibleElement(node) {
  const rect = visibleRect(node);
  return Boolean(
    rect && rect.width > 20 && rect.height > 10 && rect.bottom > 0 && rect.top < window.innerHeight,
  );
}

export { pushDiagnostic, readDiagnostics, rectSummary, visibleElement, visibleRect };
