/**
 * Phone-Free 2FA — Encrypted backup format
 *
 * Builds and reads the encrypted backup file. Kept free of any UI code so
 * the whole export → import path can be tested end to end (tests/backup.test.js).
 *
 * File layout (JSON):
 *   { format: 'redd-2fa-backup', version, salt, iv, ciphertext }
 * The ciphertext is AES-256-GCM over a JSON array, keyed by PBKDF2 of the
 * backup password and `salt` (same parameters as the vault, see crypto.js).
 *
 * Plaintext array, by version:
 *   v3 (current): { issuer, accountName, secret, algorithm, digits, period }
 *   v2:           { label, secret } — lossy: accounts that were not
 *                 SHA1 / 6 digits / 30 s cannot be restored correctly from it
 *   v1:           the full internal account objects
 */

import { generateSalt, deriveKey, encrypt, decrypt } from './crypto.js';
import { cleanImportedAccount } from './accounts.js';

export const BACKUP_FORMAT = 'redd-2fa-backup';
export const BACKUP_VERSION = 3;

/** Every field that affects which codes an account generates, plus its labels. */
const ACCOUNT_FIELDS = ['issuer', 'accountName', 'secret', 'algorithm', 'digits', 'period'];

/**
 * Error with a machine-readable `code`:
 *   'wrong-password' — decryption failed (wrong password, or the file was altered)
 *   'too-new'        — written by a newer version of the extension
 *   'invalid'        — not a well-formed backup
 */
export class BackupError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'BackupError';
        this.code = code;
    }
}

/** True if `data` (parsed JSON) claims to be one of our encrypted backups. */
export function isEncryptedBackup(data) {
    return !!data && typeof data === 'object' && data.format === BACKUP_FORMAT;
}

/**
 * Encrypt `accounts` under `password`. Returns the object to write out as JSON.
 */
export async function createBackup(accounts, password) {
    const entries = accounts.map(account => {
        const entry = {};
        for (const field of ACCOUNT_FIELDS) entry[field] = account[field];
        return entry;
    });

    const salt = generateSalt();
    const key = await deriveKey(password, salt);
    const encrypted = await encrypt(JSON.stringify(entries), key);

    return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        salt,
        ...encrypted,
    };
}

/**
 * Decrypt a backup. Returns an array of accounts (without `id` — the caller
 * assigns fresh ones). Throws BackupError.
 */
export async function readBackup(data, password) {
    if (!isEncryptedBackup(data)) {
        throw new BackupError('invalid', 'Not a Phone-Free 2FA backup.');
    }
    if (!Number.isInteger(data.version) || data.version < 1) {
        throw new BackupError('invalid', 'Backup has no valid version.');
    }
    if (data.version > BACKUP_VERSION) {
        throw new BackupError('too-new', 'Backup was made by a newer version of Phone-Free 2FA.');
    }
    if (typeof data.salt !== 'string' || typeof data.iv !== 'string' || typeof data.ciphertext !== 'string') {
        throw new BackupError('invalid', 'Backup is missing its salt, iv or ciphertext.');
    }

    let plaintext;
    try {
        const key = await deriveKey(password, data.salt);
        plaintext = await decrypt(data.iv, data.ciphertext, key);
    } catch {
        throw new BackupError('wrong-password', 'Wrong password or corrupted backup.');
    }

    let entries;
    try {
        entries = JSON.parse(plaintext);
    } catch {
        throw new BackupError('invalid', 'Backup contents are not valid JSON.');
    }
    if (!Array.isArray(entries)) {
        throw new BackupError('invalid', 'Backup contents are not a list of accounts.');
    }

    return entries.map(entry => accountFromEntry(entry, data.version));
}

/**
 * Convert one decrypted entry to a checked account. One bad entry refuses
 * the whole backup: a partial restore that looks complete is worse than none.
 */
function accountFromEntry(entry, version) {
    // v2 stored a single label and nothing else about the account.
    const source = version === 2 && entry && typeof entry === 'object'
        ? { issuer: entry.label, accountName: entry.label, secret: entry.secret }
        : entry;
    try {
        return cleanImportedAccount(source);
    } catch (err) {
        throw new BackupError('invalid', `Backup contains an invalid account: ${err.message}`);
    }
}
