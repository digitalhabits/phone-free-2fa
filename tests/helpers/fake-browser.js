/**
 * In-memory stand-in for browser.storage.local, for running src/ modules
 * under Node's built-in test runner. No dependencies.
 *
 * src/browser.js reads globalThis.browser when it is first imported, so
 * call installFakeBrowser() BEFORE importing any module that touches storage.
 *
 * Failure injection: failOnSet(n) makes the n-th set() call from now reject
 * without writing anything — this simulates a crash or storage error at
 * that point, so tests can check what state is left behind.
 */

/**
 * Browsers have the Web Locks API; older Node versions don't. Give those a
 * minimal one (a queue per lock name) so tests see what a browser does.
 */
function ensureWebLocks() {
    if (globalThis.navigator?.locks?.request) return;
    const queues = new Map();
    const locks = {
        request(name, callback) {
            const run = (queues.get(name) || Promise.resolve()).then(() => callback());
            queues.set(name, run.catch(() => { }));
            return run;
        },
    };
    if (globalThis.navigator) Object.defineProperty(globalThis.navigator, 'locks', { value: locks, configurable: true });
    else globalThis.navigator = { locks };
}

export function installFakeBrowser() {
    ensureWebLocks();
    let data = {};
    let setCalls = 0;
    let failAt = null;

    const clone = (v) => JSON.parse(JSON.stringify(v));

    const local = {
        async get(keys) {
            if (keys == null) return clone(data);
            const list = Array.isArray(keys) ? keys : [keys];
            const out = {};
            for (const k of list) {
                if (k in data) out[k] = clone(data[k]);
            }
            return out;
        },
        async set(items) {
            setCalls++;
            if (failAt !== null && setCalls === failAt) {
                throw new Error(`fake-browser: injected failure on set() #${setCalls}`);
            }
            // A single set() is applied all-or-nothing, like the real API.
            Object.assign(data, clone(items));
        },
        async remove(keys) {
            const list = Array.isArray(keys) ? keys : [keys];
            for (const k of list) delete data[k];
        },
    };

    globalThis.browser = { storage: { local } };

    return {
        /** Wipe storage and counters (fresh profile). */
        reset() { data = {}; setCalls = 0; failAt = null; },
        /** Make the n-th set() call from now fail without writing. */
        failOnSet(n) { setCalls = 0; failAt = n; },
        /** Stop injecting failures. */
        clearFailure() { failAt = null; },
        /** Snapshot of everything currently stored. */
        dump() { return clone(data); },
    };
}
