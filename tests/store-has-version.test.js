/**
 * The release workflow skips a store that already has the version being
 * released. These check that versions are read from the right fields of
 * each store's API response, and that odd responses mean "not there" (so
 * the workflow submits) rather than a crash.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromeVersions, firefoxVersions } from '../tools/store-has-version.mjs';

test('Chrome: versions come from both the published and the submitted revision', () => {
    const status = {
        publishedItemRevisionStatus: { state: 'PUBLISHED', distributionChannels: [{ deployPercentage: 100, crxVersion: '2.9' }] },
        submittedItemRevisionStatus: { state: 'PENDING_REVIEW', distributionChannels: [{ crxVersion: '2.9.1' }] },
    };
    assert.deepEqual(chromeVersions(status), ['2.9', '2.9.1']);
});

test('Chrome: no revisions or missing fields give no versions', () => {
    assert.deepEqual(chromeVersions({}), []);
    assert.deepEqual(chromeVersions(undefined), []);
    assert.deepEqual(chromeVersions({ publishedItemRevisionStatus: { state: 'PUBLISHED' } }), []);
});

test('Firefox: versions come from the listing results', () => {
    const listing = { results: [{ id: 2, version: '2.9.1' }, { id: 1, version: '2.9' }] };
    assert.deepEqual(firefoxVersions(listing), ['2.9.1', '2.9']);
});

test('Firefox: an empty or malformed listing gives no versions', () => {
    assert.deepEqual(firefoxVersions({ results: [] }), []);
    assert.deepEqual(firefoxVersions({}), []);
    assert.deepEqual(firefoxVersions(null), []);
});
