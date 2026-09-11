import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map();
let releaseAccountRead;
let resolveAccountReadStarted;
let deferAccountRead = true;
let deferMetaRead = false;
let resolveMetaReadStarted;
let releaseMetaRead;
const accountReadGate = new Promise(resolve => { releaseAccountRead = resolve; });
const accountReadStarted = new Promise(resolve => {
    resolveAccountReadStarted = resolve;
});
const metaReadGate = new Promise(resolve => { releaseMetaRead = resolve; });
const metaReadStarted = new Promise(resolve => { resolveMetaReadStarted = resolve; });

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

const elements = new Map();
function makeElement(id) {
    const listeners = new Map();
    return {
        id,
        value: '',
        textContent: '',
        style: { display: 'none' },
        classList: { add() { }, remove() { }, toggle() { } },
        dataset: {},
        checked: false,
        disabled: false,
        parentElement: { classList: { add() { }, remove() { } } },
        addEventListener(type, callback) { listeners.set(type, callback); },
        getListener(type) { return listeners.get(type); },
        focus() { },
        setAttribute() { },
        replaceChildren() { },
        append() { },
        appendChild() { },
        querySelector() { return null; },
        querySelectorAll() { return []; },
    };
}

const documentListeners = new Map();
globalThis.document = {
    documentElement: { classList: { add() { }, remove() { } } },
    getElementById(id) {
        if (!elements.has(id)) elements.set(id, makeElement(id));
        return elements.get(id);
    },
    addEventListener(type, callback) { documentListeners.set(type, callback); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    createDocumentFragment() { return makeElement('fragment'); },
    createElement() { return makeElement('created'); },
    createElementNS() { return makeElement('created-ns'); },
};

globalThis.window = {
    matchMedia() { return { matches: false, addEventListener() { } }; },
    addEventListener() { },
    open() { },
};

const browserState = {
    storage: {
        local: {
            async get(keys) {
                if (keys === 'redd2fa_data' && deferAccountRead) {
                    resolveAccountReadStarted();
                    await accountReadGate;
                }
                if (keys === 'redd2fa_meta' && deferMetaRead) {
                    resolveMetaReadStarted();
                    await metaReadGate;
                }
                if (Array.isArray(keys)) {
                    return Object.fromEntries(keys.map(key => [key, clone(values.get(key))]));
                }
                return { [keys]: clone(values.get(keys)) };
            },
            async set(entries) {
                for (const [key, value] of Object.entries(entries)) values.set(key, clone(value));
            },
            async remove(keys) {
                for (const key of (Array.isArray(keys) ? keys : [keys])) values.delete(key);
            },
        },
    },
    runtime: { onMessage: { addListener() { } }, getURL(path) { return path; } },
};
globalThis.browser = browserState;

test('passphrase unlock completion after lock cannot restore the wiped session', async () => {
    const storage = await import('../src/storage.js');
    const session = await import('../src/session.js');
    await storage.setupPassphrase('old passphrase for popup test');
    values.set('redd2fa_eula', { acceptedRevision: 1 });

    await import(`../src/popup.js?popup-race=${Date.now()}`);
    await documentListeners.get('DOMContentLoaded')();

    const unlockInput = elements.get('unlock-passphrase');
    const unlockButton = elements.get('unlock-btn');
    unlockInput.value = 'old passphrase for popup test';
    const unlockPromise = unlockButton.getListener('click')();
    await accountReadStarted;

    session.lock();
    releaseAccountRead();
    await unlockPromise;
    deferAccountRead = false;

    assert.equal(session.isUnlocked(), false);
    assert.equal(elements.get('main-screen').style.display, 'none');
    assert.equal(elements.get('lock-screen').style.display, 'block');
    assert.equal(unlockButton.disabled, false);
});

test('lock during current-passphrase verification does not rotate a wiped account list', async () => {
    const storage = await import('../src/storage.js');
    const session = await import('../src/session.js');
    const passphrase = 'old passphrase for popup test';
    const key = await storage.setupPassphrase(passphrase);
    const account = {
        id: 'one', issuer: 'Example', accountName: 'Example',
        secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30,
    };
    await storage.saveAccounts([account], key);

    const unlockInput = elements.get('unlock-passphrase');
    const unlockButton = elements.get('unlock-btn');
    unlockInput.value = passphrase;
    await unlockButton.getListener('click')();
    assert.equal(session.isUnlocked(), true);

    elements.get('change-passphrase-btn').getListener('click')();
    elements.get('current-passphrase').value = passphrase;
    elements.get('new-passphrase').value = 'new secure passphrase for popup';
    elements.get('new-passphrase-confirm').value = 'new secure passphrase for popup';
    const oldMeta = clone(values.get('redd2fa_meta'));
    const oldData = clone(values.get('redd2fa_data'));

    deferMetaRead = true;
    const changePromise = elements.get('change-passphrase-confirm-btn').getListener('click')();
    await metaReadStarted;
    document.visibilityState = 'hidden';
    documentListeners.get('visibilitychange')();
    document.visibilityState = 'visible';
    deferMetaRead = false;
    releaseMetaRead();
    // The pending get resolves with the existing metadata after the lock.
    await changePromise;

    assert.equal(session.isUnlocked(), false);
    assert.deepEqual(values.get('redd2fa_meta'), oldMeta);
    assert.deepEqual(values.get('redd2fa_data'), oldData);
});
