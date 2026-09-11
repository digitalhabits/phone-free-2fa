import test from 'node:test';
import assert from 'node:assert/strict';

const state = new Map();
let setCalls = [];
let failNextSet = false;

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

globalThis.browser = {
    storage: {
        local: {
            async get(keys) {
                if (Array.isArray(keys)) {
                    return Object.fromEntries(keys.map(key => [key, clone(state.get(key))]));
                }
                return { [keys]: clone(state.get(keys)) };
            },
            async set(values) {
                setCalls.push(clone(values));
                if (failNextSet) {
                    failNextSet = false;
                    throw new Error('simulated storage failure');
                }
                for (const [key, value] of Object.entries(values)) state.set(key, clone(value));
            },
            async remove(keys) {
                for (const key of (Array.isArray(keys) ? keys : [keys])) state.delete(key);
            },
        },
    },
};

let moduleId = 0;
async function loadStorage() {
    return import(`../src/storage.js?test-window=${++moduleId}`);
}

function resetStorage() {
    state.clear();
    setCalls = [];
    failNextSet = false;
}

const OLD_PASS = 'old passphrase for tests';
const NEW_PASS = 'new passphrase for tests';
const account = {
    id: 'one',
    issuer: 'Example',
    accountName: 'Example',
    secret: 'JBSWY3DPEHPK3PXP',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
};

test('setup writes revision, metadata, and initial ciphertext atomically', async () => {
    resetStorage();
    const storage = await loadStorage();

    const key = await storage.setupPassphrase(OLD_PASS);
    assert.equal(setCalls.length, 1);
    assert.ok(setCalls[0].redd2fa_meta.revision);
    assert.ok(setCalls[0].redd2fa_data.iv);
    assert.deepEqual(await storage.loadAccounts(key), []);
});

test('failed atomic rotation leaves the old passphrase and accounts usable', async () => {
    resetStorage();
    const storage = await loadStorage();
    const oldKey = await storage.setupPassphrase(OLD_PASS);
    await storage.saveAccounts([account], oldKey);
    const oldMeta = clone(state.get('redd2fa_meta'));
    const oldData = clone(state.get('redd2fa_data'));

    failNextSet = true;
    await assert.rejects(storage.changePassphrase([account], NEW_PASS), /simulated storage failure/);
    assert.deepEqual(state.get('redd2fa_meta'), oldMeta);
    assert.deepEqual(state.get('redd2fa_data'), oldData);

    const stillValidKey = await storage.unlockWithPassphrase(OLD_PASS);
    assert.ok(stillValidKey);
    assert.deepEqual(await storage.loadAccounts(stillValidKey), [account]);
    assert.equal(await storage.unlockWithPassphrase(NEW_PASS), null);
});

test('a stale page cannot save after another page rotates the vault', async () => {
    resetStorage();
    const writer = await loadStorage();
    const writerKey = await writer.setupPassphrase(OLD_PASS);
    await writer.saveAccounts([account], writerKey);

    const stalePage = await loadStorage();
    const staleKey = await stalePage.unlockWithPassphrase(OLD_PASS);
    await writer.changePassphrase([account], NEW_PASS);
    const dataAfterRotation = clone(state.get('redd2fa_data'));

    await assert.rejects(
        stalePage.saveAccounts([], staleKey),
        error => error instanceof Error
            && error.message === stalePage.STALE_SESSION_ERROR,
    );
    assert.deepEqual(state.get('redd2fa_data'), dataAfterRotation);
});

test('legacy metadata remains unlockable and gets a revision on rotation', async () => {
    resetStorage();
    const legacySource = await loadStorage();
    const oldKey = await legacySource.setupPassphrase(OLD_PASS);
    await legacySource.saveAccounts([account], oldKey);
    const legacyMeta = clone(state.get('redd2fa_meta'));
    delete legacyMeta.revision;
    state.set('redd2fa_meta', legacyMeta);

    const legacyPage = await loadStorage();
    const legacyKey = await legacyPage.unlockWithPassphrase(OLD_PASS);
    assert.ok(legacyKey);
    assert.deepEqual(await legacyPage.loadAccounts(legacyKey), [account]);

    await legacyPage.changePassphrase([account], NEW_PASS);
    assert.ok(state.get('redd2fa_meta').revision);
    assert.deepEqual(await legacyPage.loadAccounts(await legacyPage.unlockWithPassphrase(NEW_PASS)), [account]);
});
