#!/usr/bin/env node
// Serves dist/ and loads it in headless Chromium over the DevTools protocol, then prints the
// JSON that the app renders into <pre id="report">. Zero dependencies: Node >= 22 (global WebSocket).
//
//   npm run build && npm run -s selftest > report.json
//
// Exits 1 when the page reports an error or #report never appears. Set CHROME_BIN to pick a browser.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', 'dist', 'rx-signals-fixture', 'browser');
const REPORT_TIMEOUT_MS = 30_000;
const BROWSER_NAMES = [
  'chromium',
  'chromium-browser',
  'google-chrome',
  'google-chrome-stable',
  'chrome',
];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const fail = message => {
  process.stderr.write(`selftest: ${message}\n`);
  process.exitCode = 1;
};

const findBrowser = () => {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    for (const name of BROWSER_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
};

const serveDist = () =>
  new Promise(resolveServer => {
    const server = createServer((req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
      let file = join(ROOT, path);
      // Unknown paths fall back to index.html so Angular routes resolve.
      if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
        file = join(ROOT, 'index.html');
      }
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolveServer(server));
  });

const launchBrowser = (binary, profileDir) =>
  new Promise((resolveLaunch, rejectLaunch) => {
    const proc = spawn(
      binary,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${profileDir}`,
        ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    proc.stderr.on('data', chunk => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolveLaunch({ proc, wsUrl: match[1] });
    });
    proc.on('exit', code => rejectLaunch(new Error(`browser exited (${code}):\n${stderr}`)));
  });

/** Minimal CDP client over one browser-level WebSocket with flattened target sessions. */
const connectCdp = wsUrl =>
  new Promise((resolveCdp, rejectCdp) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const listeners = [];
    let nextId = 1;
    ws.addEventListener('message', ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.id && pending.has(msg.id)) {
        const { resolveCall, rejectCall } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rejectCall(new Error(msg.error.message)) : resolveCall(msg.result);
      } else if (msg.method) {
        listeners.forEach(listener => listener(msg));
      }
    });
    ws.addEventListener('error', () => rejectCdp(new Error(`cannot connect to ${wsUrl}`)));
    ws.addEventListener('open', () =>
      resolveCdp({
        send: (method, params = {}, sessionId) =>
          new Promise((resolveCall, rejectCall) => {
            const id = nextId++;
            pending.set(id, { resolveCall, rejectCall });
            ws.send(JSON.stringify({ id, method, params, sessionId }));
          }),
        onEvent: listener => listeners.push(listener),
        close: () => ws.close(),
      }),
    );
  });

const readReport = async (cdp, sessionId) => {
  const deadline = Date.now() + REPORT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { result } = await cdp.send(
      'Runtime.evaluate',
      { expression: "document.querySelector('#report')?.textContent ?? null", returnByValue: true },
      sessionId,
    );
    if (typeof result.value === 'string') return result.value;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`#report did not appear within ${REPORT_TIMEOUT_MS} ms`);
};

const main = async () => {
  if (!existsSync(join(ROOT, 'index.html'))) {
    return fail(`no build at ${ROOT}; run npm run build first`);
  }
  const binary = findBrowser();
  if (!binary) {
    return fail(`no browser found on PATH (${BROWSER_NAMES.join(', ')}); set CHROME_BIN`);
  }

  const server = await serveDist();
  const profileDir = mkdtempSync(join(tmpdir(), 'rxs-selftest-'));
  let browser;
  let cdp;
  try {
    browser = await launchBrowser(binary, profileDir);
    cdp = await connectCdp(browser.wsUrl);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

    cdp.onEvent(msg => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.exceptionThrown') {
        process.stderr.write(
          `page exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}\n`,
        );
      } else if (
        msg.method === 'Runtime.consoleAPICalled' &&
        ['error', 'warning'].includes(msg.params.type)
      ) {
        process.stderr.write(
          `page console.${msg.params.type}: ${msg.params.args.map(a => a.value ?? a.description).join(' ')}\n`,
        );
      }
    });
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send(
      'Page.navigate',
      { url: `http://127.0.0.1:${server.address().port}/` },
      sessionId,
    );

    const text = await readReport(cdp, sessionId);
    const report = JSON.parse(text);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if ('error' in report) fail(`page reported error: ${report.error}`);
  } finally {
    cdp?.close();
    browser?.proc.kill();
    server.close();
    // Chromium may still hold profile files for a moment after kill.
    setTimeout(() => rmSync(profileDir, { recursive: true, force: true }), 200);
  }
};

main().catch(error => fail(error.stack ?? String(error)));
