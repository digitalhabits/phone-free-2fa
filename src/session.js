/**
 * Phone-Free 2FA — Session manager
 *
 * Manages in-memory encryption key and auto-lock behavior.
 * The key is never persisted — only held in memory while unlocked.
 */

/** In-memory session state */
let sessionKey = null;
let lastActivity = Date.now();
let autoLockMinutes = 5;
let lockCheckInterval = null;
let onLockCallback = null;
let lockEpoch = 0;

/**
 * Lock epoch: a counter that goes up on every lock. Anything asynchronous
 * that handles decrypted data captures it first and checks it after each
 * await — if the vault was locked in between, the work must stop, otherwise
 * it would put a key or decrypted accounts back into a locked, wiped panel
 * (or act on the wiped, empty account list).
 */
export function captureLockEpoch() {
    return lockEpoch;
}

/** True if no lock has happened since `epoch` was captured. */
export function isLockEpochCurrent(epoch) {
    return epoch === lockEpoch;
}

/**
 * Register a callback to be called when the session auto-locks.
 */
export function setOnLockCallback(cb) {
    onLockCallback = cb;
}

/**
 * Store the derived key in memory (unlock).
 */
export function setSessionKey(key) {
    sessionKey = key;
    lastActivity = Date.now();
    startAutoLockTimer();
}

/**
 * Get the current session key.
 */
export function getSessionKey() {
    return sessionKey;
}

/**
 * Check if the session is unlocked.
 */
export function isUnlocked() {
    return sessionKey !== null;
}

/**
 * Lock the session — wipe the key from memory.
 */
export function lock() {
    lockEpoch += 1;
    sessionKey = null;
    stopAutoLockTimer();
}

/**
 * Record user activity to reset the auto-lock timer.
 */
export function touchActivity() {
    lastActivity = Date.now();
}

/**
 * Set the auto-lock timeout duration.
 */
export function setAutoLockMinutes(minutes) {
    autoLockMinutes = minutes;
    // Apply it now: start, stop or re-time the timer of an unlocked session.
    if (sessionKey !== null) startAutoLockTimer();
}

/**
 * Start the auto-lock check interval.
 */
function startAutoLockTimer() {
    stopAutoLockTimer();
    if (autoLockMinutes <= 0) return; // 0 = never auto-lock

    lockCheckInterval = setInterval(() => {
        const elapsed = (Date.now() - lastActivity) / 1000 / 60;
        if (elapsed >= autoLockMinutes) {
            lock();
            if (onLockCallback) onLockCallback();
        }
    }, 10_000); // Check every 10 seconds
}

/**
 * Stop the auto-lock check interval.
 */
function stopAutoLockTimer() {
    if (lockCheckInterval) {
        clearInterval(lockCheckInterval);
        lockCheckInterval = null;
    }
}
