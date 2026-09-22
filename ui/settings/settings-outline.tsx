/*
 * [INPUT]: 设置分组是否已加载、页面滚动与 URL 锚点。
 * [OUTPUT]: 可键盘访问的设置大纲，跟随滚动标记当前分组。
 * [POS]: 设置页导航；桌面侧栏、窄屏顶部导航，不调用业务 API。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */
import { useEffect, useMemo, useRef, useState } from 'react';

export function SettingsOutline({
  panelReady,
  formReady,
}: {
  panelReady: boolean;
  formReady: boolean;
}) {
  const nav = useRef<HTMLElement>(null);
  const [active, setActive] = useState('settings-model-control');
  const sections = useMemo(
    () => [
      { id: 'settings-model-control', label: '模型快切' },
      ...(panelReady ? [{ id: 'settings-capsule', label: '胶囊' }] : []),
      ...(formReady
        ? [
            { id: 'settings-features', label: '桌面浮窗' },
            { id: 'settings-model', label: 'Stepwise 模型' },
            { id: 'settings-limits', label: '生成限制' },
            { id: 'settings-startup', label: '启动行为' },
          ]
        : []),
      { id: 'settings-connection', label: '桌面连接' },
    ],
    [panelReady, formReady],
  );

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const offset = matchMedia('(max-width: 850px)').matches
        ? (nav.current?.offsetHeight || 0) + 24
        : 48;
      let current = sections[0].id;
      for (const { id } of sections) {
        const target = document.getElementById(id);
        if (target && target.getBoundingClientRect().top <= offset) current = id;
      }
      if (
        window.scrollY > 0 &&
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
      ) {
        const hash = window.location.hash.slice(1);
        const target = sections.some(({ id }) => id === hash)
          ? document.getElementById(hash)
          : null;
        // Several short final groups can share the same clamped scroll position.
        current =
          target && target.getBoundingClientRect().top >= 0
            ? hash
            : sections[sections.length - 1].id;
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(document.body);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('hashchange', schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('hashchange', schedule);
    };
  }, [sections]);

  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!sections.some((section) => section.id === id)) return;
    const frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
    return () => cancelAnimationFrame(frame);
  }, [sections]);

  return (
    <nav
      ref={nav}
      aria-label="设置大纲"
      className="sticky top-6 pt-10 max-[850px]:top-0 max-[850px]:z-20 max-[850px]:-mx-2 max-[850px]:border-b max-[850px]:border-border max-[850px]:bg-background max-[850px]:px-2 max-[850px]:py-3"
    >
      <p className="mb-4 pl-3 text-[11px] text-muted-foreground max-[850px]:hidden">设置大纲</p>
      <ul className="flex flex-col gap-1 border-l border-border max-[850px]:flex-row max-[850px]:overflow-x-auto max-[850px]:border-0">
        {sections.map(({ id, label }) => (
          <li key={id} className="shrink-0">
            <a
              href={`#${id}`}
              aria-current={active === id ? 'location' : undefined}
              className="-ml-px block border-l-2 border-transparent px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground aria-[current=location]:border-foreground aria-[current=location]:font-medium aria-[current=location]:text-foreground max-[850px]:ml-0 max-[850px]:rounded-md max-[850px]:border-0 max-[850px]:aria-[current=location]:bg-muted"
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
