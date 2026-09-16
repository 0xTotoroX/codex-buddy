/*
 * [INPUT]: 背景表面、Regular/Clear 偏好与自有凸面位移图。
 * [OUTPUT]: 共用 B 版折射几何的两种液态；仅后置模糊随变体变化。
 * [POS]: 浏览器实时背景渲染，不修改前景或读取聊天内容。
 * [PROTOCOL]: 变更时核对 AGENTS.md。
 */
import { createLensMap } from './lens.js';

export function createSvgGlass(surface) {
  if (
    !/Chrome|Chromium|Edg/.test(navigator.userAgent) ||
    !CSS.supports('backdrop-filter', 'url(#x)')
  )
    throw new Error('SVG backdrop unavailable');
  const namespace = 'http://www.w3.org/2000/svg';
  const id = `buddy-bevel-${crypto.randomUUID()}`;
  const container = document.createElementNS(namespace, 'svg');
  container.setAttribute('width', '0');
  container.setAttribute('height', '0');
  container.setAttribute('aria-hidden', 'true');
  container.setAttribute('data-csw-optics', '');
  container.innerHTML = `<defs><filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feImage preserveAspectRatio="none" result="edge" />
    <feDisplacementMap in="SourceGraphic" in2="edge" xChannelSelector="R" yChannelSelector="G" />
  </filter></defs>`;
  const image = container.querySelector('feImage');
  const displacement = container.querySelector('feDisplacementMap');
  const previous = surface.style.backdropFilter;
  surface.append(container);
  let dimensions = '';
  return {
    refresh(variant = 'regular') {
      surface.style.backdropFilter = `url(#${id}) blur(${variant === 'clear' ? 0.3 : 4}px) saturate(1)`;
      const width = Math.max(1, Math.round(surface.clientWidth));
      const height = Math.max(1, Math.round(surface.clientHeight));
      const radius = parseFloat(getComputedStyle(surface).borderTopLeftRadius) || 0;
      surface.style.setProperty('--buddy-liquid-radius', `${radius}px`);
      const next = `${width}:${height}:${radius}`;
      if (dimensions === next) return;
      const { map, scale } = createLensMap(width, height, radius);
      displacement.setAttribute('scale', String(scale));
      image.setAttribute('href', map.toDataURL());
      image.setAttribute('width', String(width));
      image.setAttribute('height', String(height));
      map.width = map.height = 0;
      dimensions = next;
    },
    destroy() {
      container.remove();
      surface.style.removeProperty('--buddy-liquid-radius');
      if (previous) surface.style.backdropFilter = previous;
      else surface.style.removeProperty('backdrop-filter');
    },
  };
}
