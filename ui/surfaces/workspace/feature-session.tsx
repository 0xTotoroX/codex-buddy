/* [INPUT]: Owner lease, business projection, request function and optional surface header slot.
 * [OUTPUT]: Business content with guarded actions and draft/reading handoff; the surface owns chrome.
 * [POS]: Shared by native windows and host Shadow DOM surfaces; no host parsing.
 * [PROTOCOL]: Keep AGENTS.md in this module in sync. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { readWorkbenchScroll, writeWorkbenchScroll } from './reading.js';
import { FeatureContent, contentToken, type FeatureData } from '../../features/content';
import type { PanelSnapshot } from '../../shared/contracts';
import { surfaceStyle, type Appearance } from '../theme/appearance';
import { type Entry, type Request, type Reading } from '../../shared/features';
export function FeatureView({
  entry,
  owner,
  request,
  onState,
  onReady,
  registerReload,
  beforeHandoff,
  onHandoffError,
  headerActions,
}: {
  headerActions?: HTMLElement;
  entry: Entry;
  owner: string;
  request: Request;
  onState: () => void;
  onReady?: () => Promise<void>;
  registerReload?: (handler: () => Promise<boolean>) => void;
  beforeHandoff?: () => Promise<unknown>;
  onHandoffError?: (pendingOwner: string) => void;
}) {
  const reading = useRef<Reading>(structuredClone(entry.view || {}));
  const body = useRef<HTMLDivElement>(null);
  const gate = useRef(false);
  const restored = useRef(false);
  const wasMoving = useRef('');
  const handoffOwner = useRef('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [value, setValue] = useState<FeatureData | null>(null);
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
    if (body.current?.clientHeight && restored.current) {
      reading.current.top = readWorkbenchScroll(body.current);
      reading.current.left = body.current.scrollLeft;
    }
    return reading.current;
  }, []);
  useEffect(() => {
    registerReload?.(async () => {
      if (gate.current || entry.pending) return false;
      if (active) await call('save', { view: capture() });
      return true;
    });
  }, [registerReload, active, entry.pending, call, capture]);
  useEffect(() => {
    if (wasMoving.current && !entry.pending && entry.owner === owner) {
      onHandoffError?.(wasMoving.current);
      setError('切换未完成，已保留原位置。请检查目标窗口后重试。');
    }
    wasMoving.current = entry.owner === owner ? entry.pending?.owner || '' : '';
  }, [entry.pending, entry.owner, owner]);
  useEffect(() => {
    if (!entry.pending) handoffOwner.current = '';
    if (
      entry.owner === owner &&
      entry.pending &&
      !entry.pending.ready &&
      !gate.current &&
      handoffOwner.current !== entry.pending.owner
    ) {
      handoffOwner.current = entry.pending.owner;
      void Promise.resolve()
        .then(() => beforeHandoff?.())
        .then(() => call('handoff', { view: capture(), pendingOwner: entry.pending!.owner }))
        .then(onState)
        .catch((e) => {
          if (/请求较多|请求不可用，请稍后重试/.test(String(e))) {
            if (handoffOwner.current === entry.pending!.owner) handoffOwner.current = '';
            return;
          }
          onHandoffError?.(entry.pending!.owner);
          setError(String(e));
        });
    }
  }, [entry.pending, entry.owner, owner, call, capture, onState]);
  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      try {
        const value = await call<FeatureData & { appearance?: Appearance }>('read');
        if (stopped) return;
        setConnected(true);
        if (value.appearance) setAppearance(value.appearance);
        const token = contentToken(entry.id, value);
        if (token && reading.current.token !== token) {
          reading.current.top = 0;
          reading.current.previewTop = 0;
          reading.current.selected = 0;
          restored.current = true;
          reading.current.token = token;
          if (body.current) writeWorkbenchScroll(body.current, 0);
        }
        if (['outline', 'next'].includes(entry.id) && !value.snapshot) setConnected(false);
        else setValue(value);
        await onReady?.();
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
      if (!node.clientHeight) return;
      const top = reading.current.top || 0;
      writeWorkbenchScroll(node, top);
      node.scrollLeft = reading.current.left || 0;
      if (node.scrollHeight - node.clientHeight >= top) restored.current = true;
    };
    const changes = new MutationObserver(restore);
    changes.observe(node, { childList: true, subtree: true });
    const sizes = new ResizeObserver(restore);
    sizes.observe(node);
    const intention = () => {
      if (node.clientHeight) writeWorkbenchScroll(node, node.scrollTop);
      restored.current = true;
    };
    const scrolled = () => {
      if (restored.current && node.clientHeight) {
        reading.current.top = readWorkbenchScroll(node);
        writeWorkbenchScroll(node, reading.current.top);
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
  async function operation<T>(fn: () => Promise<T>, propagate = false) {
    if (gate.current || !active) {
      if (propagate) throw Error('功能正在交接，请稍后重试');
      return null;
    }
    gate.current = true;
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(String(e));
      if (propagate) throw e;
      return null;
    } finally {
      gate.current = false;
      setBusy(false);
      onState();
    }
  }
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
  const projection = value?.snapshot as PanelSnapshot | undefined;
  const style = surfaceStyle({
    ...appearance,
    theme: projection?.theme || appearance.theme,
    colors: projection?.colors || appearance.colors,
    fontSize: projection?.hostTypography?.baseItemFontSize || appearance.fontSize,
  });
  return (
    <section
      className="feature-view"
      data-feature={entry.id}
      data-busy={busy}
      style={{ ...style, background: 'transparent', backdropFilter: undefined }}
    >
      {entry.pending && <p role="status">正在移到新位置…</p>}
      {error && <p role="alert">{error}</p>}
      {!connected && entry.id !== 'board' && <p role="status">宿主连接暂不可用，保留上次内容。</p>}
      <div
        className="feature-body"
        data-reading-key={reading.current.token || entry.id}
        ref={body}
        inert={!active}
      >
        <FeatureContent
          headerActions={headerActions}
          id={entry.id}
          reading={reading.current}
          value={value}
          locked={locked}
          connected={connected}
          call={call}
          operation={operation}
          update={setValue}
        />
      </div>
    </section>
  );
}
