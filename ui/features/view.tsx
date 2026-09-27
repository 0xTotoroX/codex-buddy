/* [INPUT]: Owner lease, business projection and a container-independent request function.
 * [OUTPUT]: Feature view with guarded actions, draft/reading handoff and placement controls.
 * [POS]: Shared by native windows and host Shadow DOM surfaces; no host parsing.
 * [PROTOCOL]: Keep features/AGENTS.md in sync. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Board } from '../board/app';
import type { TaskRequest } from '../board/api';
import type { PanelSnapshot, CommandResult, PanelCommand } from '../contracts';
import { ModelView, type ModelState } from './model';
import { surfaceStyle, type Appearance } from './surface';
import { createSvgGlass } from '../panel/glass/svg.js';
import { titles, type Entry, type Request, type Reading } from './types';
export function FeatureView({
  entry,
  owner,
  request,
  placement,
  onState,
}: {
  entry: Entry;
  owner: string;
  request: Request;
  placement: string;
  onState: () => void;
}) {
  const reading = useRef<Reading>(structuredClone(entry.view || {}));
  const body = useRef<HTMLDivElement>(null);
  const gate = useRef(false);
  const restored = useRef(false);
  const wasMoving = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [projection, setProjection] = useState<PanelSnapshot | null>(null),
    [model, setModel] = useState<ModelState | null>(null);
  const [connected, setConnected] = useState(true);
  const [appearance, setAppearance] = useState<Appearance>({});
  const active = entry.owner === owner && entry.open && !entry.pending;
  const locked = !active || busy;
  const call = useCallback(
    <T,>(op: string, data: Record<string, unknown> = {}) =>
      request<T>({ op, id: entry.id, owner, ...data }),
    [request, entry.id, owner],
  );
  const capture = useCallback(() => {
    if (body.current && restored.current) {
      reading.current.top = body.current.scrollTop;
      reading.current.left = body.current.scrollLeft;
    }
    return reading.current;
  }, []);
  useEffect(() => {
    if (wasMoving.current && !entry.pending && entry.owner === owner)
      setError('切换未完成，已保留原位置。请检查目标窗口后重试。');
    wasMoving.current = entry.owner === owner && !!entry.pending;
  }, [entry.pending, entry.owner, owner]);
  useEffect(() => {
    if (entry.owner === owner && entry.pending && !entry.pending.ready && !gate.current)
      void call('handoff', { view: capture() })
        .then(onState)
        .catch(() => {});
  }, [entry.pending, entry.owner, owner, call, capture, onState]);
  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      try {
        const value = await call<
          {
            snapshot?: PanelSnapshot;
            appearance?: Appearance;
          } & ModelState
        >('read');
        if (stopped) return;
        setConnected(true);
        if (value.appearance) setAppearance(value.appearance);
        if (entry.id === 'model') setModel(value);
        else if (entry.id !== 'board' && value.snapshot) {
          const token = `${value.snapshot.viewToken}:${entry.id === 'outline' ? value.snapshot.outlineToken : value.snapshot.promptToken}`;
          if (reading.current.token !== token) {
            reading.current.top = 0;
            restored.current = true;
            reading.current.selected = 0;
            reading.current.token = token;
            if (body.current) body.current.scrollTop = 0;
          }
          setProjection(value.snapshot);
        } else if (entry.id !== 'board') setConnected(false);
      } catch {
        if (!stopped) setConnected(false);
      }
    };
    void refresh();
    const timer = setInterval(() => {
      if (!gate.current) void refresh();
    }, 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [call, entry.id]);
  useEffect(() => {
    const node = body.current;
    if (!node) return;
    const restore = () => {
      if (restored.current) return;
      const top = reading.current.top || 0;
      node.scrollTop = top;
      node.scrollLeft = reading.current.left || 0;
      if (node.scrollHeight - node.clientHeight >= top) restored.current = true;
    };
    const changes = new MutationObserver(restore);
    changes.observe(node, { childList: true, subtree: true });
    const sizes = new ResizeObserver(restore);
    sizes.observe(node);
    const intention = () => {
      restored.current = true;
    };
    const scrolled = () => {
      if (restored.current) {
        reading.current.top = node.scrollTop;
        reading.current.left = node.scrollLeft;
      }
    };
    node.addEventListener('wheel', intention, { passive: true });
    node.addEventListener('keydown', intention);
    node.addEventListener('touchstart', intention, { passive: true });
    node.addEventListener('scroll', scrolled);
    restore();
    return () => {
      changes.disconnect();
      sizes.disconnect();
      node.removeEventListener('wheel', intention);
      node.removeEventListener('keydown', intention);
      node.removeEventListener('touchstart', intention);
      node.removeEventListener('scroll', scrolled);
    };
  }, []);
  async function operation<T>(fn: () => Promise<T>) {
    if (gate.current || !active) return null;
    gate.current = true;
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      gate.current = false;
      setBusy(false);
      onState();
    }
  }
  const taskRequest: TaskRequest = useCallback(
    async <T,>(path: string, data?: unknown): Promise<T> => {
      if (path === 'tasks/state') return call<T>('read');
      if (gate.current || !active) throw new Error('功能正在交接，请稍后重试');
      gate.current = true;
      setBusy(true);
      try {
        return await call<T>('action', { data });
      } finally {
        gate.current = false;
        setBusy(false);
      }
    },
    [call, active],
  );
  const move = (next: string) =>
    operation(() => call('move', { placement: next, view: capture() }));
  const close = () => operation(() => call('close', { view: capture() }));
  useEffect(() => {
    const closing = () => void close();
    const resize = (event: Event) => {
      if (active && !gate.current)
        void call('save', { size: (event as CustomEvent).detail, view: capture() }).catch(() => {});
    };
    window.addEventListener('feature-close', closing);
    window.addEventListener('feature-size', resize);
    return () => {
      window.removeEventListener('feature-close', closing);
      window.removeEventListener('feature-size', resize);
    };
  });
  // Save transient drafts/read position in memory; never persist task text in preferences.
  useEffect(() => {
    const timer = setInterval(() => {
      if (active && !gate.current) void call('save', { view: capture() }).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [active, call, capture]);
  async function command(kind: PanelCommand['kind'], extra: Partial<PanelCommand> = {}) {
    if (!projection || !connected) return;
    const data = {
      kind,
      instanceId: projection.instanceId,
      viewToken: projection.viewToken,
      context: projection.context,
      promptToken: projection.promptToken,
      outlineToken: projection.outlineToken,
      ...extra,
    };
    await operation(async () => {
      let result = await call<CommandResult>('action', { data });
      if (result.needsConfirmation && confirm(result.message || '输入框已有草稿，是否追加？'))
        result = await call<CommandResult>('action', {
          data: { ...data, append: true, draftFingerprint: result.draftFingerprint },
        });
      if (!result.ok) throw new Error(result.message || '操作未完成');
    });
  }
  const enabled =
    entry.id === 'outline'
      ? projection?.settings.answerOutlineEnabled
      : entry.id === 'next'
        ? projection?.settings.enabled
        : true;
  const disabled = locked || !connected || !enabled || projection?.association?.available === false;
  const native = !!window.__buddyNativeSurface;
  const surface = useRef<HTMLDivElement>(null);
  const material = appearance.surface?.theme;
  const variant = appearance.surface?.liquidVariant;
  useEffect(() => {
    if (native || material !== 'native-glass' || !surface.current) return;
    let glass: { refresh: (variant?: string) => void; destroy: () => void } | undefined;
    try {
      glass = createSvgGlass(surface.current);
    } catch {
      return;
    }
    const refresh = () => glass?.refresh(variant);
    refresh();
    const resize = new ResizeObserver(refresh);
    resize.observe(surface.current);
    return () => {
      resize.disconnect();
      glass?.destroy();
    };
  }, [native, material, variant]);
  const style = surfaceStyle(
    {
      ...appearance,
      theme: projection?.theme || appearance.theme,
      fontSize: projection?.hostTypography?.baseItemFontSize || appearance.fontSize,
    },
    native,
  );
  return (
    <section
      className="feature-view"
      data-feature={entry.id}
      data-busy={busy}
      data-material={material || 'matte'}
      style={{ ...style, background: 'transparent', backdropFilter: undefined }}
    >
      <div
        className="feature-material"
        ref={surface}
        style={{ background: style.background, backdropFilter: style.backdropFilter }}
        aria-hidden="true"
      />
      <header className="feature-head">
        <strong>{titles[entry.id]}</strong>
        <select
          aria-label={`${titles[entry.id]}显示位置`}
          value={placement}
          disabled={locked}
          onChange={(e) => void move(e.target.value)}
        >
          <option value="sidebar">侧栏</option>
          <option value="overlay">页面浮层</option>
          <option value="desktop" disabled={entry.desktopSupported === false}>
            桌面窗口
          </option>
          <option value="edge">贴边 / 刘海</option>
        </select>
        <button
          aria-label={`关闭${titles[entry.id]}`}
          disabled={locked}
          onClick={() => void close()}
        >
          关闭
        </button>
      </header>
      {entry.pending && <p role="status">正在移到新位置…</p>}
      {error && <p role="alert">{error}</p>}
      {!connected && entry.id !== 'board' && <p role="status">宿主连接暂不可用，保留上次内容。</p>}
      {projection && !enabled && <p role="status">功能已停用，可在设置中重新开启。</p>}
      <div className="feature-body" ref={body} inert={!active}>
        {entry.id === 'board' ? (
          <Board
            locked={locked}
            request={taskRequest}
            embedded
            view={
              reading.current.board ??
              (reading.current.board = { search: '', stage: 'todo', tab: 'board' })
            }
          />
        ) : entry.id === 'model' ? (
          model ? (
            <ModelView
              state={model}
              reading={reading.current}
              busy={locked || !connected}
              action={(data, action) =>
                operation(async () => {
                  const result = await call<
                    ModelState & { result?: { status: string; message: string } }
                  >('action', { data, action });
                  setModel(result);
                  if (result.result && result.result.status !== 'success')
                    setError(result.result.message);
                  return result;
                })
              }
            />
          ) : (
            <p>正在读取模型…</p>
          )
        ) : projection ? (
          <>
            <p className="feature-source">{projection.sourceLabel}</p>
            {entry.id === 'outline' ? (
              <>
                <button
                  disabled={disabled || projection.scanBusy}
                  onClick={() => void command('outline-refresh')}
                >
                  刷新大纲
                </button>
                <nav aria-label="大纲">
                  {projection.outlineItems.map((item) => (
                    <button
                      className="outline-item"
                      key={item.id}
                      style={{ paddingInlineStart: 12 + Math.min(4, item.displayLevel || 0) * 12 }}
                      disabled={disabled || projection.scanBusy}
                      onClick={() => void command('outline-jump', { id: item.id })}
                    >
                      {item.numberPrefix} {item.labelText || item.text}
                    </button>
                  ))}
                </nav>
                {!projection.outlineItems.length && (
                  <p>{projection.outlineError || '当前回答暂无大纲'}</p>
                )}
              </>
            ) : (
              <>
                <div className="feature-actions">
                  <button
                    disabled={
                      disabled ||
                      projection.scanBusy ||
                      projection.bridgeStatus === 'pending' ||
                      !projection.settings.enabled
                    }
                    onClick={() => void command('generate')}
                  >
                    {projection.bridgeStatus === 'pending' ? '生成中…' : '生成下一步'}
                  </button>
                  {projection.settings.quickPrompts?.map((p, index) => (
                    <button
                      key={index}
                      disabled={disabled}
                      onClick={() => void command('quick-fill', { index })}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {projection.bridgeError && <p role="status">{projection.bridgeError}</p>}
                {projection.prompts.map((p, index) => (
                  <article className="prompt-card" key={index}>
                    <strong>{p.label}</strong>
                    <p>{p.prompt}</p>
                    <div className="feature-actions">
                      <button
                        disabled={disabled || projection.scanBusy}
                        onClick={() => void command('fill', { index })}
                      >
                        填入
                      </button>
                      <button
                        disabled={disabled || projection.scanBusy}
                        onClick={() => void command('fill', { index, submit: true })}
                      >
                        填入并发送
                      </button>
                    </div>
                  </article>
                ))}
              </>
            )}
          </>
        ) : (
          <p>等待 Codex 连接…</p>
        )}
      </div>
    </section>
  );
}
