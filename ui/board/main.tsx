/* [INPUT]: Local authenticated HTTP transport and reusable Board view.
 * [OUTPUT]: Standalone task window entry. [POS]: Board desktop/browser bootstrap.
 * [PROTOCOL]: Keep board/AGENTS.md in sync. */
import { createRoot } from 'react-dom/client';
import { request } from '../settings/api';
import { Board } from './app';
import '../tokens.css';
import './styles.css';
createRoot(document.getElementById('root')!).render(<Board request={request} />);
