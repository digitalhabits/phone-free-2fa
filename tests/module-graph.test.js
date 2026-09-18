/**
 * popup.js and biometric-tab.js need a DOM, so they can't be imported under
 * Node. This checks what would otherwise only fail in the browser: every
 * name imported between src/ modules is really exported, every imported
 * name is used, and every file the HTML and manifest refer to exists.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const SRC = new URL('../src/', import.meta.url);
const read = (name) => readFileSync(new URL(name, SRC), 'utf8');
const modules = readdirSync(SRC).filter(f => f.endsWith('.js'));

function exportsOf(file) {
    const code = read(file);
    const names = new Set();
    for (const [, name] of code.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)) names.add(name);
    if (/^export default\b/m.test(code)) names.add('default');
    return names;
}

test('every import between src/ modules names something that is exported, and is used', () => {
    let checked = 0;
    for (const file of modules) {
        const code = read(file);
        for (const [statement, named, defaultName, target] of code.matchAll(/^import\s+(?:\{([^}]*)\}|(\w+))\s+from\s+'\.\/([\w.-]+)';?$/gm)) {
            assert.ok(existsSync(new URL(target, SRC)), `${file}: ${target} does not exist`);
            const available = exportsOf(target);
            const names = named ? named.split(',').map(n => n.trim()).filter(Boolean) : [];
            if (defaultName) assert.ok(available.has('default'), `${file}: ${target} has no default export`);
            const rest = code.replace(statement, '');
            for (const name of names) {
                const [exported, local = exported] = name.split(/\s+as\s+/);
                assert.ok(available.has(exported), `${file}: '${exported}' is not exported by ${target}`);
                assert.ok(new RegExp(`\\b${local}\\b`).test(rest), `${file}: '${local}' is imported from ${target} but never used`);
                checked++;
            }
        }
        // Dynamic imports were only used to reach crypto.js from the UI; keep it that way.
        assert.ok(!/\bimport\s*\(/.test(code), `${file}: no dynamic import()`);
    }
    assert.ok(checked > 30, `only ${checked} imports checked — has the import style changed?`);
});

test('every script, stylesheet and image the pages refer to is in the package', () => {
    for (const page of readdirSync(SRC).filter(f => f.endsWith('.html'))) {
        for (const [, path] of read(page).matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)="([^"]+)"/g)) {
            assert.ok(existsSync(new URL(path, SRC)), `${page}: ${path} is missing`);
        }
    }
});

test('every file the manifest refers to is in the package', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const paths = [
        ...Object.values(manifest.icons),
        ...Object.values(manifest.action.default_icon),
        manifest.side_panel.default_path,
        manifest.sidebar_action.default_panel,
        ...Object.values(manifest.sidebar_action.default_icon),
        manifest.background.service_worker,
        ...manifest.background.scripts,
    ];
    for (const path of paths) assert.ok(existsSync(new URL(path, SRC)), `${path} is missing`);
});

test('every element id popup.js looks up exists in popup.html', () => {
    const html = read('popup.html');
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
    for (const [, id] of read('popup.js').matchAll(/\$\('([^']+)'\)/g)) {
        assert.ok(ids.has(id), `popup.js looks up #${id}, which is not in popup.html`);
    }
});
