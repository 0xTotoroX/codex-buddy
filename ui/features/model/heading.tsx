/* [INPUT]: Surface header slot, matrix geometry, reasoning columns and catalog controls.
 * [OUTPUT]: Title-aligned Fast/reasoning headings or catalog controls, including scroll alignment.
 * [POS]: Model-only presentation adapter for the existing surface header slot.
 * [PROTOCOL]: Keep model/AGENTS.md in sync. */
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

const styles = `
.model-heading-host { position: relative; }
.model-heading-host:has([data-model-heading-slot]:not([hidden]) .model-inline-heading:not([hidden])) > nav, .model-heading-host:has([data-model-heading-slot]:not([hidden]) .model-inline-heading:not([hidden])) > .csw-workbench-tabs {
  max-width: var(--model-title-space); min-width: 0; overflow: auto; scrollbar-width: none;
}
.model-heading-host > nav button { white-space: nowrap; }
.model-inline-heading { position: relative; display: grid; align-items: center; min-height: 28px; pointer-events: none; }
.model-inline-heading[hidden] { display: none; }
.model-heading-portal { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.model-heading-portal .model-inline-heading { position: absolute; top: 0; height: 100%; }
.model-inline-heading .model-choices { display: grid; gap: 4px; align-items: center; text-align: center; grid-column: 2; opacity: .65; }
.model-inline-heading [data-reasoning-label] { white-space: nowrap; }
.model-inline-heading .model-fast { position: absolute; top: 50%; transform: translateY(-50%); pointer-events: auto; display: grid; place-items: center; width: 28px; height: 28px; min-width: 28px; min-height: 28px; padding: 5px; border: 0; border-radius: 6px; background: transparent; color: inherit; opacity: 1; cursor: pointer; }
.model-inline-heading .model-fast:disabled { opacity: .45; cursor: default; }
.model-inline-heading .model-fast[data-phase='charging'], .model-inline-heading .model-fast[data-phase='charged'], .model-inline-heading .model-fast[data-phase='striking'] { opacity: 1; }
.model-inline-heading .model-fast:hover:not(:disabled) { background: color-mix(in srgb, currentColor 8%, transparent); }
.model-inline-heading .model-fast:focus-visible { outline: 1px solid currentColor; outline-offset: 1px; }
.model-inline-heading .model-fast > span { grid-area: 1 / 1; display: block; width: 18px; height: 18px; }
.model-inline-heading .model-fast svg { display: block; width: 18px; height: 18px; }
.model-catalog-heading { position: absolute; top: 0; height: 100%; display: flex; align-items: center; pointer-events: auto; }
.model-catalog-heading .model-picker-actions { display: flex; align-items: center; gap: 4px; margin: 0; }
.model-catalog-heading .model-icon-button { display: grid; place-items: center; width: 28px; height: 28px; padding: 5px; border: 0; border-radius: 6px; color: inherit; opacity: 1; background: transparent; cursor: pointer; }
.model-catalog-heading .model-icon-button svg { display: block; width: 18px; height: 18px; }
.model-catalog-heading .model-icon-button:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
.model-catalog-heading .model-icon-button:disabled { opacity: .45; cursor: default; }
.model-fast-fill { clip-path: inset(100% 0 0); }
.model-fast[data-filled='true'] .model-catalog-heading { position: absolute; top: 0; height: 100%; display: flex; align-items: center; pointer-events: auto; }
.model-catalog-heading .model-picker-actions { display: flex; align-items: center; gap: 4px; margin: 0; }
.model-catalog-heading .model-icon-button { display: grid; place-items: center; width: 28px; height: 28px; padding: 5px; border: 0; border-radius: 6px; color: inherit; opacity: 1; background: transparent; cursor: pointer; }
.model-catalog-heading .model-icon-button svg { display: block; width: 18px; height: 18px; }
.model-catalog-heading .model-icon-button:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
.model-catalog-heading .model-icon-button:disabled { opacity: .45; cursor: default; }
.model-fast-fill { clip-path: inset(0); }
`;
export function ModelHeading({
  actions,
  matrix,
  headings,
  nameWidth,
  widths,
  hidden,
  children,
  catalogActions,
}: {
  actions?: HTMLElement;
  matrix: RefObject<HTMLDivElement | null>;
  headings: RefObject<HTMLDivElement | null>;
  nameWidth: number;
  widths: number[];
  hidden: boolean;
  children: ReactNode;
  catalogActions?: ReactNode;
}) {
  const catalog = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!actions) return;
    actions.dataset.modelHeadingSlot = '';
    const node = matrix.current;
    const row = headings.current;
    if (!node || !row) return;
    let host: HTMLElement | null = null;
    const cleanHost = () => {
      host?.classList.remove('model-heading-host');
      host?.style.removeProperty('--model-title-space');
    };
    const measure = () => {
      const nextHost = actions.closest<HTMLElement>('header, .csw-feature-pane-head');
      if (nextHost !== host) {
        cleanHost();
        host = nextHost;
      }
      if (!host || !node.offsetWidth) return;
      host.classList.add('model-heading-host');
      const rect = node.getBoundingClientRect(),
        head = host.getBoundingClientRect();
      const scale = rect.width / node.offsetWidth || 1;
      const left = (rect.left - head.left) / scale - node.scrollLeft;
      const width = Math.max(
        node.clientWidth,
        nameWidth + 16 + widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * 4,
      );
      row.style.left = `${left}px`;
      row.style.width = `${width}px`;
      const computed = getComputedStyle(node);
      row.style.font = computed.font;
      row.style.color = computed.color;
      if (catalog.current) {
        catalog.current.style.right = `${Math.max(0, (head.right - rect.right) / scale)}px`;
        catalog.current.style.color = computed.color;
      }
      host.style.setProperty('--model-title-space', `${Math.max(0, left + nameWidth - 20)}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observer.observe(actions);
    const theme = new MutationObserver(measure);
    const view = node.closest('.feature-view');
    if (view) theme.observe(view, { attributes: true, attributeFilter: ['style'] });
    node.addEventListener('scroll', measure);
    const raf = requestAnimationFrame(measure);
    measure();
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      theme.disconnect();
      node.removeEventListener('scroll', measure);
      cleanHost();
      delete actions.dataset.modelHeadingSlot;
    };
  }, [actions, matrix, headings, nameWidth, widths.join('|'), hidden]);
  const row = (
    <>
      <style>{styles}</style>
      <div
        ref={headings}
        className="model-inline-heading model-matrix-head"
        hidden={hidden}
        style={{ gridTemplateColumns: `${nameWidth}px minmax(0, 1fr)`, columnGap: 16 }}
      >
        {children}
      </div>
    </>
  );
  return actions
    ? createPortal(
        <div className="model-heading-portal">
          {row}
          {catalogActions && (
            <div className="model-catalog-heading" ref={catalog}>
              {catalogActions}
            </div>
          )}
        </div>,
        actions,
      )
    : row;
}
