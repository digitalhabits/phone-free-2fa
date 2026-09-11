import test from 'node:test';
import assert from 'node:assert/strict';

test('lock epoch is monotonic and invalidates captured asynchronous work', async () => {
    const session = await import(`../src/session.js?test-epoch=${Date.now()}`);
    session.setAutoLockMinutes(0);
    const before = session.captureLockEpoch();
    assert.equal(session.isLockEpochCurrent(before), true);

    session.setSessionKey({});
    session.lock();
    const afterFirstLock = session.captureLockEpoch();
    assert.equal(afterFirstLock, before + 1);
    assert.equal(session.isLockEpochCurrent(before), false);
    assert.equal(session.isUnlocked(), false);

    session.lock();
    assert.equal(session.captureLockEpoch(), afterFirstLock + 1);
    assert.equal(session.isLockEpochCurrent(afterFirstLock), false);
});

test('enabling auto-lock while unlocked starts its timer', async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let scheduled = 0;
    let cleared = 0;

    globalThis.setInterval = () => {
        scheduled += 1;
        return scheduled;
    };
    globalThis.clearInterval = () => {
        cleared += 1;
    };

    try {
        const session = await import(`../src/session.js?test-timer=${Date.now()}`);
        session.setAutoLockMinutes(0);
        session.setSessionKey({});
        assert.equal(scheduled, 0);

        session.setAutoLockMinutes(5);
        assert.equal(scheduled, 1);

        session.setAutoLockMinutes(15);
        assert.equal(scheduled, 2);
        assert.equal(cleared, 1);

        session.lock();
        assert.equal(cleared, 2);
    } finally {
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
    }
});
