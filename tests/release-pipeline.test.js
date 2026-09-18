/**
 * Guard tests for the release pipeline. A release can push code to every
 * user, so the rules that keep third-party code away from the store keys
 * are checked here, as text, and fail loudly if someone loosens them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');
const workflowNames = readdirSync(new URL('.github/workflows/', ROOT)).filter(f => /\.ya?ml$/.test(f));
const workflows = Object.fromEntries(workflowNames.map(f => [f, read(`.github/workflows/${f}`)]));

/** The text of one top-level job (2-space indented key under `jobs:`). */
function jobText(workflow, name) {
    const start = workflow.indexOf(`\n  ${name}:\n`);
    assert.ok(start >= 0, `job ${name} not found`);
    const rest = workflow.slice(start + 1);
    const next = rest.slice(1).search(/\n  [\w-]+:\n/);
    return next < 0 ? rest : rest.slice(0, next + 1);
}

test('every action is pinned to a full commit SHA and comes from GitHub itself', () => {
    let count = 0;
    for (const [file, text] of Object.entries(workflows)) {
        for (const [, ref] of text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
            count++;
            assert.match(ref, /^actions\/[\w-]+@[0-9a-f]{40}$/, `${file}: ${ref}`);
        }
    }
    assert.ok(count > 0);
});

test('no workflow fetches and runs unpinned code (npx, curl | sh, npm install)', () => {
    for (const [file, text] of Object.entries(workflows)) {
        const code = text.split('\n').filter(line => !line.trim().startsWith('#')).join('\n');
        assert.ok(!/\bnpx\b/.test(code), `${file}: npx resolves dependencies fresh on every run`);
        assert.ok(!/\bnpm (install|i|add)\b/.test(code), `${file}: use npm ci with the committed lockfile`);
        assert.ok(!/(curl|wget)[^\n]*\|\s*(ba)?sh/.test(code), `${file}: no piping downloads into a shell`);
        for (const [line] of code.matchAll(/^.*\bnpm ci\b.*$/gm)) {
            assert.ok(line.includes('--ignore-scripts'), `${file}: ${line.trim()}`);
        }
    }
});

test('workflows default to read-only permissions', () => {
    for (const [file, text] of Object.entries(workflows)) {
        assert.match(text, /^permissions:\n  contents: read\n/m, file);
    }
});

test('store credentials exist only in the approval-gated publish job', () => {
    const release = workflows['release.yml'];
    const publish = jobText(release, 'publish');
    const build = jobText(release, 'release');

    assert.match(publish, /^    environment: store-release$/m);
    assert.match(publish, /^    needs: release$/m);
    assert.ok(!/contents: write/.test(publish), 'publish job cannot write to the repo');
    assert.ok(!/secrets\./.test(build), 'release job must not see any secrets');

    for (const [file, text] of Object.entries(workflows)) {
        if (file !== 'release.yml') assert.ok(!/secrets\./.test(text), `${file} must not use secrets`);
    }
});

test('the publish job installs before the secrets appear, and publishes the verified release file', () => {
    const publish = jobText(workflows['release.yml'], 'publish');
    const install = publish.indexOf('npm ci --ignore-scripts');
    const verify = publish.indexOf('sha256sum --check');
    const firstSecret = publish.indexOf('secrets.');
    assert.ok(verify >= 0 && install >= 0 && firstSecret >= 0);
    assert.ok(verify < firstSecret && install < firstSecret, 'verify and install happen in steps without secrets');
});

test('the store publisher is pinned exactly, with a complete lockfile', () => {
    const pkg = JSON.parse(read('tools/publish/package.json'));
    for (const [name, version] of Object.entries(pkg.dependencies)) {
        assert.match(version, /^\d+\.\d+\.\d+$/, `${name} must be an exact version, not a range`);
    }
    const lock = JSON.parse(read('tools/publish/package-lock.json'));
    const packages = Object.entries(lock.packages).filter(([path]) => path !== '');
    assert.ok(packages.length > 0);
    for (const [path, info] of packages) {
        assert.match(info.integrity || '', /^sha512-/, `${path} has no integrity hash`);
        assert.ok((info.resolved || '').startsWith('https://registry.npmjs.org/'), `${path} is not from the npm registry`);
        assert.ok(!info.hasInstallScript, `${path} wants to run code at install time`);
    }
    assert.equal(lock.packages['node_modules/publish-browser-extension'].version, pkg.dependencies['publish-browser-extension']);
});

test('the extension itself and its tests have no dependencies at all', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.devDependencies, undefined);
});

test('dependabot watches the pinned actions and the publisher lockfile', () => {
    const dependabot = read('.github/dependabot.yml');
    assert.match(dependabot, /package-ecosystem: github-actions/);
    assert.match(dependabot, /package-ecosystem: npm\n\s+directory: \/tools\/publish/);
});
