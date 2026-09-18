/**
 * Account object tests — editing must never change which codes an
 * account generates.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountFromForm, accountLabel } from '../src/accounts.js';

const IMPORTED = {
    id: 'a1', issuer: 'Bank', accountName: 'alice@example.com',
    secret: 'KRSXG5CTMVRXEZLUKRSXG5CT', algorithm: 'SHA256', digits: 8, period: 60,
};

test('adding an account uses the defaults and normalises the secret', () => {
    assert.deepEqual(accountFromForm(null, { id: 'new', label: 'Example', secret: 'jbsw y3dp-ehpk 3pxp' }), {
        id: 'new', issuer: 'Example', accountName: 'Example',
        secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30,
    });
});

test('renaming keeps algorithm, digits and period', () => {
    const edited = accountFromForm(IMPORTED, { id: 'ignored', label: 'My bank', secret: IMPORTED.secret });
    assert.deepEqual(edited, { ...IMPORTED, issuer: 'My bank', accountName: 'My bank' });
});

test('saving the edit form without changes changes nothing', () => {
    const edited = accountFromForm(IMPORTED, { id: 'ignored', label: accountLabel(IMPORTED), secret: IMPORTED.secret });
    assert.deepEqual(edited, IMPORTED);
});

test('changing the secret keeps the parameters and the id', () => {
    const edited = accountFromForm(IMPORTED, { id: 'ignored', label: 'Bank', secret: 'MFRGGZDFMZTWQ2LKMFRGGZDF' });
    assert.deepEqual(edited, { ...IMPORTED, secret: 'MFRGGZDFMZTWQ2LKMFRGGZDF' });
});

test('accounts saved before these fields existed fall back to the defaults', () => {
    const old = { id: 'o1', issuer: 'Old', accountName: 'Old', secret: 'JBSWY3DPEHPK3PXP' };
    const edited = accountFromForm(old, { id: 'ignored', label: 'Old', secret: old.secret });
    assert.deepEqual(edited, { ...old, algorithm: 'SHA1', digits: 6, period: 30 });
});
