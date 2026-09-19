/**
 * The least DOM that lets src/popup.js load and run under Node, so its
 * handlers can be driven from tests. Every element exists on demand, records
 * what is assigned to it, and remembers its event listeners.
 * (Technique from Konrad Kollnig's PR #7.)
 *
 * Call installFakeDom() BEFORE importing popup.js.
 */

/** ".foo" → "foo"; anything else is treated as a tag name. */
const classOf = (selector) => (selector.startsWith('.') ? selector.slice(1) : null);

function makeElement(id) {
    const listeners = new Map();
    const classes = new Set();
    const el = {
        id,
        value: '',
        textContent: '',
        innerHTML: '',
        type: 'text',
        checked: false,
        disabled: false,
        files: [],
        style: { display: 'none' },
        dataset: {},
        children: [],
        parent: null,
        get className() { return [...classes].join(' '); },
        set className(value) {
            classes.clear();
            for (const c of String(value).split(/\s+/).filter(Boolean)) classes.add(c);
        },
        classList: {
            add(...c) { c.forEach((x) => classes.add(x)); },
            remove(...c) { c.forEach((x) => classes.delete(x)); },
            toggle(c, on) { (on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c); },
            contains: (c) => classes.has(c),
        },
        addEventListener(type, callback) { listeners.set(type, callback); },
        /** Run the listener registered for `type`, as the browser would. */
        fire(type, event = {}) { return listeners.get(type)?.({ preventDefault() { }, stopPropagation() { }, target: this, ...event }); },
        focus() { }, blur() { }, click() { }, select() { }, remove() { },
        setAttribute() { }, removeAttribute() { }, getAttribute: () => null,
        setSelectionRange() { },
        append(...kids) { for (const k of kids) { k.parent = el; el.children.push(k); } },
        appendChild(kid) { el.append(kid); return kid; },
        replaceChildren(...kids) { el.children = []; el.append(...kids); },
        removeChild(kid) { el.children = el.children.filter((c) => c !== kid); },
        /** Descendants matching a ".class" selector, in document order. */
        querySelectorAll(selector) {
            const want = classOf(selector);
            const out = [];
            const walk = (node) => {
                for (const kid of node.children) {
                    // A document fragment stands in for its own children.
                    if (want && kid.classList.contains(want)) out.push(kid);
                    walk(kid);
                }
            };
            walk(el);
            return out;
        },
        querySelector(selector) { return el.querySelectorAll(selector)[0] ?? null; },
        /** Nearest self-or-ancestor matching a ".class" selector. */
        closest(selector) {
            const want = classOf(selector);
            for (let node = el; node; node = node.parent) {
                if (want && node.classList.contains(want)) return node;
            }
            return null;
        },
    };
    el.parentElement = { classList: el.classList };
    return el;
}

export function installFakeDom() {
    const elements = new Map();
    const documentListeners = new Map();
    const element = (id) => {
        if (!elements.has(id)) elements.set(id, makeElement(id));
        return elements.get(id);
    };

    globalThis.document = {
        visibilityState: 'visible',
        documentElement: makeElement('html'),
        body: makeElement('body'),
        activeElement: null,
        getElementById: element,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: (tag) => makeElement(`<${tag}>`),
        createElementNS: (ns, tag) => makeElement(`<${tag}>`),
        createDocumentFragment: () => makeElement('#fragment'),
        addEventListener(type, callback) { documentListeners.set(type, callback); },
    };
    globalThis.window = {
        matchMedia: () => ({ matches: false, addEventListener() { } }),
        addEventListener() { },
        open() { },
    };

    // Clipboard: record what the panel writes, and let a test pause a write
    // so a lock can land while it is in flight.
    let clipboardText = '';
    const clipboardWrites = [];
    let pendingWrite = null;
    const clipboard = {
        async writeText(text) {
            clipboardWrites.push(text);
            if (pendingWrite) {
                const gate = pendingWrite;
                pendingWrite = null;
                gate.start();
                await gate.promise;
            }
            clipboardText = text;
        },
        async readText() { return clipboardText; },
    };
    if (globalThis.navigator) Object.defineProperty(globalThis.navigator, 'clipboard', { value: clipboard, configurable: true });
    else globalThis.navigator = { clipboard };

    return {
        /** The element with this id (created on first use, like popup.js sees it). */
        element,
        clipboard: {
            /** What the clipboard currently holds. */
            get text() { return clipboardText; },
            /** Every value written, in order — including the clears. */
            get writes() { return [...clipboardWrites]; },
            reset() { clipboardText = ''; clipboardWrites.length = 0; },
            /** Pause the next writeText until release(); `started` resolves once it is waiting. */
            holdNextWrite() {
                let start, release;
                const started = new Promise((r) => { start = r; });
                const promise = new Promise((r) => { release = r; });
                pendingWrite = { start, promise };
                return { started, release };
            },
        },
        /** Fire a document-level event such as DOMContentLoaded or visibilitychange. */
        fireDocument: (type) => documentListeners.get(type)?.({}),
        /** Hide or show the panel, as closing / reopening the side panel does. */
        setPanelHidden(hidden) {
            globalThis.document.visibilityState = hidden ? 'hidden' : 'visible';
            return documentListeners.get('visibilitychange')?.({});
        },
    };
}
