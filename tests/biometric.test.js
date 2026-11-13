/**
 * Touch ID tests — what a disabled credential can and cannot do, against a
 * stand-in authenticator (one fixed PRF output per credential, as a real
 * passkey gives for a fixed salt).
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { authenticateBiometric, rewrapBiometric } from '../src/biometric.js';

const PASSPHRASE = 'plum-orbit-candle-seventeen';
const DISABLED = { mode: 'prf', credentialId: 'Y3JlZA==', prfSalt: 'c2FsdA==', disabled: true };

let prompts;
let prfOutput;
const credentials = {
    async get() {
        prompts++;
        return { getClientExtensionResults: () => ({ prf: { results: { first: prfOutput.buffer } } }) };
    },
};
if (globalThis.navigator) Object.defineProperty(globalThis.navigator, 'credentials', { value: credentials, configurable: true });
else globalThis.navigator = { credentials };

beforeEach(() => {
    prompts = 0;
    prfOutput = new Uint8Array(32).fill(7);
});

test('a disabled credential holds nothing to unlock with, and is refused before any Touch ID prompt', async () => {
    await assert.rejects(authenticateBiometric(DISABLED), /disabled/);
    assert.equal(prompts, 0);
});

test('re-enabling wraps the supplied passphrase under the same passkey', async () => {
    const data = await rewrapBiometric(DISABLED, PASSPHRASE);

    assert.equal(prompts, 1);
    assert.equal(data.credentialId, DISABLED.credentialId, 'same passkey: no orphan left in the OS');
    assert.equal(data.prfSalt, DISABLED.prfSalt);
    assert.equal(data.disabled, undefined);
    assert.ok(!JSON.stringify(data).includes(PASSPHRASE));
    assert.equal(await authenticateBiometric(data), PASSPHRASE);
});

test('a different passkey cannot open what was wrapped', async () => {
    const data = await rewrapBiometric(DISABLED, PASSPHRASE);
    prfOutput = new Uint8Array(32).fill(8);
    await assert.rejects(authenticateBiometric(data));
});
