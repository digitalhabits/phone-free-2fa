/**
 * Passphrase policy tests — one rule set for the master passphrase and the
 * backup password.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateNewPassphrase, checkPassphraseStrength, MIN_PASSPHRASE_LENGTH } from '../src/passphrase-strength.js';

test('minimum length is 12', () => {
    assert.equal(MIN_PASSPHRASE_LENGTH, 12);
    assert.equal(validateNewPassphrase('').reason, 'too-short');
    assert.equal(validateNewPassphrase('plum-orbit8').reason, 'too-short'); // 11
    assert.equal(validateNewPassphrase('plum-orbit88').ok, true); // 12
});

test('the example phrases from the setup tips are refused, however they are typed', () => {
    for (const p of [
        'correct-horse-battery-staple',
        '  Correct-Horse-Battery-Staple ',
        'My dog loves chasing squirrels in the park!',
    ]) {
        assert.equal(validateNewPassphrase(p).reason, 'example', p);
    }
});

test('12+ character passwords that are still weak are refused, with a message', () => {
    const weak = [
        'aaaaaaaaaaaa',          // no variety
        'abababababab',          // no variety
        'abcdabcdabcdabcd',      // repeated block
        'hello1111world',        // repeated character
        'qwertyuiop123',         // keyboard walk
        'my1234567secret',       // keyboard walk inside
        'mypassword2026',        // contains "password"
        'MyP@ssw0rd!2026',       // … also in leet-speak
    ];
    for (const p of weak) {
        const result = validateNewPassphrase(p);
        assert.equal(result.ok, false, p);
        assert.equal(result.reason, 'weak', p);
        assert.ok(result.message.length > 0, p);
        assert.equal(checkPassphraseStrength(p).ok, false, p);
    }
});

test('reasonable passphrases pass', () => {
    for (const p of [
        'plum-orbit-candle-seventeen',
        'Walnut harbour lantern 90!',
        'gul sykkel danser i regnet',
        'xK9#mQ2$vL7@nR4',
    ]) {
        assert.deepEqual(validateNewPassphrase(p), { ok: true }, p);
    }
});

// Guard against the rules drifting apart again: the UI must not grow its own
// length checks or call the strength heuristics directly.
test('popup.js uses validateNewPassphrase for setup, change-passphrase and export — and nothing else', () => {
    const popup = readFileSync(new URL('../src/popup.js', import.meta.url), 'utf8');
    assert.equal((popup.match(/validateNewPassphrase\(/g) || []).length, 5,
        'expected: strength meter, setup validation, setup submit, change passphrase, export');
    assert.ok(!popup.includes('checkPassphraseStrength'), 'popup.js must not call the heuristics directly');
    assert.ok(!/\.length\s*<\s*\d+/.test(popup), 'popup.js must not hard-code a minimum length');

    const bodyOf = (name) => {
        const start = popup.indexOf(`async function ${name}(`);
        assert.ok(start >= 0, `${name} not found`);
        return popup.slice(start, popup.indexOf('\nasync function ', start + 1));
    };
    for (const fn of ['handleSetup', 'handleChangePassphrase', 'handleExport']) {
        assert.ok(bodyOf(fn).includes('validateNewPassphrase('), `${fn} must apply the policy`);
    }
});
