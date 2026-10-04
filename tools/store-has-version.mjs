#!/usr/bin/env node
//
// Does a store already have this version (published or awaiting review)?
//
//   tools/store-has-version.mjs chrome|firefox <version>
//
// Prints "yes", "no" or "unknown". Used by the release workflow so a re-run
// skips a store that already took this version instead of failing on it.
// "unknown" (any error) means the workflow submits as before and lets the
// store decide. Reads the same credentials as the publisher, from the
// environment. Node built-ins only: this runs next to the store keys.

import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const b64 = (s) => Buffer.from(s).toString('base64url');

/** Every version Chrome has published or has under review. */
export function chromeVersions(status) {
  const revisions = [status?.publishedItemRevisionStatus, status?.submittedItemRevisionStatus];
  return revisions.flatMap((r) => (r?.distributionChannels ?? []).map((c) => c.crxVersion)).filter(Boolean);
}

/** Every version number in an AMO versions listing. */
export function firefoxVersions(listing) {
  return (listing?.results ?? []).map((v) => v.version).filter(Boolean);
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function chrome(env) {
  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    iss: env.CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/chromewebstore',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 300,
  };
  const unsigned = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(JSON.stringify(claims))}`;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), env.CHROME_SERVICE_ACCOUNT_PRIVATE_KEY).toString('base64url');
  const { access_token } = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const name = `publishers/${env.CHROME_PUBLISHER_ID}/items/${env.CHROME_EXTENSION_ID}`;
  const status = await fetchJson(`https://chromewebstore.googleapis.com/v2/${name}:fetchStatus`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  return chromeVersions(status);
}

async function firefox(env) {
  const iat = Math.floor(Date.now() / 1000);
  const payload = { iss: env.FIREFOX_JWT_ISSUER, jti: crypto.randomUUID(), iat, exp: iat + 300 };
  const unsigned = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(JSON.stringify(payload))}`;
  const signature = crypto.createHmac('sha256', env.FIREFOX_JWT_SECRET).update(unsigned).digest('base64url');
  const base = `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(env.FIREFOX_EXTENSION_ID)}`;
  // Newest first, so a version just submitted is on the first page.
  const listing = await fetchJson(`${base}/versions/?filter=all_with_unlisted&page_size=50`, {
    headers: { Authorization: `JWT ${unsigned}.${signature}` },
  });
  return firefoxVersions(listing);
}

async function main([store, version]) {
  const lookup = { chrome, firefox }[store];
  if (!lookup || !version) {
    console.error('usage: tools/store-has-version.mjs chrome|firefox <version>');
    process.exit(2);
  }
  try {
    const versions = await lookup(process.env);
    console.log(versions.includes(version) ? 'yes' : 'no');
  } catch (err) {
    console.error(`Could not check ${store} for ${version}: ${err.message}`);
    console.log('unknown');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
