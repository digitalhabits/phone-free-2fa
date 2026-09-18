/**
 * The least DOM that lets src/popup.js load and run under Node, so its
 * handlers can be driven from tests. Every element exists on demand, records
 * what is assigned to it, and remembers its event listeners.
 * (Technique from Konrad Kollnig's PR #7.)
 *
 * Call installFakeDom() BEFORE importing popup.js.
 */

function makeElement(id) {
    const listeners = new Map();
    const classList = { add() { }, remove() { }, toggle() { }, contains: () => false };
    return {
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
        classList,
        parentElement: { classList },
        addEventListener(type, callback) { listeners.set(type, callback); },
        /** Run the listener registered for `type`, as the browser would. */
        fire(type, event = {}) { return listeners.get(type)?.({ preventDefault() { }, target: this, ...event }); },
        focus() { }, blur() { }, click() { }, select() { }, remove() { },
        setAttribute() { }, removeAttribute() { }, getAttribute: () => null,
        setSelectionRange() { },
        replaceChildren() { }, append() { }, appendChild() { }, removeChild() { },
        querySelector: () => null,
        querySelectorAll: () => [],
        closest: () => null,
    };
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

    return {
        /** The element with this id (created on first use, like popup.js sees it). */
        element,
        /** Fire a document-level event such as DOMContentLoaded or visibilitychange. */
        fireDocument: (type) => documentListeners.get(type)?.({}),
        /** Hide or show the panel, as closing / reopening the side panel does. */
        setPanelHidden(hidden) {
            globalThis.document.visibilityState = hidden ? 'hidden' : 'visible';
            return documentListeners.get('visibilitychange')?.({});
        },
    };
}
