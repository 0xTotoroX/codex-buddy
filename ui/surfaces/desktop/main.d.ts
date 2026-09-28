/* [INPUT]: Shared authenticated request contract. [OUTPUT]: Desktop entry declaration.
 * [POS]: Types for main.js; no runtime implementation. [PROTOCOL]: Keep desktop/AGENTS.md in sync. */
import type { Request } from '../../shared/features';
export function startDesktop(request: Request, lease: string): void;
