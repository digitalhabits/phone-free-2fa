/**
 * Phone-Free 2FA — Storage manager
 *
 * Manages encrypted account data in browser.storage.local.
 * All data is stored as a single encrypted JSON blob.
 */

import browser from './browser.js';
import { encrypt, decrypt, generateSalt, createPassphraseHash, deriveKey, verifyPassphrase } from './crypto.js';

const STORAGE_KEY_DATA = 'redd2fa_data';
const STORAGE_KEY_META = 'redd2fa_meta';
const STORAGE_KEY_SETTINGS = 'redd2fa_settings';
const STORAGE_KEY_BACKUP_FINGERPRINT = 'redd2fa_backup_fingerprint';
const STORAGE_KEY_LOCKOUT = 'redd2fa_lockout';
const SCHEMA_VERSION = 1;

/** Default settings */
export const DEFAULT_SETTINGS = {
    autoLockMinutes: 5,
    clipboardClearSeconds: 30,
    theme: 'system',
    accountHelpExpanded: true,
};

/**
 * Check if this is the first launch (no meta stored).
 */
export async function isFirstLaunch() {
    const result = await browser.storage.local.get(STORAGE_KEY_META);
    return !result[STORAGE_KEY_META];
}

/**
 * Create a vault generation — fresh salt, verifier and re-encrypted accounts —
 * and commit it in ONE storage write.
 *
 * Meta (salt + verifier) and data (ciphertext) only make sense as a pair:
 * meta from one passphrase next to data from another is a vault that no
 * passphrase can open. Writing them separately leaves exactly that state if
 * the browser dies or the second write fails. A single set() call is applied
 * as a whole, so storage always holds a complete old or complete new vault.
 *
 * (Checked in browser source, Sept 2026: Chrome applies one set() as a single
 * LevelDB WriteBatch — components/value_store/leveldb_value_store.cc; Firefox
 * as a single IndexedDB transaction that aborts on error —
 * toolkit/components/extensions/ExtensionStorageIDB.sys.mjs.)
 */
async function writeVault(passphrase, accounts) {
    const salt = generateSalt();
    const key = await deriveKey(passphrase, salt);
    const passphraseHash = await createPassphraseHash(passphrase, salt);

    const plaintext = JSON.stringify(accounts);
    const encrypted = await encrypt(plaintext, key);

    // Prove the new blob opens before it replaces the old one.
    if (await decrypt(encrypted.iv, encrypted.ciphertext, key) !== plaintext) {
        throw new Error('Re-encrypted vault failed verification; nothing was written.');
    }

    await browser.storage.local.set({
        [STORAGE_KEY_META]: { salt, passphraseHash, version: SCHEMA_VERSION },
        [STORAGE_KEY_DATA]: encrypted,
    });
    return key;
}

/**
 * Set up encryption for the first time with a new passphrase.
 * Stores an empty encrypted vault. Returns the derived CryptoKey.
 */
export async function setupPassphrase(passphrase) {
    return writeVault(passphrase, []);
}

/**
 * Attempt to unlock with a passphrase.
 * Returns the derived CryptoKey if successful, null otherwise.
 */
export async function unlockWithPassphrase(passphrase) {
    const result = await browser.storage.local.get(STORAGE_KEY_META);
    const meta = result[STORAGE_KEY_META];

    if (!meta) return null;

    const isValid = await verifyPassphrase(passphrase, meta.salt, meta.passphraseHash);
    if (!isValid) return null;

    return deriveKey(passphrase, meta.salt);
}

/**
 * Change the master passphrase. Re-encrypts all accounts with a new key.
 * All-or-nothing — see writeVault(). Returns the new CryptoKey.
 */
export async function changePassphrase(accounts, newPassphrase) {
    return writeVault(newPassphrase, accounts);
}

/**
 * Save accounts (encrypted) to storage.
 */
export async function saveAccounts(accounts, key) {
    const plaintext = JSON.stringify(accounts);
    const encrypted = await encrypt(plaintext, key);
    await browser.storage.local.set({ [STORAGE_KEY_DATA]: encrypted });
}

/**
 * Load and decrypt accounts from storage.
 */
export async function loadAccounts(key) {
    const result = await browser.storage.local.get(STORAGE_KEY_DATA);
    const blob = result[STORAGE_KEY_DATA];

    if (!blob) return [];

    try {
        const plaintext = await decrypt(blob.iv, blob.ciphertext, key);
        return JSON.parse(plaintext);
    } catch {
        throw new Error('Failed to decrypt accounts. Wrong passphrase?');
    }
}

/**
 * Load settings from storage.
 */
export async function loadSettings() {
    const result = await browser.storage.local.get(STORAGE_KEY_SETTINGS);
    const stored = result[STORAGE_KEY_SETTINGS];
    return {
        autoLockMinutes: stored?.autoLockMinutes ?? 5,
        clipboardClearSeconds: stored?.clipboardClearSeconds ?? 30,
        theme: stored?.theme ?? 'system',
        accountHelpExpanded: stored?.accountHelpExpanded ?? true,
    };
}

/**
 * Save settings to storage.
 */
export async function saveSettings(settings) {
    await browser.storage.local.set({ [STORAGE_KEY_SETTINGS]: settings });
}

/**
 * Get the stored meta (for export/backup purposes).
 */
export async function getStoredMeta() {
    const result = await browser.storage.local.get(STORAGE_KEY_META);
    return result[STORAGE_KEY_META] || null;
}

/**
 * Get the raw encrypted blob (for backup/export).
 */
export async function getRawEncryptedData() {
    const result = await browser.storage.local.get(STORAGE_KEY_DATA);
    return result[STORAGE_KEY_DATA] || null;
}

/**
 * Import accounts, merging or replacing existing ones.
 */
export async function importAccounts(accounts, key, replace = false) {
    if (replace) {
        await saveAccounts(accounts, key);
    } else {
        const existing = await loadAccounts(key);
        const existingIds = new Set(existing.map(a => a.id));
        const merged = [...existing, ...accounts.filter(a => !existingIds.has(a.id))];
        await saveAccounts(merged, key);
    }
}

/**
 * Save biometric credential data (credential ID + PRF salt + encrypted passphrase).
 */
export async function saveBiometricData(data) {
    // Remove disabled flag if present
    const { disabled, ...cleanData } = data;
    await browser.storage.local.set({ redd2fa_biometric: cleanData });
}

/**
 * Load biometric credential data. Returns null if not set or disabled.
 */
export async function loadBiometricData() {
    const result = await browser.storage.local.get('redd2fa_biometric');
    const data = result.redd2fa_biometric || null;
    if (data?.disabled) return null;
    return data;
}

/**
 * Load biometric data even if disabled (for re-enabling without creating a new credential).
 */
export async function loadBiometricDataRaw() {
    const result = await browser.storage.local.get('redd2fa_biometric');
    return result.redd2fa_biometric || null;
}

/**
 * Soft-disable biometric unlock (keep credential data for potential re-use).
 */
export async function disableBiometric() {
    const result = await browser.storage.local.get('redd2fa_biometric');
    const data = result.redd2fa_biometric;
    if (data) {
        data.disabled = true;
        await browser.storage.local.set({ redd2fa_biometric: data });
    }
}

/**
 * Fully clear biometric data (used when passphrase changes and old data is invalid).
 */
export async function clearBiometricData() {
    await browser.storage.local.remove('redd2fa_biometric');
}

/**
 * Check if the extension has any data stored at all.
 */
export async function hasData() {
    const result = await browser.storage.local.get([STORAGE_KEY_META, STORAGE_KEY_DATA]);
    return !!(result[STORAGE_KEY_META] && result[STORAGE_KEY_DATA]);
}

// ----------------------------------------
// Backup fingerprint
//
// Lets the UI say "your backup is out of date" without keeping the backup.
// Stored (outside the encrypted blob) as { version: 2, salt, hash } where
// hash = SHA-256(salt + canonical account list). The random salt means the
// stored value cannot be tested against guessed labels or secrets.
//
// Releases up to 2.7 stored a bare, unsalted hex string over label + secret
// only. Those are recognised once and then replaced — see getBackupStatus().
// ----------------------------------------
const FINGERPRINT_VERSION = 2;

async function sha256Hex(text) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** True if a 2.7-era (v2) backup file could hold this account without loss. */
function hasDefaultParameters(account) {
    return (account.algorithm ?? 'SHA1') === 'SHA1'
        && (account.digits ?? 6) === 6
        && (account.period ?? 30) === 30;
}

/**
 * Fingerprint of everything a backup holds: labels, secret and the TOTP
 * parameters. Order-independent; ignores internal ids.
 */
export async function computeAccountsFingerprint(accounts, salt) {
    if (!accounts || accounts.length === 0) return null;
    const rows = accounts
        .map(a => JSON.stringify([
            a.issuer ?? '', a.accountName ?? '', a.secret,
            a.algorithm ?? 'SHA1', a.digits ?? 6, a.period ?? 30,
        ]))
        .sort();
    return sha256Hex(salt + JSON.stringify(rows));
}

/** The fingerprint as computed by releases up to 2.7. Only used to recognise old stored values. */
async function computeLegacyFingerprint(accounts) {
    const essential = accounts
        .map(a => ({ label: a.issuer || a.accountName, secret: a.secret }))
        .sort((a, b) => a.label.localeCompare(b.label) || a.secret.localeCompare(b.secret));
    return sha256Hex(JSON.stringify(essential));
}

/**
 * Save the current accounts fingerprint as the "last backed-up" state.
 */
export async function saveBackupFingerprint(accounts) {
    const salt = generateSalt();
    const hash = await computeAccountsFingerprint(accounts, salt);
    await browser.storage.local.set({
        [STORAGE_KEY_BACKUP_FINGERPRINT]: hash ? { version: FINGERPRINT_VERSION, salt, hash } : null,
    });
}

/**
 * Load the persisted brute-force lockout state.
 * Returns { failedAttempts, lockoutUntil } with safe defaults.
 */
export async function loadLockoutState() {
    const result = await browser.storage.local.get(STORAGE_KEY_LOCKOUT);
    const state = result[STORAGE_KEY_LOCKOUT];
    if (!state) return { failedAttempts: 0, lockoutUntil: 0 };
    return {
        failedAttempts: Number(state.failedAttempts) || 0,
        lockoutUntil: Number(state.lockoutUntil) || 0,
    };
}

/**
 * Persist the brute-force lockout state. Survives popup close.
 */
export async function saveLockoutState(state) {
    await browser.storage.local.set({
        [STORAGE_KEY_LOCKOUT]: {
            failedAttempts: state.failedAttempts,
            lockoutUntil: state.lockoutUntil,
        },
    });
}

/**
 * Clear the brute-force lockout state on successful unlock.
 */
export async function clearLockoutState() {
    await browser.storage.local.remove(STORAGE_KEY_LOCKOUT);
}

/**
 * Check whether the current accounts differ from the last backed-up state.
 * Returns 'current' if backup is up to date, 'never' if no backup exists,
 * or 'stale' if accounts have changed since the last backup.
 */
export async function getBackupStatus(accounts) {
    if (!accounts || accounts.length === 0) return 'current'; // nothing to back up
    const result = await browser.storage.local.get(STORAGE_KEY_BACKUP_FINGERPRINT);
    const saved = result[STORAGE_KEY_BACKUP_FINGERPRINT];
    if (!saved) return 'never';

    if (typeof saved === 'string') {
        // Written by 2.7 or earlier, whose backups held label + secret only.
        // Such a backup is complete only if nothing changed since AND every
        // account uses the default parameters. Otherwise ask for a new one.
        const unchanged = saved === await computeLegacyFingerprint(accounts);
        if (!unchanged || !accounts.every(hasDefaultParameters)) return 'stale';
        await saveBackupFingerprint(accounts); // replace the unsalted value
        return 'current';
    }

    if (saved.version !== FINGERPRINT_VERSION || typeof saved.salt !== 'string') return 'stale';
    const current = await computeAccountsFingerprint(accounts, saved.salt);
    return current === saved.hash ? 'current' : 'stale';
}
