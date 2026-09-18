/**
 * Phone-Free 2FA — Account objects
 *
 * An account is:
 *   { id, issuer, accountName, secret, algorithm, digits, period }
 * `algorithm`, `digits` and `period` decide which codes are generated, so
 * nothing may change them as a side effect. Kept free of UI code so it can
 * be tested directly (tests/accounts.test.js).
 */

import { normalizeSecret, parseOtpauthURI } from './totp.js';

export const SUPPORTED_ALGORITHMS = ['SHA1', 'SHA256', 'SHA512'];
export const SUPPORTED_DIGITS = [6, 8];
const MAX_PERIOD_SECONDS = 86400;
const MAX_LABEL_LENGTH = 1000;

/** The label shown in the list and in the edit form. */
export function accountLabel(account) {
    return account.issuer || account.accountName;
}

/**
 * Build the account to save from the add/edit form, which only has a label
 * and a secret.
 *
 * `existing` is the account being edited, or null when adding. When editing,
 * everything the form cannot show carries over: the TOTP parameters always,
 * and a separate account name (issuer "Bank", name "alice@example.com")
 * survives a rename — the label replaces the issuer only.
 */
export function accountFromForm(existing, { id, label, secret }) {
    if (!existing) {
        return {
            id, issuer: label, accountName: label, secret: normalizeSecret(secret),
            algorithm: 'SHA1', digits: 6, period: 30,
        };
    }
    const hasIssuer = typeof existing.issuer === 'string' && existing.issuer.trim() !== '';
    const hasOwnName = hasIssuer
        && typeof existing.accountName === 'string'
        && existing.accountName !== existing.issuer;
    return {
        id: existing.id,
        issuer: hasIssuer ? label : '',
        accountName: hasOwnName ? existing.accountName : label,
        secret: normalizeSecret(secret),
        algorithm: existing.algorithm ?? 'SHA1',
        digits: existing.digits ?? 6,
        period: existing.period ?? 30,
    };
}

/**
 * Check and clean one account read from a file (backup, JSON or URI list)
 * before it goes anywhere near the vault. Returns a new object with exactly
 * the account fields (no `id` — the caller assigns one), or throws.
 *
 * Absent TOTP parameters get the defaults. Parameters that are present but
 * unsupported are refused, never replaced by a default: a default would
 * import "successfully" and then generate the wrong codes.
 *
 * The secret only has to be Base32 — no minimum length — so that a backup
 * of any account this extension has ever accepted can always be restored.
 */
export function cleanImportedAccount(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Account is not an object.');
    }

    const text = (value, name) => {
        if (value === undefined || value === null) return '';
        if (typeof value !== 'string') throw new Error(`Account ${name} is not text.`);
        if (value.length > MAX_LABEL_LENGTH) throw new Error(`Account ${name} is too long.`);
        return value;
    };
    const issuer = text(raw.issuer, 'issuer');
    const accountName = text(raw.accountName, 'name');

    if (typeof raw.secret !== 'string') throw new Error('Account secret is missing.');
    const secret = normalizeSecret(raw.secret);
    if (!/^[A-Z2-7]+$/.test(secret)) throw new Error('Account secret is not Base32.');

    const algorithm = raw.algorithm === undefined ? 'SHA1' : raw.algorithm;
    if (!SUPPORTED_ALGORITHMS.includes(algorithm)) throw new Error('Unsupported algorithm.');

    const digits = raw.digits === undefined ? 6 : raw.digits;
    if (!SUPPORTED_DIGITS.includes(digits)) throw new Error('Unsupported number of digits.');

    const period = raw.period === undefined ? 30 : raw.period;
    if (!Number.isInteger(period) || period < 1 || period > MAX_PERIOD_SECONDS) {
        throw new Error('Unsupported period.');
    }

    return { issuer, accountName, secret, algorithm, digits, period };
}

/**
 * Read a text file of otpauth:// URIs, one per line.
 * Returns { accounts, skipped } where `skipped` counts otpauth:// lines that
 * could not be used (malformed, not TOTP, or unsupported settings).
 */
export function accountsFromUriList(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('otpauth://'));
    const accounts = [];
    for (const line of lines) {
        try {
            const parsed = parseOtpauthURI(line);
            if (parsed) accounts.push(cleanImportedAccount(parsed));
        } catch { /* counted as skipped below */ }
    }
    return { accounts, skipped: lines.length - accounts.length };
}
