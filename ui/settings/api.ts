/*
 * [INPUT]: 启动令牌、React 与本机认证 API/SSE。
 * [OUTPUT]: 公开数据类型、request 与 useCompanion 状态订阅。
 * [POS]: 网页通信层，令牌在同源标签页共享并自动恢复认证连接；认证状态中的 Dev 地址将普通设置入口导向监督进程。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import { useEffect, useState } from 'react';
import type { AppearanceSettings } from '../shared/contracts';
export interface View {
  settingsUrl?: string | null;
  version: string;
  connection: {
    status: 'disconnected' | 'connecting' | 'connected' | 'unresponsive' | 'incompatible';
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
export type { EditableSettings, Settings } from '../shared/contracts';
export interface Failure {
  ok: false;
  code: string;
  message: string;
}

const credentialKey = 'companion-token';
let memoryToken = '';
function stored(storage: 'localStorage' | 'sessionStorage') {
  try {
    return window[storage].getItem(credentialKey) || '';
  } catch {
    return '';
  }
}
function remember(storage: 'localStorage' | 'sessionStorage', token: string) {
  try {
    if (window[storage].getItem(credentialKey) !== token)
      window[storage].setItem(credentialKey, token);
  } catch {
    /* Restricted browser storage still permits this page's in-memory connection. */
  }
}
function readToken() {
  const params = new URLSearchParams(location.hash.slice(1));
  const incoming = params.get('token');
  // An authenticated entry link is authoritative; otherwise reuse the latest same-origin token.
  const token = incoming || stored('localStorage') || stored('sessionStorage') || memoryToken;
  if (token) {
    memoryToken = token;
    remember('localStorage', token);
    remember('sessionStorage', token);
  }
  if (incoming) {
    params.delete('token');
    history.replaceState(
      null,
      '',
      location.pathname + location.search + (params.size ? `#${params}` : ''),
    );
  }
  return token;
}

export class ApiError extends Error {
  constructor(public data: Failure) {
    super(data.message);
  }
}

const headers = () => ({
  Authorization: `Bearer ${readToken()}`,
  'Content-Type': 'application/json',
});

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
  const [credential, setCredential] = useState(readToken);
  useEffect(() => {
    const sync = () => setCredential(readToken());
    const shared = (event: StorageEvent) => {
      if (event.key === credentialKey) sync();
    };
    window.addEventListener('storage', shared);
    window.addEventListener('hashchange', sync);
    window.addEventListener('focus', sync);
    return () => {
      window.removeEventListener('storage', shared);
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('focus', sync);
    };
  }, []);
  useEffect(() => {
    if (!credential) {
      setError('此标签页尚未连接 Buddy。请从眼睛菜单打开一次设置，其他标签页会自动恢复。');
      return;
    }
    const controller = new AbortController();
    let disposed = false;
    async function connect() {
      let delay = 750;
      while (!disposed) {
        try {
          const response = await fetch('/api/events', {
            headers: { Authorization: `Bearer ${credential}` },
            signal: controller.signal,
          });
          if (response.status === 401) {
            setLive(false);
            setError('设置连接已过期。请从眼睛菜单重新打开设置，其他标签页会自动恢复。');
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
                if (data) {
                  const next = JSON.parse(data) as View;
                  if (next.settingsUrl && new URL(next.settingsUrl).origin !== location.origin) {
                    location.replace(next.settingsUrl);
                    return;
                  }
                  setView(next);
                }
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
  }, [credential]);
  return { view, live, error };
}
