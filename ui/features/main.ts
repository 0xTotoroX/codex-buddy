/* [INPUT]: Authenticated native page and lease. [OUTPUT]: One feature window.
 * [POS]: Native entry, no business runtime. [PROTOCOL]: Keep features/AGENTS.md in sync. */
import { request as http } from '../settings/api';
import { startEdge } from './edge';
import { mountFeature } from './mount';
import type { FeatureState, Request } from './types';
// api.ts consumes the token fragment but preserves feature/lease query parameters here.
const params = new URLSearchParams(location.hash.slice(1));
const id = params.get('feature') || new URLSearchParams(location.search).get('feature');
const owner = params.get('lease') || new URLSearchParams(location.search).get('lease') || '';
const request: Request = (input) => http('features', input);
let mounted: ReturnType<typeof mountFeature> | null = null,
  running = false;
async function refresh() {
  if (running) return;
  running = true;
  try {
    const state = await request<FeatureState>({ op: 'state' });
    const entry = state.features.find((e) => e.id === id);
    if (
      entry &&
      ((entry.owner === owner && entry.open) ||
        (entry.pending?.owner === owner && entry.pending.ready))
    ) {
      if (!mounted)
        mounted = mountFeature(
          document.getElementById('root')!,
          entry,
          owner,
          'desktop',
          request,
          () => void refresh(),
        );
      else mounted.update(entry);
    } else {
      mounted?.dispose();
      mounted = null;
    }
  } finally {
    running = false;
  }
}
if (
  params.get('surface') === 'edge' ||
  new URLSearchParams(location.search).get('surface') === 'edge'
)
  startEdge(request);
else {
  void refresh();
  setInterval(() => void refresh().catch(() => {}), 600);
}
