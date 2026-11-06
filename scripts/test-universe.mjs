import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('preview-output', { recursive: true });
const server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], { stdio: 'ignore' });
const browser = await chromium.launch({ headless: true });
const watchdog = setTimeout(() => { console.error('Browser preview watchdog: exceeded 120 seconds'); process.exit(2); }, 120000);
watchdog.unref();
let failures = [];
try {
  await new Promise(resolve => setTimeout(resolve, 1000));
  for (const device of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport: { width: device.width, height: device.height }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(8000);
    console.log('Starting preview:', device.name);
    page.on('pageerror', err => failures.push(device.name + ': ' + err.message));
    await page.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.locator('h1').waitFor({ timeout: 10000 });
    assert.match(await page.title(), /Shattered Oaths/);
    assert.equal(new URL(page.url()).pathname, '/');
    await assert.equal(await page.locator('h1').count(), 1);
    await assert.equal(await page.locator('#characters .character').count(), 2);
    const portraitStatus = await page.evaluate(async () => {
      const paths = ['assets/kai-vex-portrait.webp', 'assets/selene-portrait.webp'];
      return Promise.all(paths.map(async path => ({path, ok: (await fetch(path)).ok})));
    });
    for (const image of portraitStatus) if (!image.ok) failures.push(device.name + ': portrait missing: ' + image.path);
    const portraitLayers = await page.evaluate(() => ({
      kai: getComputedStyle(document.querySelector('.hero-kai')).backgroundImage,
      selene: getComputedStyle(document.querySelector('.hero-selene')).backgroundImage,
      kaiDossier: getComputedStyle(document.querySelector('.character:first-child'), '::before').backgroundImage,
      seleneDossier: getComputedStyle(document.querySelector('.character:nth-child(2)'), '::before').backgroundImage
    }));
    for (const [key, layer] of Object.entries(portraitLayers)) {
      const expected = key.toLowerCase().includes('selene') ? 'selene-portrait.webp' : 'kai-vex-portrait.webp';
      if (!layer.includes(expected)) failures.push(device.name + ': portrait not applied to ' + key);
    }
    await page.screenshot({ path: 'preview-output/' + device.name + '.png', fullPage: true, animations: 'disabled', timeout: 20000 });
    console.log('Screenshot captured:', device.name);
    const missingImages = await page.evaluate(() => [...document.querySelectorAll('img')].filter(img => img.complete && img.naturalWidth === 0).map(img => img.getAttribute('src')));
    if (missingImages.length) failures.push(device.name + ': missing images: ' + missingImages.join(', '));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    if (overflow) failures.push(device.name + ': horizontal overflow');
    console.log('Testing interactions:', device.name);
    await page.locator('[data-location="apex"]').click({timeout:8000});
    assert.match(await page.locator('#map-info').innerText(), /Apex Headquarters/);
    await page.locator('#unlock').click();
    assert.equal(await page.locator('#unlock').getAttribute('aria-expanded'), 'true');
    await page.locator('[data-dossier="kai"]').click();
    assert.match(await page.locator('#dossier-detail').innerText(), /FUGITIVE 0167/);
    await page.locator('[data-dossier="selene"]').click();
    assert.match(await page.locator('#dossier-detail').innerText(), /AGENT 06/);
    await page.screenshot({ path: 'preview-output/' + device.name + '-interactions.png', fullPage: true, animations: 'disabled', timeout: 20000 });
    if (device.name === 'mobile') {
      await page.locator('.menu-toggle').click();
      assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'true');
      await page.locator('#primary-links a[href="#book"]').click();
      assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'false');
    }
    await page.close();
    console.log('Finished preview:', device.name);
  }
  assert.deepEqual(failures, [], failures.join('\n'));
  console.log('Desktop/mobile browser checks passed. Screenshots saved.');
} finally {
  await browser.close();
  server.kill();
  clearTimeout(watchdog);
}
