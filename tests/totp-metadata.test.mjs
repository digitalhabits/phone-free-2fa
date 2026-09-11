import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map();

globalThis.browser = {
    storage: {
        local: {
            async get(keys) {
                if (Array.isArray(keys)) {
                    return Object.fromEntries(keys.map(key => [key, values.get(key)]));
                }
                return { [keys]: values.get(keys) };
            },
            async set(entries) {
                for (const [key, value] of Object.entries(entries)) values.set(key, value);
            },
            async remove(keys) {
                for (const key of (Array.isArray(keys) ? keys : [keys])) values.delete(key);
            },
        },
    },
};

function makeElement() {
    return {
        value: '',
        style: {},
        classList: { add() { }, remove() { }, toggle() { } },
        parentElement: { classList: { add() { }, remove() { } } },
        dataset: {},
        addEventListener() { },
        setAttribute() { },
        focus() { },
        querySelector() { return null; },
    };
}

globalThis.document = {
    documentElement: { classList: { add() { }, remove() { } } },
    getElementById() { return makeElement(); },
    addEventListener() { },
    querySelectorAll() { return []; },
};

globalThis.window = {
    matchMedia() {
        return { matches: false, addEventListener() { } };
    },
    addEventListener() { },
};

const popup = await import(`../src/popup.js?totp-metadata=${Date.now()}`);
const storage = await import(`../src/storage.js?totp-metadata=${Date.now()}`);
const cryptoModule = await import('../src/crypto.js');

const secret = 'JBSWY3DPEHPK3PXP';

test('editing preserves non-exposed TOTP metadata and a distinct account name', () => {
    const existing = {
        id: 'existing-id',
        issuer: 'Old issuer',
        accountName: 'alice@example.com',
        secret,
        algorithm: 'SHA256',
        digits: 8,
        period: 60,
    };

    const edited = popup.buildAccountFromForm(existing, 'New issuer', secret);

    assert.equal(edited.id, existing.id);
    assert.equal(edited.issuer, 'New issuer');
    assert.equal(edited.accountName, 'alice@example.com');
    assert.equal(edited.algorithm, 'SHA256');
    assert.equal(edited.digits, 8);
    assert.equal(edited.period, 60);
});

test('editing an issuerless account keeps issuer empty and updates its account name', () => {
    const existing = {
        id: 'issuerless-id',
        issuer: '',
        accountName: 'alice@example.com',
        secret,
        algorithm: 'SHA256',
        digits: 8,
        period: 60,
    };

    const edited = popup.buildAccountFromForm(existing, 'New label', secret);

    assert.equal(edited.issuer, '');
    assert.equal(edited.accountName, 'New label');
    assert.equal(edited.algorithm, 'SHA256');
    assert.equal(edited.digits, 8);
    assert.equal(edited.period, 60);
});

test('v3 encrypted backup round-trip preserves operational and display fields', async () => {
    const account = {
        id: 'old-id',
        issuer: 'Example issuer',
        accountName: 'alice@example.com',
        secret,
        algorithm: 'SHA512',
        digits: 8,
        period: 60,
    };
    const exported = popup.buildV3BackupAccount(account);
    assert.deepEqual(exported, {
        issuer: account.issuer,
        accountName: account.accountName,
        secret,
        algorithm: 'SHA512',
        digits: 8,
        period: 60,
    });

    const key = await cryptoModule.deriveKey('backup passphrase', cryptoModule.generateSalt());
    const encrypted = await cryptoModule.encrypt(JSON.stringify([exported]), key);
    const plaintext = await cryptoModule.decrypt(encrypted.iv, encrypted.ciphertext, key);
    const restored = popup.normaliseV3BackupAccount(JSON.parse(plaintext)[0]);

    assert.notEqual(restored.id, account.id);
    assert.deepEqual({ ...restored, id: undefined }, { ...account, id: undefined });
});

test('v3 import applies parseOtpauthURI-compatible defaults to malformed options', () => {
    const imported = popup.normaliseV3BackupAccount({
        issuer: 'Example',
        accountName: 'alice',
        secret,
        algorithm: 'MD5',
        digits: 7,
        period: -1,
    });
    assert.ok(imported.id);
    assert.deepEqual({ ...imported, id: undefined }, {
        id: undefined,
        issuer: 'Example',
        accountName: 'alice',
        secret,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
    });
});

test('v3 import rejects a malformed secret after normalisation', () => {
    assert.equal(
        popup.normaliseV3BackupAccount({
            issuer: 'Example',
            accountName: 'alice',
            secret: 'JBSWY3DPEHPK3PX0',
        }),
        null,
    );
});

test('v2 encrypted backup entries keep label and SHA1/6/30 defaults', () => {
    const imported = popup.normaliseV2BackupAccount({ label: 'Legacy account', secret });
    assert.equal(imported.issuer, 'Legacy account');
    assert.equal(imported.accountName, 'Legacy account');
    assert.equal(imported.secret, secret);
    assert.equal(imported.algorithm, 'SHA1');
    assert.equal(imported.digits, 6);
    assert.equal(imported.period, 30);
    assert.ok(imported.id);
});

test('encrypted backup normalisation rejects unsupported versions', () => {
    assert.throws(
        () => popup.normaliseEncryptedBackup(4, []),
        /Unsupported encrypted backup version/,
    );
});

test('fingerprint ignores IDs and order but changes for identity and OTP metadata', async () => {
    const first = {
        id: 'first',
        issuer: 'Example',
        accountName: 'alice',
        secret,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
    };
    const second = {
        id: 'second',
        issuer: 'Other',
        accountName: 'bob',
        secret: 'JBSWY3DPEHPK3PXQ',
        algorithm: 'SHA512',
        digits: 8,
        period: 60,
    };
    const baseline = await storage.computeAccountsFingerprint([first, second]);
    const reordered = await storage.computeAccountsFingerprint([
        { ...second, id: 'new-second-id' },
        { ...first, id: 'new-first-id' },
    ]);
    assert.equal(reordered, baseline);

    for (const [field, value] of [
        ['algorithm', 'SHA256'],
        ['digits', 8],
        ['period', 60],
        ['accountName', 'renamed'],
    ]) {
        const changed = await storage.computeAccountsFingerprint([
            { ...first, [field]: value },
            second,
        ]);
        assert.notEqual(changed, baseline, `${field} must affect the fingerprint`);
    }
});
