/**
 * Storage manager tests — vault lifecycle against an in-memory
 * browser.storage.local.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeBrowser } from './helpers/fake-browser.js';
import { generateSalt, deriveKey, createPassphraseHash, encrypt } from '../src/crypto.js';

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

test('a fingerprint written by 2.8 or earlier makes the backup stale', async () => {
    // 2.8 stored a bare hex string over label + secret only, so it cannot say
    // whether the backup holds this account's TOTP parameters. One fresh
    // backup is asked for, and then the new format takes over.
    const essential = ACCOUNTS
        .map(a => ({ label: a.issuer || a.accountName, secret: a.secret }))
        .sort((a, b) => a.label.localeCompare(b.label) || a.secret.localeCompare(b.secret));
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(essential)));
    await globalThis.browser.storage.local.set({
        redd2fa_backup_fingerprint: Buffer.from(hash).toString('hex'),
    });

    assert.equal(await storage.getBackupStatus(ACCOUNTS), 'stale');
    await storage.saveBackupFingerprint(ACCOUNTS);
    assert.equal(await storage.getBackupStatus(ACCOUNTS), 'current');
});

test('lockout state persists and clears', async () => {
    assert.deepEqual(await storage.loadLockoutState(), { failedAttempts: 0, lockoutUntil: 0 });
    await storage.saveLockoutState({ failedAttempts: 4, lockoutUntil: 123456 });
    assert.deepEqual(await storage.loadLockoutState(), { failedAttempts: 4, lockoutUntil: 123456 });
    await storage.clearLockoutState();
    assert.deepEqual(await storage.loadLockoutState(), { failedAttempts: 0, lockoutUntil: 0 });
});

// --- replaceVault: restore from backup when the passphrase is lost ---

test('replaceVault overwrites a vault whose passphrase is lost', async () => {
    const OLD = 'old-forgotten-passphrase-42';
    const NEW = 'fresh-restored-passphrase-42';

    const oldKey = await storage.setupPassphrase(OLD);
    await storage.saveAccounts(ACCOUNTS, oldKey);

    // setupPassphrase refuses — that is why replaceVault exists.
    await assert.rejects(() => storage.setupPassphrase(NEW), /already exists/);

    const restored = [ACCOUNTS[1]];
    const newKey = await storage.replaceVault(NEW, restored);

    assert.deepEqual(await storage.loadAccounts(newKey), restored);
    assert.equal(await storage.unlockWithPassphrase(OLD), null, 'old passphrase must be dead');
    assert.notEqual(await storage.unlockWithPassphrase(NEW), null, 'new passphrase must work');
});

test('replaceVault leaves a vault readable after a reload', async () => {
    const NEW = 'fresh-restored-passphrase-42';
    await storage.setupPassphrase('old-forgotten-passphrase-42');
    await storage.replaceVault(NEW, ACCOUNTS);

    const key = await storage.unlockWithPassphrase(NEW);
    assert.deepEqual(await storage.loadAccounts(key), ACCOUNTS);
});

test('replaceVault works on a fresh profile too', async () => {
    const key = await storage.replaceVault('fresh-restored-passphrase-42', ACCOUNTS);
    assert.deepEqual(await storage.loadAccounts(key), ACCOUNTS);
});

// 'é' typed as one character (NFC) and as 'e' + combining acute (NFD).
const NFC = 'café-orbit-candle-seventeen';
const NFD = 'café-orbit-candle-seventeen';

test('a vault made under either spelling of an accented passphrase, before or after normalisation, unlocks with both', async () => {
    const unlocks = async () => {
        for (const spelling of [NFC, NFD]) assert.deepEqual(await storage.loadAccounts(await storage.unlockWithPassphrase(spelling)), ACCOUNTS);
        assert.equal(await storage.unlockWithPassphrase('wrong-passphrase-entirely'), null);
    };
    await storage.saveAccounts(ACCOUNTS, await storage.setupPassphrase(NFD));
    await unlocks();

    fake.reset(); // a vault written before normalisation: raw NFD bytes
    const salt = generateSalt();
    await globalThis.browser.storage.local.set({
        redd2fa_meta: { salt, passphraseHash: await createPassphraseHash(NFD, salt), version: 1 },
        redd2fa_data: await encrypt(JSON.stringify(ACCOUNTS), await deriveKey(NFD, salt)),
    });
    await unlocks();
});
