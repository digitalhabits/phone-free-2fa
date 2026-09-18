/**
 * TOTP engine tests — RFC 6238 Appendix B test vectors plus otpauth:// URI
 * parsing/building.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTOTP, parseOtpauthURI, buildOtpauthURI, validateBase32, normalizeSecret } from '../src/totp.js';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32-encode an ASCII string (test helper; src/ only needs decoding). */
function base32Encode(ascii) {
    let bits = '';
    for (const ch of ascii) bits += ch.charCodeAt(0).toString(2).padStart(8, '0');
    let out = '';
    for (let i = 0; i < bits.length; i += 5) {
        out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
    }
    return out;
}

/** Run fn with Date.now() frozen at the given Unix time (seconds). */
async function atUnixTime(seconds, fn) {
    const realNow = Date.now;
    Date.now = () => seconds * 1000;
    try { return await fn(); } finally { Date.now = realNow; }
}

// RFC 6238 Appendix B. Seeds are the ASCII digits repeated to the hash's block-appropriate length.
const SEEDS = {
    SHA1: base32Encode('12345678901234567890'),
    SHA256: base32Encode('12345678901234567890123456789012'),
    SHA512: base32Encode('1234567890123456789012345678901234567890123456789012345678901234'),
};

const RFC_VECTORS = [
    // [unix time, SHA1, SHA256, SHA512] — 8-digit codes, 30 s period
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
];

test('RFC 6238 vectors: 8 digits, all three algorithms', async () => {
    for (const [time, sha1, sha256, sha512] of RFC_VECTORS) {
        await atUnixTime(time, async () => {
            assert.equal(await generateTOTP(SEEDS.SHA1, 8, 30, 'SHA1'), sha1, `SHA1 @ ${time}`);
            assert.equal(await generateTOTP(SEEDS.SHA256, 8, 30, 'SHA256'), sha256, `SHA256 @ ${time}`);
            assert.equal(await generateTOTP(SEEDS.SHA512, 8, 30, 'SHA512'), sha512, `SHA512 @ ${time}`);
        });
    }
});

test('6-digit codes are the last six digits of the RFC 8-digit codes', async () => {
    for (const [time, sha1, sha256, sha512] of RFC_VECTORS) {
        await atUnixTime(time, async () => {
            assert.equal(await generateTOTP(SEEDS.SHA1, 6, 30, 'SHA1'), sha1.slice(2));
            assert.equal(await generateTOTP(SEEDS.SHA256, 6, 30, 'SHA256'), sha256.slice(2));
            assert.equal(await generateTOTP(SEEDS.SHA512, 6, 30, 'SHA512'), sha512.slice(2));
        });
    }
});

test('period changes the counter: 60 s period at t=118 equals 30 s period at t=59', async () => {
    const at60 = await atUnixTime(118, () => generateTOTP(SEEDS.SHA1, 8, 60, 'SHA1'));
    assert.equal(at60, '94287082'); // counter 1, same as the first RFC vector
});

test('algorithm, digits and period all change the code (why backups must keep them)', async () => {
    await atUnixTime(1234567890, async () => {
        const secret = SEEDS.SHA256;
        const real = await generateTOTP(secret, 8, 60, 'SHA256');
        const defaulted = await generateTOTP(secret, 6, 30, 'SHA1');
        assert.notEqual(real, defaulted);
        assert.notEqual(real.slice(2), defaulted);
    });
});

test('parseOtpauthURI reads non-default parameters', () => {
    const parsed = parseOtpauthURI(
        'otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DP&issuer=Example&algorithm=SHA256&digits=8&period=60'
    );
    assert.deepEqual(parsed, {
        issuer: 'Example',
        accountName: 'alice@example.com',
        secret: 'JBSWY3DPEHPK3PXPJBSWY3DP',
        algorithm: 'SHA256',
        digits: 8,
        period: 60,
    });
});

test('parseOtpauthURI applies defaults and rejects non-TOTP URIs', () => {
    const parsed = parseOtpauthURI('otpauth://totp/alice?secret=jbsw%20y3dp-ehpk3pxpjbswy3dp');
    assert.equal(parsed.algorithm, 'SHA1');
    assert.equal(parsed.digits, 6);
    assert.equal(parsed.period, 30);
    assert.equal(parsed.secret, 'JBSWY3DPEHPK3PXPJBSWY3DP');

    assert.equal(parseOtpauthURI('otpauth://hotp/alice?secret=JBSWY3DPEHPK3PXP'), null);
    assert.equal(parseOtpauthURI('https://example.com/?secret=JBSWY3DPEHPK3PXP'), null);
    assert.equal(parseOtpauthURI('otpauth://totp/alice'), null);
    assert.equal(parseOtpauthURI('not a uri'), null);
});

test('buildOtpauthURI → parseOtpauthURI round-trips every parameter combination', () => {
    for (const algorithm of ['SHA1', 'SHA256', 'SHA512']) {
        for (const digits of [6, 8]) {
            for (const period of [30, 60]) {
                const account = {
                    issuer: 'Ex & Co',
                    accountName: 'alice+test@example.com',
                    secret: 'JBSWY3DPEHPK3PXPJBSWY3DP',
                    algorithm, digits, period,
                };
                assert.deepEqual(parseOtpauthURI(buildOtpauthURI(account)), account);
            }
        }
    }
});

test('validateBase32 and normalizeSecret', () => {
    assert.equal(validateBase32('JBSW Y3DP-EHPK 3PXP'), true);
    assert.equal(validateBase32('jbswy3dpehpk3pxp'), true);
    assert.equal(validateBase32('JBSWY3DP'), false); // too short
    assert.equal(validateBase32('JBSWY3DPEHPK3PX1'), false); // 1 is not Base32
    assert.equal(validateBase32(''), false);
    assert.equal(normalizeSecret('jbsw y3dp-ehpk 3pxp=='), 'JBSWY3DPEHPK3PXP');
});
