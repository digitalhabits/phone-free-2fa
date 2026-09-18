/**
 * Storage manager tests — vault lifecycle against an in-memory
 * browser.storage.local.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeBrowser } from './helpers/fake-browser.js';

// Must be installed before storage.js (→ browser.js) is first imported.
const fake = installFakeBrowser();
const storage = await import('../src/storage.js');

const PASSPHRASE = 'plum-orbit-candle-seventeen';
const ACCOUNTS = [
    { id: 'a1', issuer: 'Example', accountName: 'alice', secret: 'JBSWY3DPEHPK3PXPJBSWY3DP', algorithm: 'SHA1', digits: 6, period: 30 },
    { id: 'a2', issuer: 'Bank', accountName: 'alice', secret: 'KRSXG5CTMVRXEZLUKRSXG5CT', algorithm: 'SHA256', digits: 8, period: 60 },
];

beforeEach(() => fake.reset());

test('first launch → setup → unlock → save → load', async () => {
    assert.equal(await storage.isFirstLaunch(), true);

    const key = await storage.setupPassphrase(PASSPHRASE);
    assert.equal(await storage.isFirstLaunch(), false);
    assert.equal(await storage.hasData(), true);
    assert.deepEqual(await storage.loadAccounts(key), []);

    await storage.saveAccounts(ACCOUNTS, key);

    const unlockedKey = await storage.unlockWithPassphrase(PASSPHRASE);
    assert.ok(unlockedKey);
    assert.deepEqual(await storage.loadAccounts(unlockedKey), ACCOUNTS);
});

test('unlock with a wrong passphrase returns null', async () => {
    await storage.setupPassphrase(PASSPHRASE);
    assert.equal(await storage.unlockWithPassphrase('wrong-passphrase-entirely'), null);
});

test('nothing secret is stored in plaintext', async () => {
    const key = await storage.setupPassphrase(PASSPHRASE);
    await storage.saveAccounts(ACCOUNTS, key);
    const raw = JSON.stringify(fake.dump());
    assert.ok(!raw.includes(PASSPHRASE));
    for (const a of ACCOUNTS) {
        assert.ok(!raw.includes(a.secret), 'secret must not appear in storage');
        assert.ok(!raw.includes(a.issuer), 'labels must not appear in storage');
    }
});

test('changePassphrase: new passphrase opens the vault, old one does not', async () => {
    const key = await storage.setupPassphrase(PASSPHRASE);
    await storage.saveAccounts(ACCOUNTS, key);

    const NEW = 'walnut-harbour-lantern-ninety';
    await storage.changePassphrase(ACCOUNTS, NEW);

    assert.equal(await storage.unlockWithPassphrase(PASSPHRASE), null);
    const newKey = await storage.unlockWithPassphrase(NEW);
    assert.ok(newKey);
    assert.deepEqual(await storage.loadAccounts(newKey), ACCOUNTS);
});

test('backup status: never → current → stale', async () => {
    assert.equal(await storage.getBackupStatus([]), 'current'); // nothing to back up
    assert.equal(await storage.getBackupStatus(ACCOUNTS), 'never');

    await storage.saveBackupFingerprint(ACCOUNTS);
    assert.equal(await storage.getBackupStatus(ACCOUNTS), 'current');

    const changed = [...ACCOUNTS, { ...ACCOUNTS[0], id: 'a3', secret: 'MFRGGZDFMZTWQ2LKMFRGGZDF' }];
    assert.equal(await storage.getBackupStatus(changed), 'stale');
});

test('lockout state persists and clears', async () => {
    assert.deepEqual(await storage.loadLockoutState(), { failedAttempts: 0, lockoutUntil: 0 });
    await storage.saveLockoutState({ failedAttempts: 4, lockoutUntil: 123456 });
    assert.deepEqual(await storage.loadLockoutState(), { failedAttempts: 4, lockoutUntil: 123456 });
    await storage.clearLockoutState();
    assert.deepEqual(await storage.loadLockoutState(), { failedAttempts: 0, lockoutUntil: 0 });
});
