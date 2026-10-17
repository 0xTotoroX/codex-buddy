/* [INPUT]: 展开浮层几何、左栏入口矩形与可中断的开合进度。
 * [OUTPUT]: 整个实时浮层向入口曲面收拢的动画；保留内容尺寸与节点，不采集页面像素。
 * [POS]: geometry 的页面浮层动效适配；系统窗口仍使用原生形变。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const maps = new Map();
let active = null;
let sequence = 0;

// 只绘制数学位移场，不绘制聊天或功能内容。沿用原生网格的前缘收窄曲线。
function displacementMap(horizontal, forward) {
  const key = `${horizontal}:${forward}`;
  if (maps.has(key)) return maps.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const pixels = context.createImageData(128, 128);
  for (let y = 0; y < 128; y += 1) {
    for (let x = 0; x < 128; x += 1) {
      const axis = (horizontal ? x : y) / 127;
      const cross = (horizontal ? y : x) / 127;
      const lead = forward ? axis : 1 - axis;
      const curve = lead * lead * (3 - 2 * lead);
      const narrow = 1 - 0.74 * (0.12 + 0.88 * curve);
      const delta = (cross - 0.5) / narrow - (cross - 0.5);
      const displaced = Math.round(255 * Math.max(0, Math.min(1, 0.5 + delta)));
      const index = (y * 128 + x) * 4;
      pixels.data[index] = horizontal ? 128 : displaced;
      pixels.data[index + 1] = horizontal ? displaced : 128;
      pixels.data[index + 2] = 128;
      pixels.data[index + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  const url = canvas.toDataURL();
  maps.set(key, url);
  return url;
}

function warpFilter(parent, width, height, dx, dy) {
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const map = displacementMap(horizontal, (horizontal ? dx : dy) >= 0);
  if (!map) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  const id = `csw-overlay-warp-${++sequence}`;
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
  svg.innerHTML = `<filter id="${id}" x="0" y="0" width="${width}" height="${height}"
    filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
    <feImage x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" result="map"/>
    <feDisplacementMap in="SourceGraphic" in2="map" scale="0" xChannelSelector="R" yChannelSelector="G"/>
  </filter>`;
  svg.querySelector('feImage').setAttribute('href', map);
  parent.append(svg);
  return {
    svg,
    id,
    displacement: svg.querySelector('feDisplacementMap'),
    scale: horizontal ? height : width,
  };
}

export function overlayMotionState() {
  return active ? { progress: active.progress(), anchor: active.anchor } : null;
}

export function cancelOverlayMotion() {
  if (!active) return;
  cancelAnimationFrame(active.frame);
  active.filter?.svg.remove();
  active.popover.style.removeProperty('filter');
  delete active.popover.dataset.overlayMotion;
  active = null;
}

export function animateOverlay(popover, geometry, anchor, start, target, duration) {
  const anchored = anchor && anchor.width > 0 && anchor.height > 0;
  const dx = anchored ? anchor.left - geometry.left : geometry.width * 0.03;
  const dy = anchored ? anchor.top - geometry.top : geometry.height * 0.03;
  const sx = anchored ? anchor.width / geometry.width : 0.94;
  const sy = anchored ? anchor.height / geometry.height : 0.94;
  const progressAt = (time) => {
    const t = Math.max(0, Math.min(1, time / duration));
    return start + (target - start) * (1 - Math.pow(1 - t, 3));
  };
  const frames = Array.from({ length: 41 }, (_, index) => {
    const p = progressAt((index / 40) * duration);
    return {
      offset: index / 40,
      transform: `translate(${dx * (1 - p)}px, ${dy * (1 - p)}px) scale(${sx + (1 - sx) * p}, ${sy + (1 - sy) * p})`,
      opacity: anchored ? Math.min(1, p * 8) : p,
    };
  });
  popover.dataset.overlayMotion = 'true';
  const filter = anchored
    ? warpFilter(popover.parentElement, geometry.width, geometry.height, dx, dy)
    : null;
  if (filter) popover.style.filter = `url(#${filter.id})`;
  const animation = popover.animate(frames, { duration, easing: 'linear', fill: 'both' });
  const motion = {
    popover,
    anchor,
    filter,
    frame: 0,
    progress: () => progressAt(Number(animation.currentTime) || 0),
  };
  active = motion;
  const update = () => {
    if (active !== motion) return;
    const p = motion.progress();
    filter?.displacement.setAttribute('scale', String(filter.scale * Math.sin(Math.PI * p) ** 2));
    if (animation.playState !== 'finished') motion.frame = requestAnimationFrame(update);
  };
  update();
  return animation;
}
