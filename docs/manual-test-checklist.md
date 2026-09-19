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

**Precondition: Touch ID must never have been set up in this profile.** Disabling Touch ID is not enough. `disableBiometric()` only sets a `disabled` flag and keeps the wrapped passphrase in storage, so Settings → Enable Touch ID re-enables from the stored credential without ever asking — that is section 1's second item, not this one. Only a passphrase change clears the data. So either run section 7 first and come back here, or wipe it by hand in the panel's DevTools console:

```js
chrome.storage.local.remove('redd2fa_biometric')
```

- [ ] Unlock with the passphrase, click **Not now** on the Touch ID offer. Settings → Enable Touch ID. → It asks for your passphrase again.

## 4. Two windows

- [ ] Open the panel in two browser windows, unlock both. Start Touch ID setup from one. → Setup completes (2.7 could fail with "Could not retrieve the passphrase").
- [ ] Unlock in both windows. Add an account in window 1. Then add a different account in window 2. → Window 2 locks with "Vault changed in another window. Please unlock again." After unlocking, window 2 shows window 1's account, and adding now works.
- [ ] Unlock in both windows. Change the passphrase in window 1. Delete an account in window 2. → Window 2 locks with the same message; nothing was deleted; only the new passphrase unlocks.

## 4b. Auto-lock setting

- [ ] Set auto-lock to **Never**, close and reopen the panel, unlock, wait 30 seconds. → Still unlocked (2.7 locked after 10 seconds).
- [ ] While unlocked, switch from **Never** to **1 minute** and leave the panel alone. → Locks after about a minute (2.7 never locked).

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

Changing the passphrase clears the stored biometric data, so this section leaves the profile in the state section 3 needs. If you could not run section 3 earlier, run it now.

- [ ] Change the passphrase. Lock. → Old passphrase refused, new one works, all accounts present. Touch ID asks to be set up again.

## 8. Restore from backup (lock screen)

This is the only path that destroys a vault, and it is reachable without the master passphrase by design. Test it on a profile you can afford to lose, and export a backup first.

- [ ] Lock. → The lock screen shows **Forgotten your passphrase? Restore from a backup** under the Unlock button.
- [ ] Open it with no backup to hand. → The modal explains that without a backup file nothing can be recovered, and says how to start over. Check it reads sensibly in both light and dark mode — it has a rule above it.
- [ ] Open it, pick a backup, enter the **wrong** backup password. → Refused; the old vault is untouched and the old passphrase still unlocks.
- [ ] Get the backup password wrong five times. → The same progressive lockout as the passphrase (5s, then 30s after 10, 5min after 15). Failed unlocks and failed restores share one counter.
- [ ] Try to restore with a weak new master passphrase, or with the two new-passphrase fields differing, or with the confirmation checkbox unticked. → Each refused, nothing written.
- [ ] Restore properly: correct backup password, strong new passphrase, checkbox ticked. → The panel unlocks straight into the accounts from the backup, the codes match another authenticator, and the toast says to set up Touch ID again.
- [ ] Lock. → Only the new passphrase works; the old one is refused. Touch ID is gone and asks to be set up from scratch (not "re-enabled" — see section 3).
- [ ] Start a restore, type a backup password and a new passphrase, then close the side panel without finishing. Reopen. → Lock screen, restore modal closed, every field empty.
