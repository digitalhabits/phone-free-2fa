/**
 * Races in the real popup.js, run under Node with a fake DOM: what happens
 * when the panel locks, or another window writes, while a handler is waiting.
 *
 * Adapted from Konrad Kollnig's PR #7 (tests/popup-races.test.mjs).
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeBrowser } from './helpers/fake-browser.js';
import { installFakeDom } from './helpers/fake-dom.js';

const fake = installFakeBrowser();
const dom = installFakeDom();

// popup.js starts timers (code refresh, auto-lock, toasts). Don't let them
// keep the test process alive after the last test.
const realSetTimeout = globalThis.setTimeout;
for (const name of ['setInterval', 'setTimeout']) {
    const real = globalThis[name];
    globalThis[name] = (...args) => real(...args).unref();
}

/** Let fire-and-forget work started by a handler (a render, say) finish. */
const settle = () => new Promise((resolve) => realSetTimeout(resolve, 50));

const storage = await import('../src/storage.js');   // the panel's own copy
const session = await import('../src/session.js');
const otherWindow = await import('../src/storage.js?window=other');

const PASSPHRASE = 'plum-orbit-candle-seventeen';
const NEW_PASSPHRASE = 'walnut-harbour-lantern-ninety';
const A1 = { id: 'a1', issuer: 'Example', accountName: 'alice', secret: 'JBSWY3DPEHPK3PXPJBSWY3DP', algorithm: 'SHA1', digits: 6, period: 30 };

const click = (id) => dom.element(id).fire('click');
const shown = (id) => dom.element(id).style.display !== 'none';

async function unlockPanel(passphrase = PASSPHRASE) {
    dom.element('unlock-passphrase').value = passphrase;
    await click('unlock-btn');
}

/** What a fresh window would find on disk. */
let readers = 0;
async function accountsOnDisk(passphrase) {
    const reader = await import(`../src/storage.js?reader=${++readers}`);
    const key = await reader.unlockWithPassphrase(passphrase);
    return key ? reader.loadAccounts(key) : null;
}

before(async () => {
    const key = await otherWindow.setupPassphrase(PASSPHRASE);
    await otherWindow.saveAccounts([A1], key);
    await browser.storage.local.set({ redd2fa_eula: { acceptedRevision: 1 }, redd2fa_biometric_dont_ask: true });

    await import('../src/popup.js');
    await dom.fireDocument('DOMContentLoaded');
    assert.ok(shown('lock-screen'), 'popup.js loaded and shows the lock screen');
});

test('sanity: the panel unlocks, shows the main screen, and locks again', async () => {
    await unlockPanel();
    assert.equal(session.isUnlocked(), true);
    assert.ok(shown('main-screen'));

    await click('lock-btn');
    assert.equal(session.isUnlocked(), false);
    assert.ok(shown('lock-screen'));
});

test('an unlock that finishes after the panel locked does not bring the session back', async () => {
    const hold = fake.holdNextGet('redd2fa_data');   // pause while reading the accounts
    dom.element('unlock-passphrase').value = PASSPHRASE;
    const unlocking = click('unlock-btn');
    await hold.started;

    session.lock();                                   // e.g. the user hit Lock, or auto-lock fired
    hold.release();
    await unlocking;

    assert.equal(session.isUnlocked(), false);
    assert.ok(shown('lock-screen'));
    assert.ok(!shown('main-screen'));
    assert.equal(dom.element('unlock-btn').disabled, false, 'the button is usable again');
});

test('an unlock that finishes after the panel was closed is locked at once', async () => {
    const hold = fake.holdNextGet('redd2fa_data');
    dom.element('unlock-passphrase').value = PASSPHRASE;
    const unlocking = click('unlock-btn');
    await hold.started;

    await dom.setPanelHidden(true);                   // locked already, so hiding does not lock()
    hold.release();
    await unlocking;
    assert.equal(session.isUnlocked(), false);
    await dom.setPanelHidden(false);
});

// The data-loss race: locking wipes the in-memory account list. Without the
// snapshot + epoch check, the passphrase change went on to save that empty
// list as the whole vault.
test('locking while the current passphrase is being checked does not save an empty vault', async () => {
    await unlockPanel();
    click('change-passphrase-btn');
    dom.element('current-passphrase').value = PASSPHRASE;
    dom.element('new-passphrase').value = NEW_PASSPHRASE;
    dom.element('new-passphrase-confirm').value = NEW_PASSPHRASE;
    const before = fake.dump();

    const hold = fake.holdNextGet('redd2fa_meta');    // pause inside the passphrase check
    const changing = click('change-passphrase-confirm-btn');
    await hold.started;
    await dom.setPanelHidden(true);                   // closing the panel locks and wipes
    await dom.setPanelHidden(false);
    hold.release();
    await changing;

    assert.equal(session.isUnlocked(), false);
    assert.deepEqual(fake.dump().redd2fa_meta, before.redd2fa_meta, 'passphrase unchanged');
    assert.deepEqual(fake.dump().redd2fa_data, before.redd2fa_data, 'vault unchanged');
    assert.deepEqual(await accountsOnDisk(PASSPHRASE), [A1]);
});

test('a normal passphrase change keeps every account', async () => {
    await unlockPanel();
    click('change-passphrase-btn');
    dom.element('current-passphrase').value = PASSPHRASE;
    dom.element('new-passphrase').value = NEW_PASSPHRASE;
    dom.element('new-passphrase-confirm').value = NEW_PASSPHRASE;
    await click('change-passphrase-confirm-btn');

    assert.equal(session.isUnlocked(), true);
    assert.equal(await accountsOnDisk(PASSPHRASE), null, 'old passphrase no longer works');
    assert.deepEqual(await accountsOnDisk(NEW_PASSPHRASE), [A1]);
    await click('lock-btn');
});

test('saving from a panel whose copy is out of date writes nothing, locks, and says why', async () => {
    await unlockPanel(NEW_PASSPHRASE);

    // Meanwhile, in another window: unlock and add an account.
    const A2 = { ...A1, id: 'a2', issuer: 'Bank', secret: 'KRSXG5CTMVRXEZLUKRSXG5CT' };
    const key = await otherWindow.unlockWithPassphrase(NEW_PASSPHRASE);
    await otherWindow.saveAccounts([...(await otherWindow.loadAccounts(key)), A2], key);

    // Back in this panel, which still shows only A1: add an account.
    click('add-account-btn');
    dom.element('manual-label').value = 'Mail';
    dom.element('manual-secret').value = 'MFRGGZDFMZTWQ2LKMFRGGZDF';
    await click('modal-save-btn');

    assert.equal(session.isUnlocked(), false, 'the out-of-date panel locked');
    assert.ok(shown('lock-screen'));
    assert.match(dom.element('toast').textContent, /another window/);
    assert.deepEqual(await accountsOnDisk(NEW_PASSPHRASE), [A1, A2], "the other window's account survived");

    // Unlocking again picks up the current vault, and saving then works.
    await unlockPanel(NEW_PASSPHRASE);
    click('add-account-btn');
    dom.element('manual-label').value = 'Mail';
    dom.element('manual-secret').value = 'MFRGGZDFMZTWQ2LKMFRGGZDF';
    await click('modal-save-btn');
    const onDisk = await accountsOnDisk(NEW_PASSPHRASE);
    assert.deepEqual(onDisk.map(a => a.issuer), ['Example', 'Bank', 'Mail']);
    await click('lock-btn');
});

test('locking while a save is in flight does not put the accounts back in memory', async () => {
    await unlockPanel(NEW_PASSPHRASE);
    click('add-account-btn');
    dom.element('manual-label').value = 'Shop';
    dom.element('manual-secret').value = 'ONUG64DTNBXXA43IN5YHG2DP';

    const hold = fake.holdNextGet('redd2fa_meta');    // pause inside saveAccounts' stale check
    const saving = click('modal-save-btn');
    await hold.started;
    session.lock();
    hold.release();
    await saving;

    assert.equal(session.isUnlocked(), false);
    // The save itself was already under way and completes; memory stays wiped.
    const onDisk = await accountsOnDisk(NEW_PASSPHRASE);
    assert.equal(onDisk.length, 4);
});

// Both of these were found by Konrad Kollnig reviewing PR #17.

test('locking while the Settings passphrase is verified does not restore it', async () => {
    await unlockPanel(NEW_PASSPHRASE);
    click('settings-btn');
    // The Settings route asks for the master passphrase again before enabling
    // Touch ID. Verification is slow, so a lock can land in the middle of it.
    dom.element('biometric-setup-passphrase').value = NEW_PASSPHRASE;
    dom.element('biometric-passphrase-group').style.display = 'block';

    const hold = fake.holdNextGet('redd2fa_meta');    // pause inside unlockWithPassphrase
    const enabling = click('biometric-enable-btn');
    await hold.started;
    await dom.setPanelHidden(true);                   // closing the panel locks and wipes
    await dom.setPanelHidden(false);
    hold.release();
    await enabling;

    assert.equal(session.isUnlocked(), false, 'still locked');
    // Accepting the passphrase is what hides the passphrase field and starts
    // registration. Neither may happen once the panel has locked, because the
    // continuation would be holding the master passphrase in a wiped panel.
    assert.equal(shown('biometric-passphrase-group'), true,
        'the passphrase was not accepted into a locked panel');
    assert.equal(dom.element('biometric-setup-passphrase').value, '',
        'the wipe stands: nothing was put back');
    assert.equal(fake.dump().redd2fa_biometric, undefined, 'no credential registered');
});

test('locking while a code is being generated leaves nothing on the clipboard', async () => {
    await unlockPanel(NEW_PASSPHRASE);
    dom.clipboard.reset();

    await settle();                                   // renderAccounts() is not awaited by the unlock handler
    const cards = dom.element('account-list').querySelectorAll('.account-card');
    assert.ok(cards.length > 0, 'accounts rendered, so there is a card to click');

    // Pause the clipboard write, lock while it is in flight, then let it land.
    const hold = dom.clipboard.holdNextWrite();
    cards[0].fire('click', { target: cards[0] });     // the card listener does not return its promise
    await hold.started;
    await dom.setPanelHidden(true);
    await dom.setPanelHidden(false);
    hold.release();
    await settle();

    assert.equal(session.isUnlocked(), false, 'still locked');
    assert.equal(dom.clipboard.text, '', 'the code was cleared once the lock won');
});
