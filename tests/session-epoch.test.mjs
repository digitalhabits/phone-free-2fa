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
