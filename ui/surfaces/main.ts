/* [INPUT]: Authenticated native page and lease. [OUTPUT]: One feature window.
 * [POS]: Native entry, no business runtime. [PROTOCOL]: Keep AGENTS.md in this module in sync. */
import { request as http } from '../settings/api';
import { startEdge } from './edge/main';
import { startDesktop } from './desktop/main.js';
import type { Request } from '../shared/features';
// api.ts consumes the token fragment but preserves feature/lease query parameters here.
const params = new URLSearchParams(location.hash.slice(1));
const id = params.get('feature') || new URLSearchParams(location.search).get('feature');
const owner = params.get('lease') || new URLSearchParams(location.search).get('lease') || '';
const request: Request = (input) => http('features', input);
if (
  params.get('surface') === 'edge' ||
  new URLSearchParams(location.search).get('surface') === 'edge'
)
  startEdge(request);
else if (id === 'main') startDesktop(request, owner);
