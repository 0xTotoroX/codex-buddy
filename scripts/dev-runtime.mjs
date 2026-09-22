/*
 * [INPUT]: 本机后台 runtime 信息与开发会话令牌。
 * [OUTPUT]: 稳定设置页代理、认证开发来源路由及受控子进程工具，可捕获端点输出及失败原因。
 * [POS]: 开发环境基础设施；不创建浏览器或模拟模型。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function until(check, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  throw new Error(message);
}
export async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const kill = (signal) =>
    child.developmentGroup ? process.kill(-child.pid, signal) : child.kill(signal);
  kill('SIGTERM');
  try {
    await until(
      () => child.exitCode !== null || child.signalCode !== null,
      '子进程停止超时',
      10000,
    );
  } catch {
    kill('SIGKILL');
    await until(() => child.exitCode !== null || child.signalCode !== null, '无法停止开发子进程');
  }
}
export function command(program, args, options, children, capture = false) {
  const child = spawn(program, args, {
    ...options,
    detached: true,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  let stdout = '',
    stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk;
  });
  child.developmentGroup = true;
  children.add(child);
  return new Promise((resolve, reject) => {
    child.on('error', (error) => {
      children.delete(child);
      reject(error);
    });
    child.on('close', (code, signal) => {
      children.delete(child);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${program} 失败 (${code ?? signal})`));
    });
  });
}
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

export async function startGateway(token, getRuntime, development) {
  const server = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    res.setHeader('Cache-Control', 'no-store');
    if (
      req.headers.host !== new URL(origin).host ||
      (req.headers.origin && req.headers.origin !== origin)
    ) {
      res.writeHead(403).end();
      return;
    }
    try {
      if (req.url?.startsWith('/api/')) {
        if (req.headers.authorization !== `Bearer ${token}`) {
          res.writeHead(401).end();
          return;
        }
        if (development && req.url === '/api/dev/sources') {
          if (!['GET', 'POST'].includes(req.method)) {
            res.writeHead(405).end();
            return;
          }
          let body = '';
          for await (const chunk of req) {
            body += chunk;
            if (Buffer.byteLength(body) > 8192) {
              res.writeHead(413).end();
              return;
            }
          }
          try {
            if (req.method === 'POST') await development.switch(JSON.parse(body).path);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(await development.status()));
          } catch (error) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, message: error.message }));
          }
          return;
        }
        if (development?.busy?.()) {
          res
            .writeHead(503, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ ok: false, message: '开发来源正在切换，请等待完成。' }));
          return;
        }
        if (
          development?.epoch &&
          !['GET', 'HEAD'].includes(req.method) &&
          req.headers['x-codex-buddy-source'] !== development.epoch()
        ) {
          res
            .writeHead(409, { 'Content-Type': 'application/json' })
            .end(
              JSON.stringify({ ok: false, message: '开发来源已改变，请刷新此设置页后再保存。' }),
            );
          return;
        }
        const runtime = getRuntime();
        if (!runtime) {
          res.writeHead(503).end('{"message":"开发后台正在重启"}');
          return;
        }
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
          if (chunks.reduce((n, c) => n + c.length, 0) > 65536) {
            res.writeHead(413).end();
            return;
          }
        }
        const backend = `http://127.0.0.1:${runtime.port}`;
        const controller = new AbortController();
        res.on('close', () => controller.abort());
        const response = await fetch(backend + req.url, {
          method: req.method,
          headers: {
            Authorization: `Bearer ${runtime.token}`,
            Origin: backend,
            'Content-Type': 'application/json',
          },
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
          // Backend operations own their timeout; leaving the page cancels the proxy.
          signal: controller.signal,
        });
        res.writeHead(response.status, {
          'Content-Type': response.headers.get('content-type') || 'application/json',
        });
        // Settings use SSE; stream without buffering and cancel when the client leaves.
        if (response.body) {
          const reader = response.body.getReader();
          res.on('close', () => reader.cancel().catch(() => {}));
          while (!res.destroyed) {
            const { value, done } = await reader.read();
            if (done) break;
            res.write(value);
          }
        }
        res.end();
      } else {
        res.writeHead(404).end();
      }
    } catch {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end('{"message":"开发后台暂时不可用"}');
    }
  });
  await listen(server);
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
