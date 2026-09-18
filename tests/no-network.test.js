/**
 * Guard tests for the claims the README makes about the shipped extension:
 * minimal permissions, no network access, no remote or dynamic code, and no
 * user data written into the page as HTML. These read the source as text,
 * so a change that breaks a claim fails here and has to be made on purpose.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const SRC = new URL('../src/', import.meta.url);
const read = (name) => readFileSync(new URL(name, SRC), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const sourceFiles = readdirSync(SRC).filter(f => /\.(js|html|css)$/.test(f));

test('permissions are exactly storage + sidePanel, with no host access', () => {
    assert.deepEqual([...manifest.permissions].sort(), ['sidePanel', 'storage']);
    assert.equal(manifest.host_permissions, undefined);
    assert.equal(manifest.optional_permissions, undefined);
    assert.equal(manifest.optional_host_permissions, undefined);
});

test('no way in for web pages or other extensions', () => {
    assert.equal(manifest.content_scripts, undefined);
    assert.equal(manifest.web_accessible_resources, undefined);
    assert.equal(manifest.externally_connectable, undefined);
});

test('CSP: network access is blocked by the browser, scripts only from the package', () => {
    const csp = manifest.content_security_policy.extension_pages;
    const directives = Object.fromEntries(
        csp.split(';').map(d => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values])
    );
    assert.deepEqual(directives['connect-src'], ["'none'"]);
    assert.deepEqual(directives['script-src'], ["'self'"]);
    assert.deepEqual(directives['default-src'], ["'self'"]);
    assert.deepEqual(directives['object-src'], ["'none'"]);
    assert.deepEqual(directives['base-uri'], ["'none'"]);
    assert.deepEqual(directives['form-action'], ["'none'"]);
    assert.ok(!csp.includes('http'), 'no remote origins anywhere in the policy');
    assert.ok(!csp.includes('unsafe-eval'));
    assert.ok(!directives['script-src'].includes("'unsafe-inline'"));
});

test('no network or dynamic-code APIs anywhere in src/', () => {
    const banned = [
        /\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /\bEventSource\b/, /sendBeacon/,
        /\beval\s*\(/, /new\s+Function\b/, /importScripts/, /document\.write/,
        /insertAdjacentHTML/, /outerHTML/,
    ];
    for (const file of sourceFiles.filter(f => f.endsWith('.js'))) {
        const code = read(file);
        for (const pattern of banned) {
            assert.ok(!pattern.test(code), `${file} must not use ${pattern}`);
        }
    }
});

test('HTML pages load only packaged scripts and styles, and have no inline handlers', () => {
    for (const file of sourceFiles.filter(f => f.endsWith('.html'))) {
        const html = read(file);
        for (const [, attrs] of html.matchAll(/<script\b([^>]*)>/g)) {
            assert.match(attrs, /\bsrc="[\w.-]+\.js"/, `${file}: scripts must be packaged files`);
        }
        assert.ok(!/<script\b[^>]*>\s*\S[\s\S]*?<\/script>/.test(html), `${file}: no inline script bodies`);
        assert.ok(!/\son\w+\s*=/.test(html), `${file}: no inline event handlers`);
        // Links the user can click (<a href>) are fine; anything the page loads by itself is not.
        const withoutLinks = html.replace(/<a\b[^>]*>/g, '');
        assert.ok(!/(src|href)="(https?:)?\/\//.test(withoutLinks), `${file}: no remote resources`);
    }
});

test('stylesheets load nothing remote', () => {
    for (const file of sourceFiles.filter(f => f.endsWith('.css') || f.endsWith('.html'))) {
        const text = read(file);
        assert.ok(!/@import/.test(text), `${file}: no @import`);
        for (const [, target] of text.matchAll(/url\(\s*["']?([^"')]+)/g)) {
            assert.ok(target.startsWith('data:image/svg+xml,') || !/^(https?:)?\/\//.test(target), `${file}: url(${target.slice(0, 40)}…)`);
        }
    }
});

test('innerHTML is only ever assigned a built-in icon constant, never data', () => {
    for (const file of sourceFiles.filter(f => f.endsWith('.js'))) {
        const code = read(file);
        for (const [line] of code.matchAll(/^.*\binnerHTML\b.*$/gm)) {
            assert.match(
                line.trim(),
                /^\w+\.innerHTML = (\w+ \? )?[A-Z_]+_ICON( : [A-Z_]+_ICON)?;$/,
                `${file}: ${line.trim()}`
            );
        }
        // …and the icon constants themselves are static strings.
        for (const [, body] of code.matchAll(/const [A-Z_]+_ICON = `([^`]*)`/g)) {
            assert.ok(!body.includes('${'), `${file}: icon constants must not interpolate`);
        }
    }
});

test('no secrets in logs: console calls never mention passphrases, secrets or keys', () => {
    for (const file of sourceFiles.filter(f => f.endsWith('.js'))) {
        for (const [call] of read(file).matchAll(/console\.\w+\([^;]*\);/g)) {
            assert.ok(!/passphrase|secret|\bkey\b|accounts/i.test(call.replace(/'[^']*'/g, '')), `${file}: ${call}`);
        }
    }
});

test('the settings object has no leftover network-related options', () => {
    assert.ok(!read('storage.js').includes('fetchIcons'));
});
