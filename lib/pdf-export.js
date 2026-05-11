import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { readFile, unlink, writeFile } from 'fs/promises';
import { existsSync, accessSync, constants as fsConstants } from 'fs';
import os from 'os';
import path from 'path';
import {
  buildPdfPrintStyles,
  normalizePdfFontPreset,
  normalizePdfTheme,
} from './pdf-print-style';

const DEFAULT_TIMEOUT_MS = 20_000;

function createRendererError(code, details = '') {
  const normalizedDetails = String(details || '').trim().replace(/\s+/g, ' ').slice(0, 400);
  const suffix = normalizedDetails ? `:${normalizedDetails}` : '';
  return new Error(`${code}${suffix}`);
}

function shouldDisableChromiumSandbox() {
  return process.env.PDF_CHROMIUM_NO_SANDBOX === 'true';
}

function isExecutable(filePath) {
  if (!filePath || !existsSync(filePath)) return false;
  try {
    accessSync(filePath, fsConstants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function findExecutableInPath(binaryName) {
  const pathEnv = process.env.PATH || '';
  if (!pathEnv) return null;
  const separator = process.platform === 'win32' ? ';' : ':';
  const directories = pathEnv.split(separator).filter(Boolean);

  for (const dir of directories) {
    const candidate = path.join(dir, binaryName);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveChromiumPath() {
  // First check environment variable
  if (process.env.PDF_CHROMIUM_PATH) {
    if (isExecutable(process.env.PDF_CHROMIUM_PATH)) {
      console.log(`[PDF Export] Using Chromium from PDF_CHROMIUM_PATH: ${process.env.PDF_CHROMIUM_PATH}`);
      return process.env.PDF_CHROMIUM_PATH;
    }
    console.warn(`[PDF Export] PDF_CHROMIUM_PATH is set but not executable: ${process.env.PDF_CHROMIUM_PATH}`);
  }

  // Platform-specific paths
  const platform = process.platform;
  
  if (platform === 'darwin') {
    // macOS paths
    const macPaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/usr/local/bin/chromium',
      '/opt/homebrew/bin/chromium',
    ];
    const macMatch = macPaths.find((candidate) => isExecutable(candidate));
    if (macMatch) {
      console.log(`[PDF Export] Found Chromium on macOS: ${macMatch}`);
      return macMatch;
    }
  }

  // Linux paths
  const absoluteCandidates = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
    '/usr/lib/chromium/chromium',
    '/usr/lib/chromium-browser/chromium-browser',
  ];

  const absoluteMatch = absoluteCandidates.find((candidate) => isExecutable(candidate));
  if (absoluteMatch) {
    console.log(`[PDF Export] Found Chromium at: ${absoluteMatch}`);
    return absoluteMatch;
  }

  // Search in PATH
  const pathCandidates = [
    'google-chrome-stable',
    'google-chrome',
    'chromium-browser',
    'chromium',
    'chrome',
  ];

  for (const binary of pathCandidates) {
    const resolved = findExecutableInPath(binary);
    if (resolved) {
      console.log(`[PDF Export] Found Chromium in PATH: ${resolved}`);
      return resolved;
    }
  }

  console.error('[PDF Export] No Chromium/Chrome executable found in common locations or PATH');
  return null;
}

function sanitizePrintHtml(html) {
  if (!html) return '';

  // Strip executable payloads and active content from user-provided markup.
  return String(html)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<(object|embed|form|input|button|textarea|select|meta|link|base)[\s\S]*?>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(object|embed|form|input|button|textarea|select|meta|link|base)([^>]*)\/?>/gi, '')
    .replace(/\s(srcdoc|formaction)\s*=\s*(['"]).*?\2/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s(href|src)\s*=\s*(['"])\s*(javascript:|data:text\/html)/gi, ' $1=$2#');
}

function createPrintDocument(rawHtml, options = {}) {
  const safeHtml = sanitizePrintHtml(rawHtml);
  const theme = normalizePdfTheme(options.theme);
  const fontPreset = normalizePdfFontPreset(options.fontPreset);
  const printStyles = buildPdfPrintStyles({ theme, fontPreset });

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; img-src data: https:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src data: https://fonts.gstatic.com;" />
    <meta name="referrer" content="no-referrer" />
    <style>${printStyles}</style>
  </head>
  <body>
    <main id="print-root">${safeHtml}</main>
  </body>
</html>`;
}

function runChromiumPdfOnce(inputHtmlPath, outputPdfPath, timeoutMs, options = {}) {
  const headlessMode = options.headlessMode || 'new';
  const disableSandbox = Boolean(options.disableSandbox);
  const chromiumPath = resolveChromiumPath();
  if (!chromiumPath) {
    throw createRendererError('PDF_RENDERER_UNAVAILABLE', 'No Chromium/Chrome executable found. Set PDF_CHROMIUM_PATH.');
  }

  return new Promise((resolve, reject) => {
    const headlessFlag = headlessMode === 'legacy' ? '--headless' : '--headless=new';
    const args = [
      headlessFlag,
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--metrics-recording-only',
      '--no-pdf-header-footer',
      `--print-to-pdf=${outputPdfPath}`,
      `file://${inputHtmlPath}`,
    ];
    if (disableSandbox) {
      args.unshift('--no-sandbox');
      args.unshift('--disable-setuid-sandbox');
    }

    let stderrBuffer = '';
    const child = spawn(chromiumPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderrBuffer += String(chunk || '');
      });
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('PDF_RENDER_TIMEOUT'));
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      if (error.code === 'ENOENT' || error.code === 'EACCES') {
        const err = createRendererError('PDF_RENDERER_UNAVAILABLE', `${error.code || 'SPAWN_ERROR'} ${chromiumPath}`);
        err.cause = error;
        reject(err);
        return;
      }
      reject(createRendererError('PDF_RENDER_SPAWN_FAILED', error.message));
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(createRendererError('PDF_RENDER_FAILED', `exit=${code}; mode=${headlessMode}; sandbox=${disableSandbox ? 'off' : 'on'}; ${stderrBuffer}`));
    });
  });
}

function isSandboxFailure(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('failed to move to new namespace')
    || message.includes('zygote_host_impl_linux')
    || message.includes('no usable sandbox')
    || message.includes('operation not permitted');
}

async function runChromiumPdf(inputHtmlPath, outputPdfPath, timeoutMs) {
  // SECURITY: Sandbox-Mode is operator-controlled (PDF_CHROMIUM_NO_SANDBOX).
  // We do NOT auto-fall back to --no-sandbox on sandbox failure: a silent
  // downgrade would convert a renderer-RCE pre-condition into a deployment
  // surprise. If the sandbox cannot start, fail loud — the operator must
  // either fix the container caps or opt in explicitly.
  const disableSandbox = shouldDisableChromiumSandbox();

  try {
    await runChromiumPdfOnce(inputHtmlPath, outputPdfPath, timeoutMs, {
      headlessMode: 'new',
      disableSandbox,
    });
  } catch (error) {
    // Some Chromium builds fail on --headless=new but succeed with --headless.
    // This retry preserves the same sandbox decision; only the headless mode
    // differs. We do NOT silently disable the sandbox here.
    if (error?.message?.startsWith('PDF_RENDER_FAILED:')) {
      await runChromiumPdfOnce(inputHtmlPath, outputPdfPath, timeoutMs, {
        headlessMode: 'legacy',
        disableSandbox,
      });
      return;
    }
    if (isSandboxFailure(error) && !disableSandbox) {
      // Surface a clear error so operations can either grant the missing
      // capabilities or set PDF_CHROMIUM_NO_SANDBOX=true *consciously*.
      throw new Error(
        'PDF_RENDERER_SANDBOX_UNAVAILABLE: Chromium sandbox could not start. '
        + 'Either grant the container the required namespace/seccomp permissions, '
        + 'or set PDF_CHROMIUM_NO_SANDBOX=true to opt out of the sandbox '
        + '(NOT recommended in production).'
      );
    }
    throw error;
  }
}

export async function renderPdfBufferFromHtml(rawHtml, options = {}) {
  const html = createPrintDocument(rawHtml, options);
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;

  const base = randomUUID();
  const htmlPath = path.join(os.tmpdir(), `${base}.html`);
  const pdfPath = path.join(os.tmpdir(), `${base}.pdf`);

  try {
    await writeFile(htmlPath, html, 'utf8');
    await runChromiumPdf(htmlPath, pdfPath, timeoutMs);
    return await readFile(pdfPath);
  } finally {
    await unlink(htmlPath).catch(() => {});
    await unlink(pdfPath).catch(() => {});
  }
}
