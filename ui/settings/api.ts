/*
 * [INPUT]: 启动令牌、React 与本机认证 API/SSE。
 * [OUTPUT]: 公开数据类型、request 与 useCompanion 状态订阅。
 * [POS]: 网页通信层，启动令牌移入当前标签页存储。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import { useEffect, useState } from 'react';
import type { AppearanceSettings } from '../contracts';
export interface View {
  version: string;
  connection: {
    status: 'disconnected' | 'connecting' | 'connected' | 'incompatible';
    message: string;
    endpoint: string | null;
    targetId: string | null;
    targets: { id: string; title: string; url: string }[];
  };
  desktop: { hasAnswer: boolean; headings: number };
  model: { provider: string; model: string; label: string; available: boolean; reason: string };
  updatedAt: number;
  configurationRevision: number;
  panelPreferences: AppearanceSettings;
  panelTheme: string | null;
  panelFontBase: number;
}
export type { EditableSettings, Settings } from '../contracts';
export interface Failure {
  ok: false;
  code: string;
  message: string;
}

function readToken() {
  const params = new URLSearchParams(location.hash.slice(1));
  const incoming = params.get('token');
  if (incoming) {
    sessionStorage.setItem('companion-token', incoming);
    history.replaceState(null, '', location.pathname + location.search);
  }
  return incoming || sessionStorage.getItem('companion-token') || '';
}
const token = readToken();

export class ApiError extends Error {
  constructor(public data: Failure) {
    super(data.message);
  }
}

const headers = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

export async function request<T = { ok: boolean }>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({
    ok: false,
    code: 'invalid_response',
    message: '服务暂时没有响应，请检查 CodexBuddy 是否正在运行。',
  }));
  if (!response.ok || value.ok === false) throw new ApiError(value);
  return value as T;
}

export function useCompanion() {
  const [view, setView] = useState<View | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!token) {
      setError('请运行 codex-buddy start，从启动链接打开面板。');
      return;
    }
    const controller = new AbortController();
    let disposed = false;
    async function connect() {
      let delay = 750;
      while (!disposed) {
        try {
          const response = await fetch('/api/events', {
            headers: headers(),
            signal: controller.signal,
          });
          if (response.status === 401) {
            setLive(false);
            setError('连接凭据已过期，请运行 codex-buddy start 重新打开。');
            return;
          }
          if (!response.ok || !response.body) throw new Error('服务连接暂时中断');
          setLive(true);
          setError('');
          delay = 750;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          try {
            while (!disposed) {
              const { value, done } = await reader.read();
              if (done) throw new Error('本地服务已停止');
              buffer += decoder.decode(value, { stream: true });
              let boundary: number;
              while ((boundary = buffer.indexOf('\n\n')) >= 0) {
                const block = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                const data = block
                  .split('\n')
                  .filter((line) => line.startsWith('data:'))
                  .map((line) => line.slice(5).trimStart())
                  .join('\n');
                if (data) setView(JSON.parse(data) as View);
              }
            }
          } finally {
            reader.releaseLock();
          }
        } catch {
          if (disposed) return;
          setLive(false);
          setError('与本地服务的连接中断，正在重试…');
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay = Math.min(delay * 2, 6000);
        }
      }
    }
    void connect();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, []);
  return { view, live, error };
}
