# Digital Habits: Phone-Free 2FA

Use two-factor authentication without reaching for your phone. Phone-Free 2FA is a free, open-source authenticator that lives in your browser sidebar and generates the login codes used by services such as Microsoft 365.

Your accounts stay encrypted on your computer. The extension has no server, sends nothing over the network, and does not require an account.

Developed by the [Centre for Digital Habits](https://digitalhabits.org), with computer scientists at the University of Oxford (Dr Ulrik Lyngs) and Maastricht University (Dr Konrad Kollnig and Henry Tari).

## Install

- **Chrome, Edge, Brave and other Chromium browsers:** [Install from the Chrome Web Store](https://chromewebstore.google.com/detail/redd-2fa-phone-free-authe/dhkhbjppnoabmglidgfpndfghbhlkgbn)
- **Firefox:** [Install from Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/redd-2fa-simple-authenticator)
- **Safari:** recent versions of macOS already support verification codes in the Passwords app. On older Macs, see Safari > Settings > Passwords.

## Why use Phone-Free 2FA?

- **Stay focused:** get login codes from the browser sidebar without finding or unlocking your phone.
- **Keep data local:** account details never leave the browser and are encrypted with your master passphrase.
- **Work with existing services:** use any account that offers standard authenticator-app codes (TOTP).
- **Keep control:** export an encrypted backup or move your accounts to another authenticator at any time.
- **Use a transparent tool:** the project is open source and has no adverts, analytics or online account.

## Getting started

1. Install the extension and select its toolbar icon to open the sidebar.
2. Create a strong master passphrase. There is no central recovery, so store it safely.
3. When a service asks you to set up an authenticator app, add the secret key it provides to Phone-Free 2FA.
4. Select an account in the sidebar to copy its current login code.
5. Export an encrypted backup, and make a new backup whenever your accounts change.

You can optionally enable Touch ID in Chrome or Edge on supported devices. Firefox users unlock with their master passphrase. On Windows, biometric unlock requires a passkey provider that supports the necessary browser feature, such as Google Password Manager or 1Password; Windows Hello alone does not currently support it.

## Screenshots

<p align="center">
  <img src="./docs/screenshots/R2FA-git-1.png" alt="Unlocking Phone-Free 2FA with Touch ID or a master passphrase" width="49%" />
  <img src="./docs/screenshots/R2FA-git-3.png" alt="Adding an account to Phone-Free 2FA" width="49%" />
</p>
<p align="center">
  <img src="./docs/screenshots/R2FA-git-4.png" alt="A current login code and setup instructions in the Phone-Free 2FA sidebar" width="49%" />
  <img src="./docs/screenshots/R2FA-git-5.png" alt="Phone-Free 2FA security and backup settings" width="49%" />
</p>

## What you can do

- Keep multiple accounts together and find them with search.
- Copy a code by selecting its account, with a countdown showing when it will change.
- Choose a light, dark or system-matched theme.
- Set an automatic lock time and change your master passphrase.
- Export and restore encrypted backups.
- View secret keys or export standard records when moving to another authenticator.

## For organisations and IT departments

Phone-Free 2FA can help staff who need TOTP codes during computer-based work but should not have to keep a personal or work phone beside them. It can be installed from the public browser stores or deployed through your organisation's standard browser extension policy.

### What IT teams should know

- **No service to operate:** there is no backend, tenant, subscription or administrator account.
- **No data transfer:** the extension requests no access to websites and its security policy blocks network connections.
- **Small permission set:** it uses browser storage and the browser sidebar only.
- **Local responsibility:** each browser profile has its own encrypted vault. There is no central recovery, remote reset, cross-device sync or administrative view of users' accounts.
- **User-managed continuity:** staff should keep their master passphrase safe and maintain an up-to-date encrypted backup under your organisation's approved storage policy.
- **Easy exit:** users can export standard `otpauth://` records for migration to another authenticator.

For managed deployment, the Chrome extension ID is `dhkhbjppnoabmglidgfpndfghbhlkgbn` and the Firefox extension ID is `redd-2fa@reddfocus.org`.

Before organisation-wide deployment, confirm that your identity providers support TOTP and decide how staff should store passphrases and encrypted backups. Because the product deliberately has no central administration, it may not suit organisations that require managed credential recovery, central audit logs or remote revocation.

## Security and privacy at a glance

- Account details are encrypted at rest with a key derived from the user's master passphrase.
- The vault locks when the sidebar closes and can also lock after a configurable period of inactivity.
- Failed unlock attempts trigger progressively longer delays.
- Copied codes are cleared from the clipboard after 30 seconds.
- The extension contains no remote code, analytics or runtime dependencies.
- Backups remain encrypted; plain-text export is available only when a user deliberately chooses it for migration.

No local authenticator can protect accounts if its computer and master passphrase are both compromised. A strong, unique passphrase and a current backup remain important.

## Frequently asked questions

### Is Phone-Free 2FA safe to use?

It is designed to keep TOTP accounts safe on a trusted computer. Account details are encrypted with your master passphrase, the extension makes no network connections, and it cannot read the websites you visit. Its source code and security design are public.

No authenticator can remove every risk. Someone who controls both your computer and your master passphrase could access your codes, and a weak passphrase makes an offline attack on copied encrypted data easier. Keep your computer updated and locked, use a strong passphrase that you do not reuse elsewhere, and maintain an encrypted backup. Technical reviewers can inspect the [security model and implementation](docs/technical-reference.md).

### What happens if I forget my master passphrase?

Phone-Free 2FA cannot reveal or reset it: the project has no server, user account or recovery key.

- **If you have an encrypted Phone-Free 2FA backup and know its backup password:** select **Forgotten your passphrase?** on the unlock screen. You can restore the backup and choose a new master passphrase. This replaces the inaccessible vault currently stored in that browser profile.
- **If you do not have a usable backup:** the stored accounts cannot be recovered. Remove and reinstall the extension, then use each service's account-recovery process to re-enrol 2FA. Any recovery codes supplied by those services may help.

Export an encrypted backup after setup and whenever your accounts change. Store its password separately and safely.

### Is my master passphrase or account data sent anywhere?

No. The master passphrase is not stored, and account data remains encrypted in the browser's local extension storage. The extension has no host permissions, analytics or network access.

### What happens if my computer is lost, replaced or damaged?

Install Phone-Free 2FA on the replacement computer and import your encrypted backup using its backup password. Without a usable backup, you must recover and re-enrol 2FA separately with each service.

### Does it synchronise between computers or browsers?

No. Each browser profile has its own local vault. Move accounts using an encrypted backup, or use the migration export if you are deliberately transferring them to another authenticator.

### Which accounts work with Phone-Free 2FA?

It works with services that provide standard time-based authenticator codes, also called TOTP. During setup, choose the service's option for an authenticator app and enter the secret key it provides. It does not receive push-approval requests from products such as Microsoft Authenticator.

### Does it replace my password or passkey?

No. It supplies the changing verification code used as a second factor. Your account password, passkey and the service's own recovery methods remain separate.

## Technical information

Security reviewers, developers and administrators who want implementation details can read the [technical reference](docs/technical-reference.md). It covers the security model, architecture, source layout, local development, tests and reproducible release verification.

See the [changelog](CHANGELOG.md) for release history and the [manual test checklist](docs/manual-test-checklist.md) for browser-level verification.

## Contributing

Issues and contributions are welcome through this repository. Please do not include real 2FA secrets, backup files or master passphrases in bug reports.
