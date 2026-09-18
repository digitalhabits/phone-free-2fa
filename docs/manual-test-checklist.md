# Manual test checklist

`npm test` covers everything that can run without a browser. This list covers what can't: side-panel lifecycle, Touch ID, and the manifest. Run it before every release, in **Chrome** and **Firefox** (and Edge if the biometric code changed).

Load the unpacked extension from `src/` (`chrome://extensions` → Developer mode → Load unpacked; Firefox: `about:debugging` → This Firefox → Load Temporary Add-on → `src/manifest.json`).

## 1. Touch ID still works (do this first)

The lock rules around the Touch ID tab changed in 2.8. If the browser reports the panel as hidden while the Touch ID tab is in front, these would break.

- [ ] Lock the vault. Click **Unlock with Touch ID**, complete the prompt. → The tab closes and the panel shows your accounts.
- [ ] Settings → disable Touch ID, then enable it again. → "Touch ID re-enabled!" and the panel is still unlocked.
- [ ] With Touch ID never set up: unlock with the passphrase, accept the offer, complete setup. → "Touch ID enabled!" and the panel is still unlocked.

## 2. Closing the panel always locks

Set auto-lock to **Never** for this section, so only the hide rules are being tested.

- [ ] Unlock, close the side panel, reopen it. → Lock screen.
- [ ] Unlock. Start Touch ID setup so the tab opens. Close the **side panel**, then close the **Touch ID tab**. Reopen the panel. → Lock screen. *(2.7 stayed unlocked here.)*
- [ ] Unlock. Start Touch ID setup. Close the side panel and leave the tab open for about 3 minutes (the limit is 2; browsers slow timers in hidden pages). Reopen the panel. → Lock screen. The Touch ID tab has normally been closed for you.
- [ ] Lock. Click **Unlock with Touch ID**. While the prompt is showing, close the side panel, then complete Touch ID. Reopen the panel. → Lock screen.
- [ ] Unlock. Start Touch ID setup, cancel the prompt, close the tab **without** closing the panel. → Panel is still unlocked, toast says setup was cancelled.

## 3. "Not now" forgets the passphrase

- [ ] Unlock with the passphrase, click **Not now** on the Touch ID offer. Settings → Enable Touch ID. → It asks for your passphrase again.

## 4. Two windows

- [ ] Open the panel in two browser windows, unlock both. Start Touch ID setup from one. → Setup completes (2.7 could fail with "Could not retrieve the passphrase").

## 5. Manifest: permissions and CSP

- [ ] Install from a fresh profile. → The install prompt does **not** mention browsing history or tabs.
- [ ] Open the panel with DevTools open (right-click → Inspect). Use every screen: setup, lock, main, add/edit, settings, export, import, help. → No CSP errors in the console.
- [ ] In the panel's DevTools console run `fetch('https://example.com')`. → Refused by the Content Security Policy (`connect-src 'none'`).
- [ ] Touch ID tab opens, works, and closes (section 1) — this is what used the `tabs` API.

## 6. Backup round trip

- [ ] Import a text file containing `otpauth://totp/Test:me?secret=JBSWY3DPEHPK3PXPJBSWY3DP&issuer=Test&algorithm=SHA256&digits=8&period=60`. → An 8-digit code with a 60-second ring.
- [ ] Rename that account. → Still 8 digits, 60 seconds.
- [ ] Export an encrypted backup with the password `password1234`. → Refused. Export with a real password.
- [ ] Delete the account, import the backup. → Same 8-digit code as before, at the same moment, as another authenticator loaded with the same URI.
- [ ] Import a backup file made with 2.7. → Imports; accounts are 6 digits / 30 seconds.

## 7. Passphrase change

- [ ] Change the passphrase. Lock. → Old passphrase refused, new one works, all accounts present. Touch ID asks to be set up again.
