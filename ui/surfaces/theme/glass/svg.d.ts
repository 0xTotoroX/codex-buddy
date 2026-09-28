/* [INPUT]: Shared SVG renderer. [OUTPUT]: Typed surface lifecycle for React consumers.
 * [POS]: Declaration only, no alternate implementation. [PROTOCOL]: Keep glass/AGENTS.md in sync. */
export function createSvgGlass(surface: HTMLElement): {
  refresh(variant?: string): void;
  destroy(): void;
};
