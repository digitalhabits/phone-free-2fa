/**
 * Phone-Free 2FA — Account objects
 *
 * An account is:
 *   { id, issuer, accountName, secret, algorithm, digits, period }
 * `algorithm`, `digits` and `period` decide which codes are generated, so
 * nothing may change them as a side effect. Kept free of UI code so it can
 * be tested directly (tests/accounts.test.js).
 */

import { normalizeSecret } from './totp.js';

/** The label shown in the list and in the edit form. */
export function accountLabel(account) {
    return account.issuer || account.accountName;
}

/**
 * Build the account to save from the add/edit form, which only has a label
 * and a secret.
 *
 * `existing` is the account being edited, or null when adding. When editing,
 * the TOTP parameters always carry over, and issuer / accountName are only
 * replaced if the user actually changed the label.
 */
export function accountFromForm(existing, { id, label, secret }) {
    const labelChanged = !existing || label !== accountLabel(existing);
    return {
        id: existing ? existing.id : id,
        issuer: labelChanged ? label : existing.issuer,
        accountName: labelChanged ? label : existing.accountName,
        secret: normalizeSecret(secret),
        algorithm: existing?.algorithm ?? 'SHA1',
        digits: existing?.digits ?? 6,
        period: existing?.period ?? 30,
    };
}
