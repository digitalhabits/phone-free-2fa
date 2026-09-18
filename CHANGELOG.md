# Changelog

All notable changes to Phone-Free 2FA are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Releasing

1. Bump `version` in `src/manifest.json`.
2. Add a `## [x.y]` section above (with date and changes).
3. Commit and push to `main`.
4. Tag and push: `git tag vX.Y && git push origin vX.Y`

Pushing a `v*` tag triggers [`.github/workflows/release.yml`](.github/workflows/release.yml), which checks the tag matches `manifest.json`, builds `phone-free-2fa-redd-vX.Y.zip`, and publishes a GitHub Release with that zip attached.

## [2.8] - unreleased

Fixes from the September 2026 security reviews (`docs/security-review-2026-09-07.md`). Every fix has a test in `tests/` (`npm test`, no dependencies).

### Fixed

- **Encrypted backups lost account settings.** Backups stored only a label and secret, so accounts that don't use the default SHA-1 / 6 digits / 30 seconds generated wrong codes after a restore. Backups now keep every setting (format v3). Older backup files still import. If you have such an account, the app will ask you to make a new backup. (`src/backup.js`, `tests/backup.test.js`)
- **Editing an account reset its settings.** Renaming an account that doesn't use the defaults silently switched it back to SHA-1 / 6 digits / 30 seconds. (`src/accounts.js`, `tests/accounts.test.js`)
- **Changing the passphrase could lock the vault for good.** The new passphrase check and the re-encrypted accounts were saved in two steps; a crash between them left a vault that neither passphrase could open. Both are now saved in a single all-or-nothing write, after checking the re-encrypted vault opens. (`src/storage.js`, `tests/storage.test.js`)
- Touch ID setup could fail when the panel was open in two windows.
- Enabling Touch ID from Settings no longer strips spaces from the ends of the passphrase you type.

### Security

- **Removed the `tabs` permission.** It was never needed (opening and closing the Touch ID tab works without it), and it caused the "read your browsing history" install warning. The extension now asks for `storage` and `sidePanel` only.
- **Network access is now blocked by the browser, not just by us.** An explicit Content Security Policy sets `connect-src 'none'` and allows scripts only from the extension package. Guard tests fail if a network API, remote resource, or extra permission is ever added. (`src/manifest.json`, `tests/no-network.test.js`)
- **Closing the panel during Touch ID setup could leave the vault unlocked.** Locking is paused while the Touch ID tab is open, but nothing resumed it if the panel was closed in the meantime — with auto-lock set to "Never", the vault stayed open indefinitely. The vault now locks as soon as the Touch ID tab finishes or closes with the panel hidden, after 2 minutes hidden regardless, and a key is never installed into a panel that was closed while it was being derived. (`src/lock-policy.js`, `tests/lock-policy.test.js`)
- Clicking "Not now" on the Touch ID offer now clears the master passphrase from memory straight away, instead of keeping it until lock. Enabling Touch ID from Settings asks for it again.
- Backup passwords now have to pass the same strength rules as the master passphrase (they only had a 12-character minimum). A backup file can be copied and attacked offline, so its password matters at least as much. Setup, change-passphrase and export share one rule set. (`validateNewPassphrase` in `src/passphrase-strength.js`, `tests/passphrase-policy.test.js`)
- The "backup out of date" fingerprint kept outside the encrypted vault is now salted, and covers all account settings. (`src/storage.js`)

## [2.7] - 2026-07-25

### Changed

- New app logo: phone with strike-through, background-free at all icon sizes (design sources in `assets/logo/`).

## [2.6] - 2026-07-24

### Added

- Copy button for the secret key in the edit modal — copies without revealing the masked value, with the same 30-second clipboard auto-clear as codes.

### Changed

- Shortened the product name from **Phone-Free 2FA by ReDD** to **Phone-Free 2FA** across the manifest, UI, docs, and store copy.

## [2.5] - 2026-07-20

### Changed

- Updated in-app attribution, store copy, and privacy contact to Centre for Digital Habits ([digitalhabits.org](https://digitalhabits.org)).

### Security

- Lock and wipe decrypted vault state when the side panel is hidden/closed (Chrome often keeps the panel document alive after close).
- Fail closed on biometric passphrase handoff: only accept messages from the tracked biometric tab.

## [2.4] - 2026-07-04

### Changed

- Redesigned EULA and passphrase setup screens for clearer onboarding.
- Refined main and lock screens and reorganized in-app guidance.
- Aligned settings panel with the main app layout.
- Polished account cards, copy feedback, and lock screen actions.
- Improved passphrase visibility toggle and footer behavior.

### Fixed

- Touch ID can now be re-enabled from Settings after dismissing the post-unlock setup prompt with "Don't ask again".

## [2.3] - 2026-06-25

### Changed

- Updated extension icons.

## [2.2] - 2026-06-10

### Changed

- Rebranded from **ReDD 2FA** to **Phone-Free 2FA by ReDD** for store listings and external docs.
- In-app UI now uses the shorter name **Phone-Free 2FA**; attribution remains in the footer and onboarding copy.
- Updated GitHub repository links to [redd-phone-free-2fa](https://github.com/ulyngs/redd-phone-free-2fa).

## [2.1] - 2026-05-18

### Added

- README install instructions now distinguish Chrome/Edge/Chromium browsers from Firefox.

### Fixed

- Restored Touch ID / biometric unlock via a dedicated tab (Chrome does not show WebAuthn prompts from side panels).
- Touch ID setup: prevent double-click races, show progress, and surface clearer retry-friendly errors.
- Handle concurrent WebAuthn ceremonies (`OperationError`) explicitly.
- Reuse disabled biometric credentials during tab setup instead of creating duplicates.
- Close in-flight biometric tabs on lock and clear their state.
- Clear setup passphrase from the DOM after successful first-time setup.
- Apply `noopener`/`noreferrer` when opening external links.

### Changed

- Toast duration now scales with message length.
- EULA and lock/setup screens harmonised with the unlocked UI.

### Security

- Persist brute-force lockout state across panel restarts.
- Wipe decrypted account state from popup memory on lock.
- Wire up clipboard auto-clear on panel close.
- Tightened security documentation around lockout scope, auto-lock semantics, and memory wiping.

## [2.0] - 2026-04-17

### Added

- Hand-rolled, auditable passphrase strength checks (common passwords, keyboard walks, repeating patterns, low character diversity).

### Changed

- Minimum master passphrase length increased to 12 characters.

### Fixed

- EULA acceptance flow works correctly in Microsoft Edge.

## [1.9.1] - 2026-04-16

### Fixed

- EULA acceptance on first launch in Edge.

## [1.9] - 2026-04-12

### Added

- EULA acceptance prompt on first launch.
- Tabbed in-app instructions (How to use / How it works).
- Clearer backup export dialog and backup-status prompts.
- Provenance notes on onboarding and unlock screens.

### Changed

- Extension UI moved from popup to browser side panel for a better day-to-day experience.
- Settings overlay is now full width.
- Export and instruction wording clarified.

## [1.0.0] - 2026-02-09

### Added

- Local-only TOTP authenticator browser extension (Chrome, Firefox, Edge).
- AES-256-GCM encryption with PBKDF2 key derivation (600,000 iterations).
- Master passphrase unlock with progressive lockout on failed attempts.
- Optional Touch ID / Windows Hello unlock via WebAuthn PRF.
- Account search, copy-on-click codes, and visual TOTP countdown rings.
- Encrypted backup/restore and plain `otpauth://` URI export for migration.
- Dark/light theme with system auto-detection.
- Configurable auto-lock timeout and clipboard auto-clear after 30 seconds.
- Zero-dependency implementation using Web Crypto API only.

[2.6]: https://github.com/ulyngs/phone-free-2fa/releases/tag/v2.6
[2.5]: https://github.com/ulyngs/phone-free-2fa/releases/tag/v2.5
[2.4]: https://github.com/ulyngs/phone-free-2fa/releases/tag/v2.4
[2.3]: https://github.com/ulyngs/phone-free-2fa/releases/tag/v2.3
[2.2]: https://github.com/ulyngs/phone-free-2fa/releases/tag/v2.2
