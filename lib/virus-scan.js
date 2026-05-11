import { spawn } from 'child_process';
import { logError, logInfo } from './observability.js';

const DEFAULT_TIMEOUT_MS = 20_000;

function normalizeMode(rawMode) {
  const mode = String(rawMode || '').trim().toLowerCase();
  if (['off', 'disabled', 'none'].includes(mode)) return 'off';
  if (['command', 'cmd'].includes(mode)) return 'command';
  if (process.env.UPLOAD_VIRUS_SCAN_CMD) return 'command';
  // In Produktion standardmäßig aktiv (fail-closed, falls kein Command konfiguriert).
  return process.env.NODE_ENV === 'production' ? 'command' : 'off';
}

function runCommand(cmdTemplate, filePath, timeoutMs) {
  return new Promise((resolve) => {
    // shell:false (see spawn() below) already prevents shell metacharacter
    // interpretation — args are passed to execve directly. No quoting needed;
    // JSON.stringify would inject literal `"` into the filename argument and
    // make the scanner search for a file that doesn't exist.
    const safePathArg = String(filePath || '');

    // Parse command template safely — tokenise on whitespace so each token
    // becomes its own argv entry under `shell: false`. The `{file}` marker
    // (if present) is replaced with the real path; otherwise the path is
    // appended as the last argument. Templates without spaces inside
    // arguments are the only supported shape — quoting is not honoured here.
    const tokens = cmdTemplate.trim().split(/\s+/).filter(Boolean);
    let cmd;
    let args = [];
    if (tokens.length === 0) {
      cmd = '';
      args = [safePathArg];
    } else if (cmdTemplate.includes('{file}')) {
      cmd = tokens[0];
      args = tokens.slice(1).map((t) => (t === '{file}' ? safePathArg : t));
    } else {
      cmd = tokens[0];
      args = [...tokens.slice(1), safePathArg];
    }

    // SECURITY: Execute with shell: false to prevent command injection
    const child = spawn(cmd, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code: Number(code),
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        code: -1,
        stdout: '',
        stderr: err.message,
        timedOut: false,
      });
    });
  });
}

export async function scanFileForViruses(filePath) {
  const mode = normalizeMode(process.env.UPLOAD_VIRUS_SCAN_MODE);
  const failOpenDefault = process.env.NODE_ENV === 'production' ? 'false' : 'true';
  // failOpen=true  → scanner errors / timeouts skip the gate (uploads pass).
  // failOpen=false → scanner errors / timeouts block uploads (fail-closed).
  // Production default is fail-closed; never silently swallow scanner outages.
  const failOpen = String(process.env.UPLOAD_VIRUS_SCAN_FAIL_OPEN || failOpenDefault).toLowerCase() !== 'false';
  if (mode === 'off') {
    return {
      clean: true,
      skipped: true,
      mode: 'off',
      detail: 'Virus-Scan deaktiviert',
    };
  }

  if (mode !== 'command') {
    return {
      clean: true,
      skipped: true,
      mode,
      detail: 'Unbekannter Scan-Modus, wird übersprungen',
    };
  }

  const commandTemplate = String(process.env.UPLOAD_VIRUS_SCAN_CMD || '').trim();
  if (!commandTemplate) {
    if (failOpen) {
      return {
        clean: true,
        skipped: true,
        mode: 'command',
        detail: 'Kein Scan-Command konfiguriert (fail-open)',
      };
    }
    return {
      clean: false,
      skipped: false,
      mode: 'command',
      detail: 'Kein Scan-Command konfiguriert',
    };
  }

  const timeoutMs = Number.parseInt(process.env.UPLOAD_VIRUS_SCAN_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS;
  try {
    const result = await runCommand(commandTemplate, filePath, timeoutMs);
    const suspiciousOutput = `${result.stdout}\n${result.stderr}`.toLowerCase();
    const looksInfected = suspiciousOutput.includes('infected')
      || suspiciousOutput.includes('virus')
      || suspiciousOutput.includes('malware');

    if (result.timedOut) {
      if (failOpen) {
        logInfo('virus_scan.timeout_fail_open', { timeoutMs });
        return {
          clean: true,
          skipped: true,
          mode: 'command',
          detail: 'Virus-Scan Timeout (fail-open)',
        };
      }
      return {
        clean: false,
        skipped: false,
        mode: 'command',
        detail: 'Virus-Scan Timeout',
      };
    }

    if (result.code === 0 && !looksInfected) {
      return {
        clean: true,
        skipped: false,
        mode: 'command',
        detail: result.stdout || 'OK',
      };
    }

    return {
      clean: false,
      skipped: false,
      mode: 'command',
      detail: result.stderr || result.stdout || `Exit-Code ${result.code}`,
    };
  } catch (error) {
    logError('virus_scan.command_failed', error);
    if (failOpen) {
      return {
        clean: true,
        skipped: true,
        mode: 'command',
        detail: 'Virus-Scan Fehler (fail-open)',
      };
    }
    return {
      clean: false,
      skipped: false,
      mode: 'command',
      detail: 'Virus-Scan Fehler',
    };
  }
}
