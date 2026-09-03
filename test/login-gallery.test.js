import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

test('login gallery renders ten responsive rows with accessible zoom controls', async () => {
  const [html, css, script] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/login-gallery.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/login-gallery.js', import.meta.url), 'utf8')
  ]);
  assert.equal((html.match(/class="login-gallery-item"/g) ?? []).length, 10);
  assert.equal((html.match(/loading="eager" decoding="async"/g) ?? []).length, 10);
  assert.equal((html.match(/width="\d+" height="\d+"/g) ?? []).length, 10);
  assert.doesNotMatch(html, /loading="lazy"/);
  assert.match(html, /03-cultural-celebration\.jpg/);
  assert.doesNotMatch(html, /03-school-activity\.png/);
  assert.ok(html.indexOf('id="login-gallery"') > html.indexOf('class="portal-grid"'));
  assert.match(css, /grid-template-rows:repeat\(10/);
  assert.match(css, /width:min\(1120px/);
  assert.match(css, /@media\(max-width:759px\)/);
  assert.match(css, /position:fixed/);
  assert.match(script, /addEventListener\('dblclick'/);
  assert.match(script, /addEventListener\('touchend'/);
  for (let number = 1; number <= 10; number += 1) {
    const source = html.match(new RegExp(`src="([^"]*login-gallery\\/${String(number).padStart(2, '0')}-[^"]+)"`))?.[1];
    assert.ok(source, `gallery row ${number} has an image`);
    await access(new URL(`../public${source}`, import.meta.url));
  }
});
