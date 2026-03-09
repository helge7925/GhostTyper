import { spawn } from 'child_process';
import { logError, logInfo } from './observability';

const DEFAULT_TIMEOUT_MS = 20_000;

function normalizeMode(rawMode) {
  const mode = String(rawMode || '').trim().toLowerCase();
  if (['off', 'disabled', 'none'].includes(mode)) return 'off';
  if (['command', 'cmd'].includes(mode)) return 'command';
  if (process.env.UPLOAD_VIRUS_SCAN_CMD) return 'command';
  // In Produktion standardmäßig aktiv (fail-closed, falls kein Command konfiguriert).
  return process.env.NODE_ENV === 'production' ? 'command' : 'off';
}

function runCommand(command, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
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
  });
}

export async function scanFileForViruses(filePath) {
  const mode = normalizeMode(process.env.UPLOAD_VIRUS_SCAN_MODE);
  const failOpenDefault = process.env.NODE_ENV === 'production' ? 'false' : 'true';
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

  const quotedPath = JSON.stringify(filePath);
  const command = commandTemplate.includes('{file}')
    ? commandTemplate.replaceAll('{file}', quotedPath)
    : `${commandTemplate} ${quotedPath}`;
  const timeoutMs = Number.parseInt(process.env.UPLOAD_VIRUS_SCAN_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS;
  try {
    const result = await runCommand(command, timeoutMs);
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
