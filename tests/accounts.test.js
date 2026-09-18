/**
 * Account object tests — editing must never change which codes an
 * account generates.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountFromForm, accountLabel, cleanImportedAccount, accountsFromUriList } from '../src/accounts.js';
import { parseOtpauthURI, buildOtpauthURI } from '../src/totp.js';

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

// ----------------------------------------
// Import validation
// ----------------------------------------
const GOOD = { issuer: 'Bank', accountName: 'alice', secret: 'KRSXG5CTMVRXEZLUKRSXG5CT', algorithm: 'SHA256', digits: 8, period: 60 };

test('cleanImportedAccount keeps a valid account exactly, and drops anything extra', () => {
    assert.deepEqual(cleanImportedAccount(GOOD), GOOD);
    assert.deepEqual(cleanImportedAccount({ ...GOOD, id: 'x', __proto__: { evil: 1 }, extra: '<img>' }), GOOD);
});

test('cleanImportedAccount applies defaults only to absent fields, and normalises the secret', () => {
    assert.deepEqual(cleanImportedAccount({ issuer: 'X', secret: 'jbsw y3dp-ehpk 3pxp==' }), {
        issuer: 'X', accountName: '', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30,
    });
});

test('cleanImportedAccount refuses unsupported settings instead of defaulting them', () => {
    const bad = [
        { algorithm: 'MD5' }, { algorithm: 'sha256' }, { algorithm: null }, { algorithm: 1 },
        { digits: 7 }, { digits: '6' }, { digits: null }, { digits: 6.5 },
        { period: 0 }, { period: -30 }, { period: 30.5 }, { period: '30' }, { period: null }, { period: 1e9 }, { period: NaN },
    ];
    for (const change of bad) {
        assert.throws(() => cleanImportedAccount({ ...GOOD, ...change }), Error, JSON.stringify(change));
    }
});

test('cleanImportedAccount refuses malformed entries (the things that used to wedge the UI)', () => {
    const bad = [
        null, undefined, 'string', 42, [], [GOOD],
        { ...GOOD, secret: undefined }, { ...GOOD, secret: 12345 }, { ...GOOD, secret: '' },
        { ...GOOD, secret: 'not base32 !!!' }, { ...GOOD, secret: 'ABC1DEF' }, { ...GOOD, secret: {} },
        { ...GOOD, issuer: 42 }, { ...GOOD, issuer: {} }, { ...GOOD, accountName: ['a'] },
        { ...GOOD, issuer: 'x'.repeat(1001) },
    ];
    for (const entry of bad) {
        assert.throws(() => cleanImportedAccount(entry), Error, JSON.stringify(entry));
    }
});

test('anything the URI parser accepts, import validation accepts (so every import can be backed up and restored)', () => {
    for (const algorithm of ['SHA1', 'SHA256', 'SHA512']) {
        for (const digits of [6, 8]) {
            for (const period of [1, 30, 60, 86400]) {
                const parsed = parseOtpauthURI(buildOtpauthURI({ ...GOOD, algorithm, digits, period }));
                assert.deepEqual(cleanImportedAccount(parsed), parsed);
            }
        }
    }
});

test('URI parser refuses unsupported settings instead of defaulting them', () => {
    const base = 'otpauth://totp/Bank:alice?secret=KRSXG5CTMVRXEZLUKRSXG5CT';
    for (const extra of ['&algorithm=MD5', '&digits=7', '&digits=5', '&digits=abc', '&period=0', '&period=-30', '&period=abc', '&period=30s', '&period=999999']) {
        assert.equal(parseOtpauthURI(base + extra), null, extra);
    }
    assert.equal(parseOtpauthURI(base + '&algorithm=sha256').algorithm, 'SHA256'); // case-insensitive per the spec
});

test('accountsFromUriList reads good lines and counts the ones it skipped', () => {
    const text = [
        '# my accounts',
        'otpauth://totp/Bank:alice?secret=KRSXG5CTMVRXEZLUKRSXG5CT&algorithm=SHA256&digits=8&period=60',
        '   otpauth://totp/Plain?secret=JBSWY3DPEHPK3PXP   ',
        'otpauth://totp/Seven?secret=JBSWY3DPEHPK3PXP&digits=7',
        'otpauth://hotp/Counter?secret=JBSWY3DPEHPK3PXP&counter=1',
        'otpauth://totp/NoSecret',
        'otpauth://totp/BadSecret?secret=!!!',
        '',
    ].join('\n');
    const { accounts, skipped } = accountsFromUriList(text);
    assert.equal(accounts.length, 2);
    assert.equal(skipped, 4);
    assert.deepEqual(accounts[0], { issuer: 'Bank', accountName: 'alice', secret: 'KRSXG5CTMVRXEZLUKRSXG5CT', algorithm: 'SHA256', digits: 8, period: 60 });
    assert.deepEqual(accountsFromUriList('nothing here'), { accounts: [], skipped: 0 });
});
