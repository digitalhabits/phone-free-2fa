/**
 * Session tests — lock epoch and the auto-lock timer.
 * Ported from Konrad Kollnig's PRs #7 and #9.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

/** A fresh copy of the module, so tests don't share its in-memory state. */
let copies = 0;
const freshSession = () => import(`../src/session.js?copy=${++copies}`);

/** Replace setInterval/clearInterval with hand-driven fakes for the duration of fn. */
async function withFakeIntervals(fn) {
    const real = [globalThis.setInterval, globalThis.clearInterval];
    const running = new Map();
    let nextId = 1;
    globalThis.setInterval = (callback) => { running.set(nextId, callback); return nextId++; };
    globalThis.clearInterval = (id) => { running.delete(id); };
    try {
        await fn({ running, tick: () => [...running.values()].forEach(cb => cb()) });
    } finally {
        [globalThis.setInterval, globalThis.clearInterval] = real;
    }
}

test('the lock epoch goes up on every lock and invalidates work captured before it', async () => {
    const session = await freshSession();
    const before = session.captureLockEpoch();
    assert.equal(session.isLockEpochCurrent(before), true);

    session.setSessionKey({});
    assert.equal(session.isLockEpochCurrent(before), true, 'unlocking does not change the epoch');

    session.lock();
    assert.equal(session.isLockEpochCurrent(before), false);
    const after = session.captureLockEpoch();
    session.lock();
    assert.equal(session.isLockEpochCurrent(after), false, 'locking twice counts twice');
});

test('auto-lock also advances the epoch', async () => {
    await withFakeIntervals(async ({ tick }) => {
        const session = await freshSession();
        session.setAutoLockMinutes(0.000001);
        session.setSessionKey({});
        const epoch = session.captureLockEpoch();
        await new Promise(resolve => setTimeout(resolve, 5));
        tick();
        assert.equal(session.isUnlocked(), false);
        assert.equal(session.isLockEpochCurrent(epoch), false);
    });
});

test('switching from "Never" to a timeout while unlocked starts the timer (PR #9)', async () => {
    await withFakeIntervals(async ({ running }) => {
        const session = await freshSession();
        session.setAutoLockMinutes(0);
        session.setSessionKey({});
        assert.equal(running.size, 0);

        session.setAutoLockMinutes(5);
        assert.equal(running.size, 1);

        session.setAutoLockMinutes(15);
        assert.equal(running.size, 1, 're-timed, not stacked');

        session.lock();
        assert.equal(running.size, 0);
    });
});

// popup.js calls setSessionKey() and then setAutoLockMinutes(saved setting).
// The module default is 5 minutes, so with "Never" saved, a timer was started
// and its first tick (elapsed >= 0) locked the vault 10 seconds after unlock.
test('"Never" really means never, in the order popup.js applies it', async () => {
    await withFakeIntervals(async ({ running, tick }) => {
        const session = await freshSession();
        session.setSessionKey({});
        session.setAutoLockMinutes(0);
        assert.equal(running.size, 0);
        tick();
        assert.equal(session.isUnlocked(), true);
    });
});

test('changing the timeout while locked does not start a timer', async () => {
    await withFakeIntervals(async ({ running }) => {
        const session = await freshSession();
        session.setAutoLockMinutes(5);
        assert.equal(running.size, 0);
    });
});
