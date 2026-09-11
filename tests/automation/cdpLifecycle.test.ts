import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { chromium, type BrowserContext } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TistoryBlogAutomation } from '../../src/automation/TistoryBlogAutomation';

// Opt-in: real, isolated Chrome; no login, live blog, or production CDP port.
describe.skipIf(process.env.TISTORY_BROWSER_TESTS !== '1')('real Chrome CDP lifecycle', () => {
  let context: BrowserContext | undefined;
  let server: Server | undefined;
  let profile = '';
  let endpoint = '';
  let blogUrl = '';
  const bundle = path.resolve('dist-cli/cdpLifecycleTest.js');

  beforeAll(async () => {
    await build({ entryPoints: ['tests/fixtures/cdpCli.ts'], bundle: true,
      platform: 'node', format: 'esm', external: ['playwright', 'google-auth-library'], outfile: bundle });
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'tistory-cdp-test-'));
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome', headless: true, args: ['--remote-debugging-port=0']
    });
    const port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    endpoint = `http://127.0.0.1:${port}`;
    server = createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(req.url?.startsWith('/missing') ? '<input name="loginId">' : '<textarea id="post-title-inp"></textarea>');
    });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server port');
    blogUrl = `http://127.0.0.1:${address.port}`;
  }, 30_000);

  afterAll(async () => {
    await context?.close();
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    if (profile) await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await fs.rm(bundle, { force: true });
  });

  it.each([['', 0], ['/missing', 1]] as const)('exits after verification %s and keeps Chrome alive', async (suffix, expectedCode) => {
    const result = await promisify(execFile)(process.execPath, [bundle, endpoint, blogUrl + suffix], { timeout: 8_000 })
      .then(value => ({ ...value, code: 0, killed: false }))
      .catch((error: { code: number; killed: boolean; stdout: string; stderr: string }) => error);
    expect(result.killed, result.stdout + result.stderr).toBe(false);
    expect(result.code, result.stderr).toBe(expectedCode);
    if (expectedCode === 0) expect(result.stdout).toContain('Login session verified');
    expect(context!.pages()[0]!.isClosed()).toBe(false);
    expect((await fetch(`${endpoint}/json/version`)).ok).toBe(true);
  }, 12_000);

  it('saves promptly when the optional draft counter is absent', async () => {
    const page = context!.pages()[0]!;
    await page.setContent(`<button onclick="document.querySelector('[role=alert]').hidden=false">임시저장</button>
      <div role="alert" hidden>저장 완료</div>`);
    page.setDefaultTimeout(2_000);
    const engine = TistoryBlogAutomation.attach(endpoint, blogUrl);
    const started = performance.now();
    const result = await engine.finalizePost(page, { parsed: { metadata: { publication: 'draft', scheduledAt: null } } } as never);
    expect(result.outcome).toBe('confirmed');
    expect(performance.now() - started).toBeLessThan(1_500);
  }, 10_000);
});
