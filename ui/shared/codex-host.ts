/* [INPUT]: Authenticated CodexHost status. [OUTPUT]: Management UI contract.
 * [POS]: Standalone background feature, independent of MCP and panel placement.
 * [PROTOCOL]: Keep shared/AGENTS.md in sync. */
export type CodexHostStatus = {
  enabled: boolean;
  revision: number;
  state:
    | 'disabled'
    | 'notInstalled'
    | 'pendingEnable'
    | 'pendingDisable'
    | 'pendingUpdate'
    | 'running'
    | 'error';
  executable: string | null;
  version: string | null;
  runningVersion: string | null;
  runningExecutable: string | null;
  managed: boolean;
  error: string | null;
  baseline: string;
  canRestore: boolean;
  restart?: {
    state: 'queued' | 'confirming' | 'restarting' | 'cancelled' | 'completed' | 'failed';
    message: string;
  } | null;
};
