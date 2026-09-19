/**
 * Phone-Free 2FA — Lock-on-hide policy
 *
 * Rule: an unlocked vault must not outlive a hidden panel. Chrome often
 * keeps the side-panel document alive after it is closed, so "hidden" is
 * the only signal that the user has gone.
 *
 * One exception: while a Touch ID tab is open ("ceremony"), the panel has
 * to keep the pending state that tab needs, so locking is deferred. The
 * deferral is bounded in both directions:
 *   - when the ceremony ends (done, failed, tab closed) and the panel is
 *     still hidden, lock at once;
 *   - if the panel stays hidden for CEREMONY_GRACE_MS, lock anyway, even if
 *     the tab is still open (an abandoned tab must not keep the vault open,
 *     which matters most when auto-lock is set to "Never").
 *
 * No DOM or browser APIs in here — everything comes in through `deps`, so
 * every path is covered by tests/lock-policy.test.js.
 *
 * deps:
 *   isHidden()         → true if the panel document is hidden
 *   isUnlocked()       → true if a session key is held
 *   isCeremonyActive() → true while a Touch ID tab is open
 *   lockNow()          → lock the session and wipe all decrypted state
 *   setTimer / clearTimer → setTimeout / clearTimeout (injected for tests)
 */

export const CEREMONY_GRACE_MS = 2 * 60 * 1000;

export function createHideLockPolicy({
    isHidden,
    isUnlocked,
    isCeremonyActive,
    lockNow,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
    graceMs = CEREMONY_GRACE_MS,
}) {
    let graceTimer = null;

    function cancelGrace() {
        if (graceTimer !== null) {
            clearTimer(graceTimer);
            graceTimer = null;
        }
    }

    function lockIfHidden() {
        if (isHidden() && isUnlocked()) lockNow();
    }

    return {
        /** The panel was hidden or closed. */
        onHide() {
            if (!isUnlocked()) return;
            if (!isCeremonyActive()) {
                cancelGrace();
                lockNow();
                return;
            }
            if (graceTimer === null) {
                graceTimer = setTimer(() => {
                    graceTimer = null;
                    lockIfHidden();
                }, graceMs);
            }
        },

        /** The panel became visible again. */
        onShow() {
            cancelGrace();
        },

        /** The Touch ID tab finished, failed for good, or was closed. */
        onCeremonyEnd() {
            cancelGrace();
            lockIfHidden();
        },

        /** The vault was just unlocked. Never stay unlocked in a hidden panel. */
        onUnlocked() {
            lockIfHidden();
        },
    };
}
