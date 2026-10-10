/* [INPUT]: A local SVG silhouette and its CSS dimensions; no page pixels.
 * [OUTPUT]: A contour-following map using the existing B convex lens profile.
 * [POS]: Custom-outline geometry for the shared SVG glass renderer.
 * [PROTOCOL]: Keep glass/AGENTS.md in sync. */
import { createLensProfile } from './lens.js';
export function createPathLensMap(width, height, path) {
  const map = document.createElement('canvas');
  map.width = width;
  map.height = height;
  const context = map.getContext('2d');
  context.fill(new Path2D(path));
  const mask = context.getImageData(0, 0, width, height);
  const distance = new Float32Array(width * height);
  for (let i = 0; i < distance.length; i++) distance[i] = mask.data[i * 4 + 3] > 127 ? 1e6 : 0;
  const diagonal = Math.SQRT2;
  // Two chamfer passes approximate the distance to the exact painted outline.
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      distance[i] = Math.min(
        distance[i],
        distance[i - 1] + 1,
        distance[i - width] + 1,
        distance[i - width - 1] + diagonal,
        distance[i - width + 1] + diagonal,
      );
    }
  for (let y = height - 2; y > 0; y--)
    for (let x = width - 2; x > 0; x--) {
      const i = y * width + x;
      distance[i] = Math.min(
        distance[i],
        distance[i + 1] + 1,
        distance[i + width] + 1,
        distance[i + width - 1] + diagonal,
        distance[i + width + 1] + diagonal,
      );
    }
  const band = 10;
  const { profile, peak } = createLensProfile(band);
  const pixels = context.createImageData(width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x,
        d = distance[i];
      const dx =
        distance[y * width + Math.max(0, x - 1)] - distance[y * width + Math.min(width - 1, x + 1)];
      const dy =
        distance[Math.max(0, y - 1) * width + x] -
        distance[Math.min(height - 1, y + 1) * width + x];
      const norm = Math.hypot(dx, dy) || 1;
      const shift =
        d > 0 && d < band ? profile[Math.min(255, Math.floor((d / band) * 256))] / peak : 0;
      pixels.data[i * 4] = Math.round(127.5 + ((127 * dx) / norm) * shift);
      pixels.data[i * 4 + 1] = Math.round(127.5 + ((127 * dy) / norm) * shift);
      pixels.data[i * 4 + 2] = 128;
      pixels.data[i * 4 + 3] = 255;
    }
  context.putImageData(pixels, 0, 0);
  return { map, scale: -2 * peak };
}
