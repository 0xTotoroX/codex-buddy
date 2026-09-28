/* [INPUT]: Local authenticated HTTP transport and reusable Board view.
 * [OUTPUT]: Standalone task window entry. [POS]: Board desktop/browser bootstrap.
 * [PROTOCOL]: Keep desktop/AGENTS.md in sync. */
import { createRoot } from 'react-dom/client';
import { request } from '../../settings/api';
import { Board } from '../../features/board/app';
import '../../shared/tokens.css';
import '../../features/board/styles.css';
createRoot(document.getElementById('root')!).render(<Board request={request} />);
