import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, expect, type Page } from '@playwright/test';
import { botSchema, botDetailSchema, routineSchema, snapshotSchema } from '../src/domain';

const bot = botSchema.parse({
  id: 'default',
  name: 'Hermes',
  role: 'Help with research.',
  color: 'blue',
  createdAt: '2026-10-25T00:00:00Z',
  provider: { kind: 'claude', model: 'fixture' },
});
const state = snapshotSchema.parse({
  bots: [bot],
  groups: [],
  running: [],
  runtime: { available: true, version: 'fixture', error: null, scheduler: true },
});
const detail = botDetailSchema.parse({
  memory: '',
  userMemory: '',
  skills: [],
  files: [],
  secrets: [],
  messages: [],
  sessions: [],
  routines: [
    routineSchema.parse({ id: 'brief', name: 'Morning brief', updatePreferenceAvailable: true }),
  ],
  routineOutputs: [],
  activity: [],
  routineError: null,
});

async function settleFrames(page: Page) {
  await page.evaluate(`new Promise(resolve => {
    let remaining = 8;
    const next = () => --remaining ? requestAnimationFrame(next) : resolve();
    requestAnimationFrame(next);
  })`);
}

test('contextual routine drafts keep DOM focus after sheet cleanup and request native composer focus explicitly', async () => {
  const bundle = await build({
    stdin: {
      contents:
        "import { createRoot } from 'react-dom/client'; import { App } from './src/App'; createRoot(document.getElementById('root')).render(<App />);",
      resolveDir: path.resolve('.'),
      loader: 'tsx',
    },
    bundle: true,
    jsx: 'automatic',
    write: false,
    format: 'esm',
    loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"test"' },
  });
  const browser = await chromium.launch();
  try {
    for (const native of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
      const writes: string[] = [];
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('https://routine-focus.invalid/**', async (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() !== 'GET') writes.push(url.pathname);
        if (url.pathname === '/') {
          await route.fulfill({
            contentType: 'text/html',
            body: '<html><body><div id="root"></div></body></html>',
          });
          return;
        }
        await route.fulfill({ json: url.pathname === '/api/state' ? state : detail });
      });
      await page.goto('https://routine-focus.invalid/');
      await page.addStyleTag({ content: fs.readFileSync('src/style.css', 'utf8') });
      await page.addScriptTag({
        content: `
        window.EventSource = class { onmessage = null; close() {} };
        ${
          native
            ? `
          window.focusPresentations = [];
          window.hermesNativeControls = {
            present: async (state) => {
              window.focusPresentations.push(state);
              return { active: true };
            },
            hide: async () => {},
            onAction: async () => () => {},
          };
        `
            : ''
        }
      `,
      });
      await page.addScriptTag({ type: 'module', content: bundle.outputFiles[0].text });
      const composer = page.locator('.composer textarea');
      await expect(composer).toBeVisible();
      await composer.fill('Keep my existing draft.');
      const openDetails = page.getByRole('button', { name: 'Show Bot details', exact: true });
      await openDetails.click();
      await expect(page.getByRole('dialog', { name: 'Bot details', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Close details', exact: true }).click();
      await settleFrames(page);
      await expect(openDetails).toBeFocused();
      if (native)
        assert.equal(
          await page.evaluate('window.focusPresentations.some(p => p.composer.focusRequest > 0)'),
          false,
        );

      await openDetails.click();
      await page.locator('.routine-preview').click();
      await page.getByRole('button', { name: 'Choose which updates matter…', exact: true }).click();
      await settleFrames(page);
      await expect(page.locator('.details-panel')).toHaveCount(0);
      await expect(composer).toHaveValue(
        'Keep my existing draft.\n\nFor my "Morning brief" routine, only update me when…',
      );
      if (!native) await expect(composer).toBeFocused();
      else {
        const requests = await page.evaluate(
          () =>
            (
              window as unknown as {
                focusPresentations: Array<{
                  visible: boolean;
                  navigation: { avatarColor?: string; group?: boolean };
                  composer: { visible: boolean; focusRequest?: number; draft: string };
                }>;
              }
            ).focusPresentations,
        );
        assert.ok(
          requests.some(
            (p) =>
              p.visible &&
              p.composer.visible &&
              p.composer.focusRequest === 1 &&
              p.composer.draft.endsWith('only update me when…'),
          ),
        );
        assert.ok(
          requests
            .filter((p) => p.visible)
            .every((p) => p.navigation.avatarColor === bot.color && p.navigation.group === false),
        );
        assert.ok(
          requests
            .filter((p) => p.composer.focusRequest)
            .every((p) => p.composer.focusRequest === 1),
        );
      }
      assert.deepEqual(writes, []);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
