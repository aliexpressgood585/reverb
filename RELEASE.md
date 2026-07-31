# CAIRN — release

Everything needed to produce a signed AAB and fill in the Play Console, written
so it can be followed without reading anything else.

---

## 1. THE KEYSTORE — back this up before you do anything else

```
keystore/cairn-release.jks
keystore/keystore.properties      the passwords, generated, not chosen
```

**SHA-256 fingerprint of the signing certificate**

```
52:B7:0A:BC:FC:25:AA:72:02:18:56:C8:EC:3F:3A:9A:41:B8:57:D8:6B:AB:11:C2:B3:26:94:78:E6:B5:89:B4
```

RSA 4096, valid until **15 December 2053**, alias `cairn`.

### Why this is the most important paragraph in the repository

Google Play identifies an app by the certificate that signed it, permanently.
**If you lose this file you can never publish an update to CAIRN again.** Not
with a new key, not with a support ticket, not by proving you own the account.
The only remedy is a new listing, a new package name, and zero installs. If it
leaks, someone else can sign builds that Android will accept as yours.

`keystore/` is in `.gitignore` and is **not** in this repository. It exists only
in the working directory this was built in.

**Do this now:**

1. Copy the whole `keystore/` directory into a password manager as an
   attachment — 1Password, Bitwarden and Proton Pass all accept files.
2. Put a second copy somewhere that is not that password manager. An encrypted
   archive in your own cloud storage is fine. Two copies, two providers.
3. Verify you can read it back:
   ```bash
   keytool -list -v -keystore keystore/cairn-release.jks \
     -storepass "$(grep storePassword keystore/keystore.properties | cut -d= -f2)"
   ```
   The fingerprint it prints must match the one above.

If you later enable **Play App Signing** (recommended, and the default for new
apps), Google holds the *app* signing key and this becomes your *upload* key —
which is recoverable if lost. Until the first upload, it is neither, so treat it
as irreplaceable.

---

## 2. Building the AAB

**This could not be run in the environment that produced everything else** —
`dl.google.com` is blocked by that environment's egress proxy, which is where
both the Android SDK and the Android Gradle Plugin live. Verified concretely:
`./gradlew help` fails with `403 Forbidden` fetching
`com.android.tools.build:gradle:8.13.0`. See `BLOCKED.md` §1.

Everything else is done: the Capacitor project, the manifest, the icons at every
density, the splash, the signing config, and the R8 rules.

On a machine with Android Studio (or the command-line tools) installed:

```bash
npm install
npm run build:android          # vite → dist-android, then cap sync
cd android
./gradlew bundleRelease
```

The artefact:

```
android/app/build/outputs/bundle/release/app-release.aab
```

Confirm before uploading:

```bash
# it is signed, and by the right key
unzip -p app-release.aab META-INF/*.RSA | keytool -printcert | grep SHA256
```

For a device smoke test, an APK is easier to sideload than a bundle:

```bash
./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

**Test the release build, not just the debug one.** R8 is on
(`minifyEnabled true`), and the failure mode of a bad ProGuard rule in a
Capacitor app is a black screen that only ever appears in release. The rules in
`android/app/proguard-rules.pro` keep the bridge, and they are the reason it
works; they have not been verified against a real build here.

---

## 3. Data Safety form — the exact answers

Play rejects listings whose Data Safety declaration disagrees with what the app
does. These answers describe the build in this repository, in which
`cairn/src/analytics.js` writes to a 200-entry in-memory ring buffer and there is
no network code anywhere.

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **No** |
| Is all of the user data collected by your app encrypted in transit? | *n/a — nothing is transmitted* |
| Do you provide a way for users to request that their data is deleted? | **Yes** — Settings → Erase the tower, and uninstalling |
| Location | No |
| Personal info (name, email, user IDs) | No |
| Financial info | No |
| Health and fitness | No |
| Messages, photos, videos, audio, files | No |
| Contacts, calendar | No |
| App activity (interactions, search history, installed apps) | No |
| Web browsing history | No |
| App info and performance (crash logs, diagnostics) | No |
| Device or other identifiers (incl. Advertising ID) | No |

**Advertising ID declaration:** the app does **not** use it. Do not tick the
advertising-ID box, and do not add the `com.google.android.gms.permission.AD_ID`
permission — an app that declares the permission and does not use it is a
rejection.

> **THIS TABLE CHANGES THE DAY YOU ADD ADMOB.** A rewarded video means the ad SDK
> collects the Advertising ID and approximate location, and "Device or other
> identifiers" becomes **Yes, collected, for advertising**. Update this form in
> the same release that adds the SDK, not afterwards — a mismatch is an
> enforcement action, not a warning. `BLOCKED.md` §3 says the same thing next to
> the code.

---

## 4. Content rating questionnaire

Category: **Game**. Answer every question **No** — the game has no violence
(a stylised figure freezes; there is no blood, injury or depiction of harm), no
sexuality, no language, no controlled substances, no gambling, no user-generated
content, no user-to-user communication, and no data sharing.

Two that are easy to get wrong:

- **"Does the app share the user's location with other users?"** — No.
- **"Does the app allow users to interact or exchange content?"** — No. The share
  feature hands an image to the operating system's share sheet; the app has no
  connection to any other user.

Expected outcome: **Everyone / PEGI 3 / USK 0 / ESRB Everyone**.

---

## 5. Store listing checklist

Everything is generated and sitting in `/store`.

| Asset | Where | Status |
|---|---|---|
| App icon 512×512 | `store/icon-512.png` | ready |
| Icon legibility proof at 48 px | `store/icon-48-legibility-test.png` | ready |
| Feature graphic 1024×500 | `store/feature-1024x500.png` | ready |
| Phone screenshots ×8, 1080×1920 | `store/screenshots/` | ready, captioned |
| Title, short and full description (EN) | `store/listing-en.md` | ready |
| Title, short and full description (HE) | `store/listing-he.md` | ready |
| Privacy policy | **must be a live URL** | `https://reverb-wheat.vercel.app/privacy/` |
| Data Safety | §3 above | ready |
| Content rating | §4 above | ready |

**The privacy policy page ships with the games**, from `privacy/index.html`,
because Play will not accept a listing without a reachable one. Verify it loads
before you paste the URL into the console.

Two things the listing has that were **reasoned rather than researched**, because
`play.google.com` is blocked from the build environment: the keyword choices, and
the category. Both are argued in `store/listing-en.md` and both are worth ten
minutes against the real store before you publish.

---

## 6. The 12-tester rule, which is the long pole

A **personal** Play developer account created after November 2023 must run a
closed test with **at least 12 testers, opted in continuously for 14 days**,
before production access is granted. Details and how to recruit them are in
`BLOCKED.md` §2. Start it the day the AAB exists; nothing else in this document
takes two weeks.

---

## 7. Version numbering

`android/app/build.gradle`:

```gradle
versionCode 1        // integer, must increase with every upload, ever
versionName "1.0.0"  // the string a player sees
```

Play rejects a `versionCode` it has already seen, including from a build you
deleted. Bump it on every upload, even a re-upload of the same code.

---

## 8. Release checklist

```
[ ] keystore/ backed up in two places, fingerprint verified
[ ] npm run check                      typecheck, lint, unit tests
[ ] npm run accept                     14/14 acceptance
[ ] npm run bodies                     the premise still holds
[ ] npm run reach                      WALL 0.00%
[ ] node scripts/cairn-qa.mjs          1000 runs, no crash, no soft-lock
[ ] npm run build:android && cd android && ./gradlew bundleRelease
[ ] installed the RELEASE apk on a real phone and played it
[ ] versionCode bumped
[ ] privacy policy URL loads
[ ] Data Safety matches §3 for the build actually being uploaded
```
