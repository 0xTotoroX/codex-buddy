/*
 * [INPUT]: 表面宽高与圆角。
 * [OUTPUT]: 凸面透镜的折射位移图和 SVG 缩放值，供 Regular/Clear 共用。
 * [POS]: 自有曲面与 Snell 折射计算；不读取聊天像素或引入渲染依赖。
 * [PROTOCOL]: 变更时核对 AGENTS.md。
 */
export function createLensMap(width, height, corner) {
  const radius = Math.min(corner, width / 2, height / 2);
  const band = Math.max(1, Math.min(60, radius, Math.min(width, height) * 0.15));
  const thickness = (80 * band) / 60;
  const profile = Float32Array.from({ length: 256 }, (_, i) => {
    const t = (i + 0.5) / 256;
    const crown = (1 - (1 - t) ** 4) ** 0.25;
    const slope = (1 - t) ** 3 / crown ** 3;
    const incident = Math.atan(slope);
    const transmitted = Math.asin(Math.sin(incident) / 3);
    return Math.tan(incident - transmitted) * (thickness + band * crown);
  });
  const peak = Math.max(...profile);
  const map = document.createElement('canvas');
  map.width = width;
  map.height = height;
  const context = map.getContext('2d');
  const pixels = context.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5 - width / 2,
        py = y + 0.5 - height / 2;
      const qx = Math.abs(px) - width / 2 + radius;
      const qy = Math.abs(py) - height / 2 + radius;
      const ax = Math.max(qx, 0),
        ay = Math.max(qy, 0);
      const norm = Math.hypot(ax, ay);
      const depth = radius - norm - Math.min(Math.max(qx, qy), 0);
      const shift =
        depth >= 0 && depth < band
          ? profile[Math.min(255, Math.floor((depth / band) * 256))] / peak
          : 0;
      const nx = Math.sign(px) * (norm ? ax / norm : Number(qx > qy));
      const ny = Math.sign(py) * (norm ? ay / norm : Number(qy >= qx));
      const i = (y * width + x) * 4;
      pixels.data[i] = Math.round(127.5 + 127 * nx * shift);
      pixels.data[i + 1] = Math.round(127.5 + 127 * ny * shift);
      pixels.data[i + 2] = 128;
      pixels.data[i + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  return { map, scale: -2 * peak };
}
