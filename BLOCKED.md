# BLOCKED — things only you can do

Everything in this file stopped at a credential, a payment, or a host this
environment cannot reach. Nothing here is a code problem, and nothing here
blocked the rest of the run.

Ordered by what stands between you and a live listing.

---

## 1. The Android SDK cannot be installed here — so no AAB was built

**What happened.** `dl.google.com` is refused by this environment's egress proxy
(`curl` returns `000`, the proxy logs `connect_rejected`). That host is where
Google's command-line tools and every Android platform package live. Java 21,
`keytool` and Gradle are all present and working; the SDK is not, and cannot be
fetched.

Measured, so you can tell a policy block from a typo:

| host | result |
|---|---|
| `dl.google.com` | **refused** |
| `services.gradle.org` | 200 |
| `maven.google.com` | 301 |
| `repo1.maven.org` | 200 |
| `registry.npmjs.org` | 200 |

So: the Capacitor project, the manifest, the icon and splash sources, the
Gradle configuration and the signing block are all written and committed. The
one step not run is `gradlew bundleRelease`, which needs the SDK.

**What you do.** On any machine with Android Studio installed (or
`sdkmanager` from the command-line tools):

```bash
git clone <this repo> && cd reverb
npm install
npm run build
npx cap sync android
cd android
./gradlew bundleRelease
```

The AAB lands at `android/app/build/outputs/bundle/release/app-release.aab`.
`RELEASE.md` has the signing details and the exact keystore path.

**Time:** about 20 minutes, most of it Android Studio's first-run SDK download.

---

## 2. The Play Console account, and the 12-tester rule

**What you do, in order.**

1. Create a Google Play developer account at
   <https://play.google.com/console> — **US$25, one time, non-refundable**.
   Identity verification (a government ID, and for a personal account an address
   check) takes anywhere from a few hours to a few days. Start this first; it is
   the longest pole and nothing else needs it.
2. **A personal developer account created after November 2023 must run a closed
   test with at least 12 testers who stay opted in for 14 continuous days before
   Google will let you promote anything to production.** Not 12 installs — 12
   accounts opted into the closed track, continuously, for the full fortnight.
   The clock resets if you drop below 12.
3. Recruit the twelve. What actually works, in rough order of yield:
   - your own contacts, by asking each one directly for their Gmail address —
     that address is what goes on the tester list
   - r/androiddev's tester-exchange threads, and the various "closed testing
     exchange" Discord servers, where the deal is you join someone else's test
     and they join yours
   - a Google Group of tester emails, which is easier to edit than the
     comma-separated list in the console
   Tell them plainly it is fourteen days and they must not uninstall.
4. Fill the Data Safety form, the content rating questionnaire, and the privacy
   policy URL. Answers are prepared for you in `RELEASE.md` and `/store`.

**Time:** 14 days minimum, and it is a wall, not a queue. Start it the day the
AAB exists.

---

## 3. AdMob and any analytics need real account IDs

Monetisation is **built but inert**. `cairn/src/money.js` implements the whole
policy — rewarded video only, never an interstitial, never in the first three
sessions, never gating core play — behind an adapter with a null provider. It
runs, it logs, and it shows nothing, because there is no publisher ID to show.

**What you do.**

1. Create an AdMob account, add the app, and create **one rewarded ad unit**.
2. Put the IDs in `capacitor.config.ts` (`appId`) and in
   `cairn/src/money.js` (`AD_UNITS.rewarded`). Both are marked `TODO(you)`.
3. `npm i @capacitor-community/admob` and set `PROVIDER = 'admob'` in
   `money.js`.

Analytics is the same shape: `cairn/src/analytics.js` emits every event the
brief asks for, into a local ring buffer readable from the debug overlay. Point
it at a backend when you have one. **Nothing leaves the device today**, which is
also why the Data Safety answers in `RELEASE.md` say "no data collected" — if
you wire up a real analytics SDK, those answers change and you must update them.

---

## 4. The in-app purchase needs a Play Console product

The single IAP — remove ads and unlock all cosmetics — is implemented as a local
entitlement (`cairn/src/money.js`, `entitlement()`), so the unlock path is real
and testable today. Making it cost money needs a managed product created in the
Play Console with SKU `cairn.premium`, at your chosen price (≈US$2.99 / ₪12),
and `@capacitor-community/in-app-purchases` wired to it.

Until then the entitlement can only be granted locally, which is correct for a
closed test and wrong for production.

---

## 5. I could not verify the live deploy

`reverb-wheat.vercel.app` is refused by the same proxy (`403` on CONNECT), so the
standing rule in `CLAUDE.md` — compare the live bundle hash against the local
build after every push — could not be executed from here on any commit in this
run.

**What you do.** Open <https://reverb-wheat.vercel.app/cairn/>, view source, and
check that the `assets/cairn-*.js` filename matches the hash printed at the end
of `סיכום.md`. If it does not, the Vercel build failed silently — which has
happened twice on this project, both times from an unknown key in `vercel.json`.

---

## 6. Not blocked, but only you can answer it

**Nobody has played the retuned tower.** Three bot models with gaussian error are
not three people. The hard-gap mechanic added in this run demands a 5.0%-of-full
power window against an average hand's 5.5% error — on paper exactly the right
calibration, and on a real thumb an open question. Fifteen minutes on your phone
is worth more than another 30,000 headless climbs.
