/**
 * Lock-on-hide policy tests — an unlocked vault must not outlive a hidden
 * panel, including around the Touch ID tab.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHideLockPolicy, CEREMONY_GRACE_MS } from '../src/lock-policy.js';

/** A panel whose state the test drives by hand, with a manual timer. */
function makePanel({ unlocked = true, hidden = false, ceremony = false } = {}) {
    const panel = { unlocked, hidden, ceremony, locks: 0, timers: new Map(), nextTimerId: 1 };
    panel.policy = createHideLockPolicy({
        isHidden: () => panel.hidden,
        isUnlocked: () => panel.unlocked,
        isCeremonyActive: () => panel.ceremony,
        lockNow: () => { panel.locks++; panel.unlocked = false; panel.ceremony = false; },
        setTimer: (fn, ms) => { const id = panel.nextTimerId++; panel.timers.set(id, { fn, ms }); return id; },
        clearTimer: (id) => panel.timers.delete(id),
    });
    panel.hide = () => { panel.hidden = true; panel.policy.onHide(); };
    panel.show = () => { panel.hidden = false; panel.policy.onShow(); };
    panel.endCeremony = () => { panel.ceremony = false; panel.policy.onCeremonyEnd(); };
    panel.fireTimers = () => { for (const [id, t] of [...panel.timers]) { panel.timers.delete(id); t.fn(); } };
    return panel;
}

test('hiding an unlocked panel locks it at once', () => {
    const panel = makePanel();
    panel.hide();
    assert.equal(panel.locks, 1);
    assert.equal(panel.timers.size, 0);
});

test('hiding a locked panel does nothing', () => {
    const panel = makePanel({ unlocked: false });
    panel.hide();
    assert.equal(panel.locks, 0);
});

test('during a Touch ID tab, hiding defers the lock instead of killing the ceremony', () => {
    const panel = makePanel({ ceremony: true });
    panel.hide();
    assert.equal(panel.locks, 0);
    assert.equal(panel.timers.size, 1);
    assert.equal([...panel.timers.values()][0].ms, CEREMONY_GRACE_MS);
});

// The gap from both reviews: panel hidden during the ceremony, tab then
// closed — nothing ever re-ran the lock, so with auto-lock "Never" the vault
// stayed open indefinitely.
test('ceremony ends while the panel is still hidden → lock at once', () => {
    const panel = makePanel({ ceremony: true });
    panel.hide();
    panel.endCeremony();
    assert.equal(panel.locks, 1);
    assert.equal(panel.timers.size, 0, 'grace timer is cancelled');
});

test('abandoned Touch ID tab: panel hidden for the whole grace period → lock anyway', () => {
    const panel = makePanel({ ceremony: true });
    panel.hide();
    panel.fireTimers();
    assert.equal(panel.locks, 1);
});

test('panel comes back before the ceremony ends → stays unlocked, timer cancelled', () => {
    const panel = makePanel({ ceremony: true });
    panel.hide();
    panel.show();
    assert.equal(panel.timers.size, 0);
    panel.endCeremony();
    assert.equal(panel.locks, 0);
});

test('hide → show → hide again during one ceremony starts a fresh grace period', () => {
    const panel = makePanel({ ceremony: true });
    panel.hide();
    panel.show();
    panel.hide();
    assert.equal(panel.timers.size, 1);
    panel.fireTimers();
    assert.equal(panel.locks, 1);
});

test('repeated hide events during a ceremony do not stack timers', () => {
    const panel = makePanel({ ceremony: true });
    panel.hide();
    panel.policy.onHide(); // visibilitychange + pagehide both fire
    assert.equal(panel.timers.size, 1);
});

test('ceremony ends while the panel is visible → stays unlocked', () => {
    const panel = makePanel({ ceremony: true });
    panel.endCeremony();
    assert.equal(panel.locks, 0);
});

test('unlocking into a hidden panel (Touch ID result arrives after the panel was closed) locks at once', () => {
    const panel = makePanel({ unlocked: false, hidden: true });
    panel.unlocked = true;
    panel.policy.onUnlocked();
    assert.equal(panel.locks, 1);
});

test('unlocking a visible panel stays unlocked', () => {
    const panel = makePanel({ unlocked: false });
    panel.unlocked = true;
    panel.policy.onUnlocked();
    assert.equal(panel.locks, 0);
});

// The policy only helps if popup.js reports every event to it.
test('popup.js wiring: every ceremony end and every unlock goes through the policy', () => {
    const popup = readFileSync(new URL('../src/popup.js', import.meta.url), 'utf8');
    const bodyOf = (signature) => {
        const start = popup.indexOf(signature);
        assert.ok(start >= 0, `${signature} not found`);
        return popup.slice(start, popup.indexOf('\n}\n', start));
    };
    // clearBiometricTab() is the only place biometricTab becomes null.
    assert.ok(bodyOf('function clearBiometricTab()').includes('hideLockPolicy.onCeremonyEnd()'));
    assert.equal((popup.match(/^\s+biometricTab = null/gm) || []).length, 1);
    // Every place that sets a session key reports it, so a key can never be
    // installed into a panel that was closed while the key was being derived.
    const keySets = (popup.match(/setSessionKey\(/g) || []).length;
    const reported = (popup.match(/hideLockPolicy\.onUnlocked\(\)/g) || []).length;
    assert.equal(keySets, 6, 'setup, passphrase unlock, Touch ID inline, Touch ID tab, change passphrase, restore from backup');
    assert.equal(reported, keySets);
    assert.ok(popup.includes('hideLockPolicy.onHide()'));
    assert.ok(popup.includes('hideLockPolicy.onShow()'));
});
