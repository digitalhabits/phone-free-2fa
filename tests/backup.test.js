/**
 * Encrypted backup tests — the export → import path must never change
 * which codes an account generates.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, readBackup, isEncryptedBackup, BackupError, BACKUP_VERSION } from '../src/backup.js';
import { generateSalt, deriveKey, encrypt } from '../src/crypto.js';
import { generateTOTP } from '../src/totp.js';

const PASSWORD = 'walnut-harbour-lantern-ninety';

/** One account for every supported algorithm × digits × period combination. */
function everyCombination() {
    const accounts = [];
    for (const algorithm of ['SHA1', 'SHA256', 'SHA512']) {
        for (const digits of [6, 8]) {
            for (const period of [30, 60]) {
                accounts.push({
                    id: `id-${accounts.length}`,
                    issuer: `Issuer ${algorithm}`,
                    accountName: `user-${digits}-${period}@example.com`,
                    secret: 'JBSWY3DPEHPK3PXPJBSWY3DP',
                    algorithm, digits, period,
                });
            }
        }
    }
    return accounts;
}

const withoutId = ({ id, ...rest }) => rest;

/** Build a backup file in an older format, the way older releases wrote it. */
async function legacyBackup(version, entries) {
    const salt = generateSalt();
    const key = await deriveKey(PASSWORD, salt);
    return { format: 'redd-2fa-backup', version, salt, ...(await encrypt(JSON.stringify(entries), key)) };
}

test('round-trip keeps algorithm, digits, period, issuer and account name', async () => {
    const accounts = everyCombination();
    const file = JSON.parse(JSON.stringify(await createBackup(accounts, PASSWORD))); // as written to disk
    assert.equal(file.version, BACKUP_VERSION);
    assert.deepEqual(await readBackup(file, PASSWORD), accounts.map(withoutId));
});

test('restored accounts generate the same codes as the originals', async () => {
    const accounts = everyCombination();
    const restored = await readBackup(await createBackup(accounts, PASSWORD), PASSWORD);
    const realNow = Date.now;
    Date.now = () => 1234567890 * 1000;
    try {
        for (let i = 0; i < accounts.length; i++) {
            const a = accounts[i], r = restored[i];
            assert.equal(
                await generateTOTP(r.secret, r.digits, r.period, r.algorithm),
                await generateTOTP(a.secret, a.digits, a.period, a.algorithm),
                `${a.algorithm}/${a.digits}/${a.period}`
            );
        }
    } finally { Date.now = realNow; }
});

test('the backup file holds no plaintext labels or secrets, and no internal ids', async () => {
    const accounts = everyCombination();
    const raw = JSON.stringify(await createBackup(accounts, PASSWORD));
    assert.ok(!raw.includes('JBSWY3DPEHPK3PXPJBSWY3DP'));
    assert.ok(!raw.includes('Issuer'));
    assert.ok(!raw.includes('example.com'));
    const restored = await readBackup(JSON.parse(raw), PASSWORD);
    assert.ok(restored.every(a => !('id' in a)));
});

test('an empty vault round-trips', async () => {
    assert.deepEqual(await readBackup(await createBackup([], PASSWORD), PASSWORD), []);
});

test('v2 backups (label + secret) still import, with defaults', async () => {
    const file = await legacyBackup(2, [{ label: 'Example', secret: 'JBSWY3DPEHPK3PXPJBSWY3DP' }]);
    assert.deepEqual(await readBackup(file, PASSWORD), [{
        issuer: 'Example', accountName: 'Example', secret: 'JBSWY3DPEHPK3PXPJBSWY3DP',
        algorithm: 'SHA1', digits: 6, period: 30,
    }]);
});

test('v1 backups (full account objects) keep their parameters and drop the old id', async () => {
    const file = await legacyBackup(1, [
        { id: 'old', issuer: 'Bank', accountName: 'alice', secret: 'KRSXG5CTMVRXEZLUKRSXG5CT', algorithm: 'SHA512', digits: 8, period: 60 },
        { id: 'old2', issuer: 'Plain', accountName: 'bob', secret: 'JBSWY3DPEHPK3PXPJBSWY3DP' },
    ]);
    assert.deepEqual(await readBackup(file, PASSWORD), [
        { issuer: 'Bank', accountName: 'alice', secret: 'KRSXG5CTMVRXEZLUKRSXG5CT', algorithm: 'SHA512', digits: 8, period: 60 },
        { issuer: 'Plain', accountName: 'bob', secret: 'JBSWY3DPEHPK3PXPJBSWY3DP', algorithm: 'SHA1', digits: 6, period: 30 },
    ]);
});

test('wrong password → wrong-password', async () => {
    const file = await createBackup(everyCombination(), PASSWORD);
    await assert.rejects(() => readBackup(file, PASSWORD + 'x'), { name: 'BackupError', code: 'wrong-password' });
});

test('tampered ciphertext → wrong-password (AES-GCM authentication)', async () => {
    const file = await createBackup(everyCombination(), PASSWORD);
    const bytes = Buffer.from(file.ciphertext, 'base64');
    bytes[5] ^= 0x01;
    await assert.rejects(
        () => readBackup({ ...file, ciphertext: bytes.toString('base64') }, PASSWORD),
        { code: 'wrong-password' }
    );
});

test('a backup from a newer version is refused, not guessed at', async () => {
    const file = await createBackup([], PASSWORD);
    await assert.rejects(() => readBackup({ ...file, version: BACKUP_VERSION + 1 }, PASSWORD), { code: 'too-new' });
});

test('malformed files → invalid', async () => {
    const file = await createBackup([], PASSWORD);
    const bad = [
        null,
        [],
        { format: 'something-else' },
        { ...file, version: undefined },
        { ...file, version: '3' },
        { ...file, version: 0 },
        { ...file, salt: undefined },
        { ...file, iv: 42 },
        { ...file, ciphertext: null },
        await legacyBackup(3, { not: 'an array' }),
        await legacyBackup(3, ['not an object']),
        await legacyBackup(3, [null]),
    ];
    for (const data of bad) {
        await assert.rejects(() => readBackup(data, PASSWORD), (err) => {
            assert.ok(err instanceof BackupError);
            assert.equal(err.code, 'invalid');
            return true;
        });
    }
});

test('one invalid account refuses the whole backup (no partial restores)', async () => {
    const good = { issuer: 'A', accountName: 'a', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 };
    for (const bad of [{ ...good, digits: 7 }, { ...good, secret: 42 }, { ...good, algorithm: 'MD5' }, { ...good, issuer: {} }]) {
        const file = await legacyBackup(3, [good, bad]);
        await assert.rejects(() => readBackup(file, PASSWORD), { code: 'invalid' }, JSON.stringify(bad));
    }
    await assert.rejects(async () => readBackup(await legacyBackup(2, [{ label: 'x', secret: null }]), PASSWORD), { code: 'invalid' });
});

test('isEncryptedBackup', async () => {
    assert.equal(isEncryptedBackup(await createBackup([], PASSWORD)), true);
    assert.equal(isEncryptedBackup([{ issuer: 'x' }]), false);
    assert.equal(isEncryptedBackup(null), false);
});

// 'é' typed as one character (NFC) and as 'e' + combining acute (NFD).
const NFC = 'café-harbour-lantern-ninety';
const NFD = 'café-harbour-lantern-ninety';

test('a backup opens with either spelling of an accented password, including one written before normalisation', async () => {
    const accounts = everyCombination();
    const fresh = await createBackup(accounts, NFD);
    assert.equal((await readBackup(fresh, NFC)).length, accounts.length);
    assert.equal((await readBackup(fresh, NFD)).length, accounts.length);

    const salt = generateSalt();
    const entries = accounts.map(({ id, ...a }) => a);
    const legacy = { format: 'redd-2fa-backup', version: 3, salt, ...(await encrypt(JSON.stringify(entries), await deriveKey(NFD, salt))) };
    assert.equal((await readBackup(legacy, NFC)).length, accounts.length);
    await assert.rejects(async () => readBackup(legacy, 'wrong-password-entirely'), { code: 'wrong-password' });
});
