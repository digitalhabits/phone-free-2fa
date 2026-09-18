# Security review — Phone-Free 2FA v2.7

**Date:** 2026-09-07
**Scope:** Full source in `src/` (manifest, crypto, TOTP, storage, session, biometric flow, popup UI) plus the GitHub release workflow.
**Method:** Manual code review. No dynamic testing.

## Summary

The core design holds up. Vault encryption is textbook and correctly applied, nothing touches the network, and every DOM sink that takes user data uses `textContent`. No path was found by which a web page, another extension, or a malformed backup file could extract secrets.

Two medium-severity issues were found (one data-loss risk, one release-pipeline supply-chain risk), plus a set of low and informational hardening items.

## Status (updated 2026-09-18, for v2.8)

A second, LLM-assisted review by an external reader (5 September 2026) overlapped with this one and added finding A below. Every fix has an automated test (`npm test`) unless marked *manual*, which means it needs a real browser — see `docs/manual-test-checklist.md`.

| # | Finding | Status | Fix | Test |
|---|---|---|---|---|
| A | Encrypted backup drops algorithm / digits / period (external review, High) | Fixed | `src/backup.js` (format v3) | `tests/backup.test.js` |
| A2 | Editing an account reset algorithm / digits / period (found while fixing A; independently by Konrad Kollnig, PR #8) | Fixed | `accountFromForm` in `src/accounts.js` | `tests/accounts.test.js` |
| 1 | Change-passphrase can lock the vault | Fixed | `writeVault` in `src/storage.js` — one atomic write | `tests/storage.test.js` (failure injection) |
| 2 | Release pipeline supply chain | Fixed in repo; **needs the `store-release` environment configured on GitHub** | `.github/workflows/release.yml`, `tools/` | `tests/release-pipeline.test.js` |
| 3 | `tabs` permission unnecessary | Fixed | `src/manifest.json` | `tests/no-network.test.js` + *manual* §5 |
| 4 | Passphrase retained after "Not now" | Fixed | `biometric-skip-btn` handler in `src/popup.js` | *manual* §3 |
| 5 | No explicit CSP | Fixed | `src/manifest.json` | `tests/no-network.test.js` + *manual* §5 |
| 6 | Backup passwords skip the strength check | Fixed | `validateNewPassphrase` in `src/passphrase-strength.js` | `tests/passphrase-policy.test.js` |
| 7 | README overstates the biometric guarantee | Fixed | `README.md` | — |
| 8a | Unsalted backup fingerprint | Fixed | `src/storage.js` | `tests/storage.test.js` |
| 8b | Import validation | Fixed | `cleanImportedAccount` in `src/accounts.js` | `tests/accounts.test.js`, `tests/backup.test.js` |
| 8c | Two-window race | Fixed | `initBiometricMessaging` in `src/popup.js` | *manual* §4 |
| K1 | Two windows: a save from a window holding an old key or an older copy destroys the vault or loses changes (Konrad Kollnig, PR #7) | Fixed | stale-vault check + Web Locks in `src/storage.js` | `tests/two-windows.test.js`, `tests/popup-races.test.js` + *manual* §4 |
| K2 | Lock during passphrase change saves an empty vault; async work outliving a lock (Konrad Kollnig, PR #7) | Fixed | lock epoch in `src/session.js`, checks in `src/popup.js` | `tests/popup-races.test.js`, `tests/session.test.js` |
| K3 | Auto-lock timer ignores setting changes (Konrad Kollnig, PR #9) | Fixed | `setAutoLockMinutes` in `src/session.js` | `tests/session.test.js` + *manual* §4b |
| 8d | Unicode normalisation of passphrases | **Open** — needs a migration that cannot lock out existing users; planned as its own release | | |
| 8e | Abandoned Touch ID tab keeps the vault unlocked (also external review #5) | Fixed | `src/lock-policy.js` | `tests/lock-policy.test.js` + *manual* §2 |
| 8f | Redundant verifier | **Won't fix for now** — a format migration for no security gain | | |

## What is solid

- **Vault encryption.** PBKDF2-HMAC-SHA256 at 600k iterations into a non-extractable AES-256-GCM key, fresh 32-byte salt, fresh 96-bit IV per write. The verifier uses a different salt so it is independent of the encryption key (`src/crypto.js`).
- **TOTP engine.** RFC 6238 dynamic truncation is correct, including 8-byte counter construction and the sign-bit mask (`src/totp.js`).
- **Attack surface.** No content scripts, no `web_accessible_resources`, no `externally_connectable`, no remote code. The background script only opens the panel. Web pages cannot reach any extension page.
- **Biometric messaging.** The passphrase handoff only honours messages from the tab the panel itself opened, and fails closed (`isTrustedBiometricSender` in `src/popup.js`).
- **Memory hygiene.** Lock on hide, wipe of every input and modal, clipboard flush, and the pending biometric tab is closed on lock (`wipeSensitiveState` in `src/popup.js`).
- **No secrets in logs.** All `console.*` calls log WebAuthn errors only.

## Findings

### 1. Medium — change-passphrase can permanently lock the vault

`changePassphrase` in `src/storage.js` writes the new salt and verifier in one `storage.local.set` call and then re-encrypts the accounts in a second call. A crash, browser kill, or storage error between those two writes leaves meta expecting the new passphrase while the data blob still needs the old key. Neither passphrase can then open the vault.

**Fix:** encrypt first, then write meta and data in a single `storage.local.set({ meta, data })`. The same pattern exists in `setupPassphrase`, where the vault is empty so the impact is nil.

### 2. Medium — release pipeline is the highest-impact supply-chain vector

The release job in `.github/workflows/release.yml` holds the Chrome Web Store service-account key and the Firefox JWT secret, and can push a build to every user. It runs `actions/checkout@v4` and `softprops/action-gh-release@v2` by mutable tag, and `npx publish-browser-extension@5.1.0` resolves that package's transitive dependencies fresh on every run with no lockfile.

**Fix:**
- Pin both actions to full commit SHAs.
- Vendor a `package-lock.json` for the publisher tool and run it with `npm ci --ignore-scripts` instead of `npx`.
- Put the store-submission step behind a GitHub environment with required reviewers so a tag push alone cannot publish.

### 3. Low — `tabs` permission is unnecessary

Every tabs call used (`create`, `update`, `remove`, `getCurrent`, `onRemoved`) works without the `tabs` permission. The sender check reads only `sender.tab.id` and `sender.url`, neither of which needs it. Dropping it from `src/manifest.json` removes the "read your browsing history" install warning on Chrome and shrinks what a compromised build could do. README and store copy would need updating.

### 4. Low — master passphrase retained in memory after "Not now"

When the post-unlock Touch ID prompt is dismissed, `pendingPassphrase` is kept for the whole session so Settings can enable Touch ID without re-prompting (`biometric-skip-btn` handler in `src/popup.js`). Ignoring the prompt clears it after 60 s, but dismissing it keeps it until lock. The settings flow already has a passphrase field for this case, so clearing on dismiss costs one extra prompt.

### 5. Low — no explicit CSP

The MV3 default already blocks remote and inline scripts. Declaring an explicit policy makes the "never makes network requests" claim browser-enforced and reviewer-verifiable:

```json
"content_security_policy": {
  "extension_pages": "default-src 'self'; script-src 'self'; object-src 'none'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'"
}
```

### 6. Low — backup passwords skip the strength check

Export requires 12 characters but never calls `checkPassphraseStrength` (`handleExport` in `src/popup.js`). Backups are the artifact most likely to leave the machine, so they deserve at least the master passphrase rules.

### 7. Low — README overstates the biometric guarantee

"Directly from the security chip, no keys ever stored on disk" is true for Chrome's profile authenticator on macOS. When the passkey provider is Google Password Manager, iCloud Keychain, or 1Password, the PRF secret syncs across devices under that provider's end-to-end encryption, and the README itself steers Windows users to GPM. The honest statement is "as strong as your passkey provider".

### 8. Informational

- **Backup fingerprint.** `computeAccountsFingerprint` in `src/storage.js` stores an unsalted SHA-256 over every label and secret in plaintext storage. Secrets are too long to guess, so this is hygiene rather than exposure. Mixing the vault salt into the hash input fixes it in one line.
- **Import validation.** `handleImport` accepts any JSON array as accounts without validating fields. A malformed file can wedge search and the fingerprint with a TypeError after it has already been saved. No injection is possible since rendering uses `textContent`.
- **Two-window race.** With the panel open in two windows, the non-owner panel answers the passphrase request with `unauthorized` first and setup fails. Not calling `sendResponse` in the rejection branch of `initBiometricMessaging` lets the owner's reply through.
- **Unicode normalisation.** Passphrases are not NFKC-normalised before key derivation, so a passphrase with accented characters typed on a different OS can fail to unlock.
- **Abandoned Touch ID tab.** If the user abandons a setup tab and hides the panel, the panel stays unlocked until the auto-lock timer fires, or forever on "Never".
- **Redundant verifier.** A wrong passphrase already fails AES-GCM authentication in `loadAccounts`. Dropping the stored verifier would halve unlock latency, at the cost of a format migration.
