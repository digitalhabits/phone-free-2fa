/**
 * Guards on the manifest — the claims the README makes about what the
 * shipped extension is allowed to do. These are properties of a small,
 * rarely-changing JSON file, so a change that widens the attack surface
 * fails here and has to be made on purpose.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../src/manifest.json', import.meta.url), 'utf8'));

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
