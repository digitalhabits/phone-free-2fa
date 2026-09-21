/**
 * Crypto module tests — key derivation, AES-GCM round-trip, tamper
 * detection, and the passphrase verifier.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSalt, deriveKey, encrypt, decrypt, createPassphraseHash, verifyPassphrase, passphraseForms } from '../src/crypto.js';

const PASSPHRASE = 'plum-orbit-candle-seventeen';

test('generateSalt returns 32 random bytes as Base64, different every time', () => {
    const a = generateSalt();
    const b = generateSalt();
    assert.equal(Buffer.from(a, 'base64').length, 32);
    assert.notEqual(a, b);
});

test('encrypt → decrypt round-trips, including non-ASCII text', async () => {
    const key = await deriveKey(PASSPHRASE, generateSalt());
    const plaintext = JSON.stringify({ label: 'Købmand ✓ 日本', secret: 'JBSWY3DPEHPK3PXP' });
    const { iv, ciphertext } = await encrypt(plaintext, key);
    assert.equal(await decrypt(iv, ciphertext, key), plaintext);
});

test('every encryption uses a fresh IV', async () => {
    const key = await deriveKey(PASSPHRASE, generateSalt());
    const a = await encrypt('same', key);
    const b = await encrypt('same', key);
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.ciphertext, b.ciphertext);
});

test('the same passphrase and salt derive the same key; a different salt does not', async () => {
    const salt = generateSalt();
    const { iv, ciphertext } = await encrypt('hello', await deriveKey(PASSPHRASE, salt));
    assert.equal(await decrypt(iv, ciphertext, await deriveKey(PASSPHRASE, salt)), 'hello');
    await assert.rejects(async () => decrypt(iv, ciphertext, await deriveKey(PASSPHRASE, generateSalt())));
});

test('decrypt rejects a wrong passphrase', async () => {
    const salt = generateSalt();
    const { iv, ciphertext } = await encrypt('hello', await deriveKey(PASSPHRASE, salt));
    await assert.rejects(async () => decrypt(iv, ciphertext, await deriveKey(PASSPHRASE + 'x', salt)));
});

test('decrypt rejects tampered ciphertext (AES-GCM authentication)', async () => {
    const key = await deriveKey(PASSPHRASE, generateSalt());
    const { iv, ciphertext } = await encrypt('hello world', key);
    const bytes = Buffer.from(ciphertext, 'base64');
    bytes[0] ^= 0x01;
    await assert.rejects(() => decrypt(iv, bytes.toString('base64'), key));
});

test('derived keys are not extractable', async () => {
    const key = await deriveKey(PASSPHRASE, generateSalt());
    assert.equal(key.extractable, false);
    await assert.rejects(() => crypto.subtle.exportKey('raw', key));
});

test('verifyPassphrase accepts the right passphrase only', async () => {
    const salt = generateSalt();
    const hash = await createPassphraseHash(PASSPHRASE, salt);
    assert.equal(await verifyPassphrase(PASSPHRASE, salt, hash), true);
    assert.equal(await verifyPassphrase(PASSPHRASE + ' ', salt, hash), false);
    assert.equal(await verifyPassphrase(PASSPHRASE, generateSalt(), hash), false);
});

// 'é' typed as one character (NFC) and as 'e' + combining acute (NFD).
const NFC = 'café-orbit-candle-seventeen';
const NFD = 'café-orbit-candle-seventeen';

test('passphraseForms tries NFC first, then the typed and NFD forms, without duplicates', () => {
    assert.notEqual(NFC, NFD);
    assert.deepEqual(passphraseForms(NFD), [NFC, NFD]);
    assert.deepEqual(passphraseForms(NFC), [NFC, NFD]);
    assert.deepEqual(passphraseForms(PASSPHRASE), [PASSPHRASE]);
});
