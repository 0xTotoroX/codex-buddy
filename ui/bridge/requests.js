/*
 * [INPUT]: 后台安装的 CDP binding 与受限路径白名单。
 * [OUTPUT]: window.__companionDesktopRequest 请求及完成、销毁回调。
 * [POS]: 共享胶囊与 src/requests.rs 的异步请求边界。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

(() => {
  'use strict';
  window.__companionDesktop?.destroy();
  const requests = new Map();
  const prefix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let sequence = 0;
  let alive = true;
  const paths = new Set([
    '/stepwise/settings',
    '/settings/set',
    '/stepwise/generate',
    '/stepwise/test',
    '/settings/open',
    '/panel/detach',
  ]);

  function complete(id, value) {
    const request = requests.get(id);
    if (!request) return;
    requests.delete(id);
    clearTimeout(request.timer);
    request.resolve(value);
  }

  function call(path, payload = {}) {
    if (!alive || typeof window.__companionHostRequest !== 'function')
      return Promise.resolve({ error: 'CodexBuddy 未连接' });
    if (!paths.has(path) || requests.size >= 8)
      return Promise.resolve({ error: '请求不可用，请稍后重试' });
    const id = `${prefix}:${++sequence}`;
    // 弹出只等待后台启动窗口的确认，不应沿用模型生成的长超时。
    const timeout = path === '/panel/detach' ? 10000 : 310000;
    return new Promise((resolve) => {
      requests.set(id, {
        resolve,
        timer: setTimeout(
          () =>
            complete(id, {
              error:
                path === '/panel/detach'
                  ? '弹出请求未收到响应，请检查 CodexBuddy 后台连接后重试'
                  : '请求超时，请重试',
            }),
          timeout,
        ),
      });
      try {
        window.__companionHostRequest(JSON.stringify({ id, path, payload }));
      } catch {
        complete(id, { error: '桌面连接已断开' });
      }
    });
  }

  function destroy() {
    alive = false;
    for (const id of requests.keys()) complete(id, { error: '桌面连接已断开' });
    window.__companionFloatingPanel?.destroy();
    if (window.__companionDesktopRequest === call) delete window.__companionDesktopRequest;
    if (window.__companionDesktop?.complete === complete) delete window.__companionDesktop;
  }

  window.__companionDesktopRequest = call;
  window.__companionDesktop = { complete, destroy, pending: () => requests.size };
})();
