/**
 * Two panels open at once (one per browser window) share one vault on disk
 * but each keeps its own key and its own copy of the accounts. A panel whose
 * copy is out of date must never write it back.
 *
 * Adapted from Konrad Kollnig's PR #7 (tests/vault-races.test.mjs) and
 * extended from passphrase changes to every save.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeBrowser } from './helpers/fake-browser.js';

const fake = installFakeBrowser();

/** Each "window" is a separate copy of storage.js with its own in-memory state. */
let copies = 0;
const openWindow = () => import(`../src/storage.js?window=${++copies}`);

const OLD = 'plum-orbit-candle-seventeen';
const NEW = 'walnut-harbour-lantern-ninety';
const A1 = { id: 'a1', issuer: 'Example', accountName: 'alice', secret: 'JBSWY3DPEHPK3PXPJBSWY3DP', algorithm: 'SHA1', digits: 6, period: 30 };
const A2 = { id: 'a2', issuer: 'Bank', accountName: 'alice', secret: 'KRSXG5CTMVRXEZLUKRSXG5CT', algorithm: 'SHA256', digits: 8, period: 60 };

const isStale = (storage) => (err) => err instanceof storage.StaleVaultError;

/** Window A sets up a vault holding A1; window B unlocks it. Both are now "open". */
async function twoUnlockedWindows() {
    const a = await openWindow();
    const aKey = await a.setupPassphrase(OLD);
    await a.saveAccounts([A1], aKey);
    const b = await openWindow();
    const bKey = await b.unlockWithPassphrase(OLD);
    assert.deepEqual(await b.loadAccounts(bKey), [A1]);
    return { a, aKey, b, bKey };
}

beforeEach(() => fake.reset());

// The data-loss case: B's old key next to A's new passphrase check is a
// vault that no passphrase can open.
test('after window A changes the passphrase, window B cannot save with its old key', async () => {
    const { a, b, bKey } = await twoUnlockedWindows();
    await a.changePassphrase([A1], NEW);
    const afterRotation = fake.dump();

    await assert.rejects(() => b.saveAccounts([A1, A2], bKey), isStale(b));
    assert.deepEqual(fake.dump(), afterRotation, 'nothing was written');

    const c = await openWindow();
    assert.deepEqual(await c.loadAccounts(await c.unlockWithPassphrase(NEW)), [A1]);
});

test('after window A changes the passphrase, window B cannot change it too', async () => {
    const { a, b } = await twoUnlockedWindows();
    await a.changePassphrase([A1], NEW);
    const afterRotation = fake.dump();
    await assert.rejects(() => b.changePassphrase([A1], 'gravel-meadow-trumpet-eleven'), isStale(b));
    assert.deepEqual(fake.dump(), afterRotation);
});

// The lost-update case: no passphrase change involved.
test('after window A saves, window B cannot overwrite it with its older copy', async () => {
    const { a, aKey, b, bKey } = await twoUnlockedWindows();
    await a.saveAccounts([A1, A2], aKey);            // A adds an account
    await assert.rejects(() => b.saveAccounts([], bKey), isStale(b)); // B deletes one, from its old copy

    const c = await openWindow();
    assert.deepEqual(await c.loadAccounts(await c.unlockWithPassphrase(OLD)), [A1, A2], "A's account survived");
});

test('a stale window recovers by unlocking again, and can then save', async () => {
    const { a, aKey, b } = await twoUnlockedWindows();
    await a.saveAccounts([A1, A2], aKey);

    const bKey = await b.unlockWithPassphrase(OLD);
    const current = await b.loadAccounts(bKey);
    assert.deepEqual(current, [A1, A2]);
    await b.saveAccounts([A2], bKey);

    await assert.rejects(() => a.saveAccounts([A1], aKey), isStale(a), 'and now A is the stale one');
});

test('one window saving repeatedly is never stale', async () => {
    const a = await openWindow();
    const key = await a.setupPassphrase(OLD);
    await a.saveAccounts([A1], key);
    await a.saveAccounts([A1, A2], key);
    const newKey = await a.changePassphrase([A1, A2], NEW);
    await a.saveAccounts([A2], newKey);
    assert.deepEqual(await a.loadAccounts(newKey), [A2]);
});

test('re-checking the passphrase (as change-passphrase and Touch ID setup do) does not make a window stale', async () => {
    const a = await openWindow();
    const key = await a.setupPassphrase(OLD);
    await a.saveAccounts([A1], key);
    assert.ok(await a.unlockWithPassphrase(OLD));
    assert.equal(await a.unlockWithPassphrase('wrong-passphrase-entirely'), null);
    await a.saveAccounts([A1, A2], key);
});

test('a window that never unlocked cannot write', async () => {
    const a = await openWindow();
    const key = await a.setupPassphrase(OLD);
    const b = await openWindow();
    await assert.rejects(() => b.saveAccounts([], key), isStale(b));
    await assert.rejects(() => b.changePassphrase([], NEW), isStale(b));
});

// Two windows both showing the first-run screen.
test('setup refuses to replace a vault that another window just created', async () => {
    const a = await openWindow();
    const b = await openWindow();
    const aKey = await a.setupPassphrase(OLD);
    await a.saveAccounts([A1], aKey);
    const before = fake.dump();

    await assert.rejects(() => b.setupPassphrase(NEW), /already exists/);
    assert.deepEqual(fake.dump(), before);
});

test('vaults created by 2.7 (no extra stored fields) get the same protection', async () => {
    const { a, b, bKey } = await twoUnlockedWindows();
    assert.deepEqual(Object.keys(fake.dump().redd2fa_meta).sort(), ['passphraseHash', 'salt', 'version'], 'no schema change');
    await a.changePassphrase([A1], NEW);
    await assert.rejects(() => b.saveAccounts([], bKey), isStale(b));
});

test('simultaneous saves from two windows: exactly one wins, nothing is interleaved', async () => {
    const { a, aKey, b, bKey } = await twoUnlockedWindows();
    const results = await Promise.allSettled([
        a.saveAccounts([A1, A2], aKey),
        b.saveAccounts([], bKey),
    ]);
    assert.deepEqual(results.map(r => r.status).sort(), ['fulfilled', 'rejected']);
    const c = await openWindow();
    const onDisk = await c.loadAccounts(await c.unlockWithPassphrase(OLD));
    assert.deepEqual(onDisk, results[0].status === 'fulfilled' ? [A1, A2] : []);
});
