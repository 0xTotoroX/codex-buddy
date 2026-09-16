/*
 * [INPUT]: 已安装配置、真实 Codex CDP 元数据与本机 API。
 * [OUTPUT]: 窗口选择、开发配置初始化、安装版连接暂停与恢复。
 * [POS]: 真实宿主开发边界；不启动浏览器、不记录聊天、不修改官方应用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}
export function endpointUrl(value) {
  const url = new URL(/^\d+$/.test(value) ? `http://127.0.0.1:${value}` : value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.port ||
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('请使用带端口的本机 CDP 地址。');
  return url.origin;
}
export function realTarget(target) {
  if (target.type !== 'page') return false;
  try {
    const url = new URL(target.url);
    return (
      url.protocol === 'app:' &&
      url.hostname === '-' &&
      url.pathname === '/index.html' &&
      !/overlay|settings/.test(url.searchParams.get('initialRoute') || '')
    );
  } catch {
    return false;
  }
}
export async function requestRuntime(runtime, path, body) {
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`本机后台请求失败 (${response.status})`);
  return response.json();
}
export async function inspectHost(target) {
  const url = new URL(target.webSocketDebuggerUrl);
  if (url.protocol !== 'ws:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('宿主调试连接必须位于本机。');
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('读取宿主状态超时')), 3000);
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression: `({focused:document.hasFocus(),occupied:Boolean(window.__companionDesktop),development:window.__companionFloatingPanel?.development===true,roots:document.querySelectorAll('[data-companion-stepwise-root="true"]').length})`,
            returnByValue: true,
          },
        }),
      );
    socket.onmessage = (event) => {
      const result = JSON.parse(event.data);
      if (result.id === 1)
        finish(result.error ? new Error('无法读取宿主状态') : null, result.result?.result?.value);
    };
    socket.onerror = () => finish(new Error('无法连接宿主调试窗口'));
  });
}
export async function findHost(source, options = {}) {
  const config = readJson(join(source, 'config.json'), {});
  const installation = readJson(join(source, 'runtime.json'));
  let state;
  if (installation) {
    try {
      state = await requestRuntime(installation, 'state');
    } catch {}
  }
  const endpoints = options.cdp
    ? [endpointUrl(options.cdp)]
    : [
        ...new Set(
          [
            state?.connection.endpoint,
            config.cdpEndpoint,
            'http://127.0.0.1:9229',
            'http://127.0.0.1:9231',
            'http://127.0.0.1:9329',
          ]
            .filter(Boolean)
            .map(endpointUrl),
        ),
      ];
  for (const endpoint of endpoints) {
    let targets;
    try {
      const response = await fetch(endpoint + '/json/list', { signal: AbortSignal.timeout(1500) });
      targets = (await response.json()).filter(realTarget);
    } catch {
      continue;
    }
    if (!targets.length) continue;
    const preferred = options.target || state?.connection.targetId || config.targetId;
    let target = targets.find((target) => target.id === preferred);
    if (options.target && !target) throw new Error('指定的真实 Codex 窗口不存在。');
    if (!target && targets.length === 1) target = targets[0];
    if (!target) {
      const focused = await Promise.all(
        targets.map(async (target) => ({ target, state: await inspectHost(target) })),
      );
      const matches = focused.filter((entry) => entry.state?.focused);
      if (matches.length === 1) target = matches[0].target;
    }
    if (!target)
      throw new Error(
        `发现多个 Codex 窗口。请聚焦目标窗口后重试，或使用 --target：${targets.map((t) => t.id).join(', ')}`,
      );
    return { endpoint, target, installation, installedState: state };
  }
  throw new Error(
    '没有找到可调试的真实 Codex。请通过现有 CodexBuddy 启动入口打开 Codex，再运行 npm run dev；已有端口可用 --cdp 指定。不会打开示例页面或另建 ChatGPT 实例。',
  );
}
export function initializeData(source, data, host) {
  const marker = join(data, 'real-host.json');
  if (!existsSync(marker)) {
    const config = readJson(join(source, 'config.json'), {});
    config.stepwise = { ...config.stepwise, generationMode: 'manual' };
    writeFileSync(join(data, 'config.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
    const secrets = readJson(join(source, 'secrets.json'));
    if (secrets)
      writeFileSync(join(data, 'secrets.json'), JSON.stringify(secrets), { mode: 0o600 });
    writeFileSync(marker, JSON.stringify({ initialized: true }), { mode: 0o600 });
  }
  const config = readJson(join(data, 'config.json'), {});
  config.cdpEndpoint = host.endpoint;
  config.targetId = host.target.id;
  writeFileSync(join(data, 'config.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
}
export async function restoreInstallation(journal) {
  const saved = readJson(journal);
  if (!saved) return;
  let state;
  try {
    state = await requestRuntime(saved.runtime, 'state');
  } catch {
    throw new Error('安装版后台不可达，恢复记录已保留；请重新启动安装版。');
  }
  if (state.connection.status === 'disconnected') {
    await requestRuntime(saved.runtime, 'connect', {
      endpoint: saved.endpoint,
      targetId: saved.targetId,
    });
    console.log('已恢复安装版的原窗口连接。');
  }
  if (
    saved.detached &&
    (state.connection.status === 'disconnected' ||
      (state.connection.endpoint === saved.endpoint &&
        state.connection.targetId === saved.targetId))
  )
    await requestRuntime(saved.runtime, 'panel/open', {});
  rmSync(journal, { force: true });
}
export async function pauseInstallation(host, journal) {
  let state;
  if (host.installation) {
    try {
      state = await requestRuntime(host.installation, 'state');
    } catch {}
  }
  if (
    !host.installation ||
    state?.connection.status !== 'connected' ||
    state.connection.endpoint !== host.endpoint ||
    state.connection.targetId !== host.target.id
  ) {
    if ((await inspectHost(host.target))?.occupied)
      throw new Error('目标窗口已有其他胶囊实例，请先关闭对应后台；未覆盖现有胶囊。');
    return;
  }
  writeFileSync(
    journal,
    JSON.stringify({
      runtime: host.installation,
      endpoint: host.endpoint,
      targetId: host.target.id,
      detached: state.panelPreferences?.detached,
    }),
    { mode: 0o600 },
  );
  console.log('暂停安装版的此窗口连接；退出开发后恢复。ChatGPT 保持运行。');
  await requestRuntime(host.installation, 'panel/close', {});
  await requestRuntime(host.installation, 'disconnect', {});
  if ((await inspectHost(host.target))?.occupied)
    throw new Error('原胶囊尚未退出，暂不注入开发版。');
}
