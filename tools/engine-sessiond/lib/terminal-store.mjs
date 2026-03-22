import { randomUUID } from 'node:crypto';
import { spawn as spawnPty } from 'node-pty';

function clamp(value, min, max, fallback) {
  const numeric = Number.parseInt(String(value ?? ''), 10);
  if (Number.isNaN(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

const isWindows = process.platform === 'win32';

function normalizeShell(shell) {
  const requested = String(shell || '').trim().toLowerCase();
  if (requested === 'cmd' || requested === 'cmd.exe') return 'cmd.exe';
  if (requested === 'powershell' || requested === 'powershell.exe') return 'powershell.exe';
  if (requested === 'zsh') return 'zsh';
  if (requested === 'sh') return 'sh';
  if (requested === 'bash') return 'bash';
  return isWindows ? 'powershell.exe' : 'bash';
}

function buildShellLaunch(shell) {
  if (shell === 'cmd.exe') {
    return { file: 'cmd.exe', args: [] };
  }
  if (shell === 'powershell.exe') {
    return { file: 'powershell.exe', args: ['-NoLogo'] };
  }
  // Unix shells — on Windows, launch through wsl.exe
  if (isWindows) {
    if (shell === 'zsh') {
      return { file: 'wsl.exe', args: ['-e', 'zsh', '-l'] };
    }
    if (shell === 'sh') {
      return { file: 'wsl.exe', args: ['-e', 'sh'] };
    }
    return { file: 'wsl.exe', args: ['-e', 'bash', '-l'] };
  }
  if (shell === 'zsh') {
    return { file: 'zsh', args: ['-l'] };
  }
  if (shell === 'sh') {
    return { file: 'sh', args: [] };
  }
  return { file: 'bash', args: ['-l'] };
}

function defaultEnv() {
  return {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  };
}

export class TerminalStore {
  #terminals = new Map();
  #emitEvent;

  constructor({ emitEvent } = {}) {
    this.#emitEvent = typeof emitEvent === 'function' ? emitEvent : () => {};
  }

  openTerminal({ cwd = process.cwd(), shell = 'bash', cols = 120, rows = 30 } = {}) {
    const normalizedShell = normalizeShell(shell);
    const launch = buildShellLaunch(normalizedShell);
    const terminalId = `terminal_${randomUUID()}`;
    const clampedCols = clamp(cols, 40, 240, 120);
    const clampedRows = clamp(rows, 12, 120, 30);
    const pty = spawnPty(launch.file, launch.args, {
      name: 'xterm-color',
      cols: clampedCols,
      rows: clampedRows,
      cwd,
      env: defaultEnv(),
    });

    const record = {
      id: terminalId,
      pty,
      shell: normalizedShell,
      cwd,
      cols: clampedCols,
      rows: clampedRows,
    };

    pty.onData((data) => {
      this.#emitEvent('terminal.output', { terminalId, data });
    });

    pty.onExit((event) => {
      this.#terminals.delete(terminalId);
      this.#emitEvent('terminal.exit', {
        terminalId,
        exitCode: event.exitCode,
        signal: event.signal,
      });
    });

    this.#terminals.set(terminalId, record);

    return {
      terminalId,
      shell: normalizedShell,
      cwd,
      cols: clampedCols,
      rows: clampedRows,
    };
  }

  writeInput(terminalId, input) {
    const terminal = this.#requireTerminal(terminalId);
    if (typeof input !== 'string') {
      throw new Error('input is required.');
    }
    terminal.pty.write(input);
  }

  resizeTerminal(terminalId, { cols, rows }) {
    const terminal = this.#requireTerminal(terminalId);
    const clampedCols = clamp(cols, 40, 240, terminal.cols);
    const clampedRows = clamp(rows, 12, 120, terminal.rows);
    terminal.cols = clampedCols;
    terminal.rows = clampedRows;
    terminal.pty.resize(clampedCols, clampedRows);
    return {
      terminalId,
      cols: clampedCols,
      rows: clampedRows,
    };
  }

  closeTerminal(terminalId) {
    const terminal = this.#requireTerminal(terminalId);
    this.#terminals.delete(terminalId);
    try {
      terminal.pty.kill();
    } catch {
      // Best effort close.
    }
  }

  closeAll() {
    for (const terminalId of Array.from(this.#terminals.keys())) {
      this.closeTerminal(terminalId);
    }
  }

  #requireTerminal(terminalId) {
    if (!terminalId) {
      throw new Error('terminalId is required.');
    }
    const terminal = this.#terminals.get(terminalId);
    if (!terminal) {
      throw new Error(`Unknown terminal: ${terminalId}`);
    }
    return terminal;
  }
}
