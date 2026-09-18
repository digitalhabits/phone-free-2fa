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

// A failed or interrupted write must never leave a vault that no passphrase
// can open. "Crash at write n" is simulated by making the n-th storage write
// fail; with a single write there is no in-between state to be left in.
test('changePassphrase is all-or-nothing: a failure at any write leaves an openable vault', async () => {
    const NEW = 'walnut-harbour-lantern-ninety';
    for (const n of [1, 2, 3]) {
        fake.reset();
        const key = await storage.setupPassphrase(PASSPHRASE);
        await storage.saveAccounts(ACCOUNTS, key);

        fake.failOnSet(n);
        const failed = await storage.changePassphrase(ACCOUNTS, NEW).then(() => false, () => true);
        fake.clearFailure();

        const oldKey = await storage.unlockWithPassphrase(PASSPHRASE);
        const newKey = await storage.unlockWithPassphrase(NEW);
        assert.ok(!!oldKey !== !!newKey, `write ${n}: exactly one passphrase must unlock`);
        assert.equal(!!oldKey, failed, `write ${n}: old passphrase still valid exactly when the change failed`);
        assert.deepEqual(await storage.loadAccounts(oldKey || newKey), ACCOUNTS, `write ${n}: accounts must decrypt`);
    }
});

test('changePassphrase and setupPassphrase commit meta and data in a single write', async () => {
    fake.failOnSet(Infinity); // just resets the counter
    await storage.setupPassphrase(PASSPHRASE);
    assert.equal(fake.setCallCount(), 1);

    fake.failOnSet(Infinity);
    await storage.changePassphrase(ACCOUNTS, 'walnut-harbour-lantern-ninety');
    assert.equal(fake.setCallCount(), 1);
});

test('a failed setup leaves a clean first-launch state', async () => {
    fake.failOnSet(1);
    await assert.rejects(() => storage.setupPassphrase(PASSPHRASE));
    fake.clearFailure();
    assert.equal(await storage.isFirstLaunch(), true);
    assert.deepEqual(fake.dump(), {});
});

test('backup status: never → current → stale', async () => {
    assert.equal(await storage.getBackupStatus([]), 'current'); // nothing to back up
    assert.equal(await storage.getBackupStatus(ACCOUNTS), 'never');

    await storage.saveBackupFingerprint(ACCOUNTS);
    assert.equal(await storage.getBackupStatus(ACCOUNTS), 'current');
    assert.equal(await storage.getBackupStatus([...ACCOUNTS].reverse()), 'current', 'order does not matter');
    assert.equal(await storage.getBackupStatus(ACCOUNTS.map(a => ({ ...a, id: 'x' + a.id }))), 'current', 'ids do not matter');

    const added = [...ACCOUNTS, { ...ACCOUNTS[0], id: 'a3', secret: 'MFRGGZDFMZTWQ2LKMFRGGZDF' }];
    assert.equal(await storage.getBackupStatus(added), 'stale');
});

test('backup status: a change to any backed-up field makes the backup stale', async () => {
    await storage.saveBackupFingerprint(ACCOUNTS);
    const changes = { issuer: 'Other', accountName: 'bob', secret: 'MFRGGZDFMZTWQ2LKMFRGGZDF', algorithm: 'SHA512', digits: 8, period: 45 };
    for (const [field, value] of Object.entries(changes)) {
        const changed = [{ ...ACCOUNTS[0], [field]: value }, ACCOUNTS[1]];
        assert.equal(await storage.getBackupStatus(changed), 'stale', field);
    }
});

test('backup fingerprint is salted: same accounts, different stored value each time', async () => {
    await storage.saveBackupFingerprint(ACCOUNTS);
    const first = fake.dump().redd2fa_backup_fingerprint;
    await storage.saveBackupFingerprint(ACCOUNTS);
    const second = fake.dump().redd2fa_backup_fingerprint;
    assert.equal(first.version, 2);
    assert.notEqual(first.salt, second.salt);
    assert.notEqual(first.hash, second.hash);
});

/** The unsalted label + secret fingerprint exactly as releases up to 2.8 computed it. */
async function legacyFingerprint(accounts) {
    const essential = accounts
        .map(a => ({ label: a.issuer || a.accountName, secret: a.secret }))
        .sort((a, b) => a.label.localeCompare(b.label) || a.secret.localeCompare(b.secret));
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(essential)));
    return Buffer.from(hash).toString('hex');
}

test('upgrade from 2.8 or earlier: backup of default-parameter accounts stays current and is re-salted', async () => {
    const defaults = [ACCOUNTS[0]];
    await browser.storage.local.set({ redd2fa_backup_fingerprint: await legacyFingerprint(defaults) });

    assert.equal(await storage.getBackupStatus(defaults), 'current');
    const stored = fake.dump().redd2fa_backup_fingerprint;
    assert.equal(typeof stored, 'object', 'unsalted value was replaced');
    assert.equal(await storage.getBackupStatus(defaults), 'current');
});

test('upgrade from 2.8 or earlier: a v2 backup could not hold non-default accounts, so it is stale', async () => {
    await browser.storage.local.set({ redd2fa_backup_fingerprint: await legacyFingerprint(ACCOUNTS) });
    assert.equal(await storage.getBackupStatus(ACCOUNTS), 'stale'); // ACCOUNTS[1] is SHA256 / 8 / 60
});

test('upgrade from 2.8 or earlier: accounts changed since the old backup → stale', async () => {
    await browser.storage.local.set({ redd2fa_backup_fingerprint: await legacyFingerprint([ACCOUNTS[0]]) });
    const changed = [{ ...ACCOUNTS[0], secret: 'MFRGGZDFMZTWQ2LKMFRGGZDF' }];
    assert.equal(await storage.getBackupStatus(changed), 'stale');
});

test('lockout state persists and clears', async () => {
    assert.deepEqual(await storage.loadLockoutState(), { failedAttempts: 0, lockoutUntil: 0 });
    await storage.saveLockoutState({ failedAttempts: 4, lockoutUntil: 123456 });
    assert.deepEqual(await storage.loadLockoutState(), { failedAttempts: 4, lockoutUntil: 123456 });
    await storage.clearLockoutState();
    assert.deepEqual(await storage.loadLockoutState(), { failedAttempts: 0, lockoutUntil: 0 });
});
