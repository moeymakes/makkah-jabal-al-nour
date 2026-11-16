// dev-only: load dev.html headless and evaluate an expression against window.__w
import { chromium } from 'playwright-core';
import path from 'node:path';
const [file, expr] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', ignoreDefaultArgs: true,
  args: ['--remote-debugging-pipe', '--no-first-run', '--headless=new', '--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--user-data-dir=/tmp/claude-1000/probe-profile', 'about:blank'] });
const page = await (browser.contexts()[0] || await browser.newContext()).newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('ERR', m.text().slice(0, 300)); });
await page.goto('file://' + path.resolve(file) + '#capture');
await page.waitForTimeout(+process.env.WAIT || 40000);
console.log(JSON.stringify(await page.evaluate(expr), null, 0));
await browser.close();
