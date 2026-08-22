# Sideloading the Railroad Network Android app

There is no app store distribution (see the deployment constraints): pilot users
install a **signed release APK** directly. This doc has two halves — how a
maintainer builds and signs the APK, and how a pilot user installs it.

The release build targets **arm64-v8a only** (every Android phone from ~2017 on),
is **not** minified (ProGuard off), and is signed **locally** — the keystore and
its passwords live on the build machine, never in git or CI.

---

## For maintainers: build a signed release APK

### One-time setup

**1. Generate a release keystore.** Run this once and keep the output file safe
forever (see "Protect the keystore" below). Pick strong passwords when prompted;
they never get committed.

```sh
keytool -genkeypair -v \
  -keystore ~/.railroad/rrn-release.keystore \
  -alias rrn-release \
  -keyalg RSA -keysize 2048 -validity 10000
```

**2. Point Gradle at it, out of the repo.** Add these to
`~/.gradle/gradle.properties` (your user Gradle home — NOT any file in this
repo). `android/app/build.gradle` reads them; when they are absent the release
build falls back to the debug key and is not distributable.

```properties
RRN_UPLOAD_STORE_FILE=/Users/<you>/.railroad/rrn-release.keystore
RRN_UPLOAD_STORE_PASSWORD=<the store password you chose>
RRN_UPLOAD_KEY_ALIAS=rrn-release
RRN_UPLOAD_KEY_PASSWORD=<the key password you chose>
```

### Every release

```sh
# From the repo root. Build the Rust FFI for arm64 (jniLibs are gitignored),
# then assemble the signed release APK.
yarn ubrn:android
cd android && ./gradlew assembleRelease
```

The APK lands at:

```
android/app/build/outputs/apk/release/app-release.apk
```

The release build bundles the JS into the APK (no Metro at runtime), so this APK
runs standalone.

**Confirm it is really signed** with the release key (not the debug key):

```sh
$ANDROID_HOME/build-tools/<version>/apksigner verify --print-certs \
  android/app/build/outputs/apk/release/app-release.apk
```

The printed certificate should be your `rrn-release` key, not
`CN=Android Debug`.

### Bump the version for each new build

Sideload updates install over the existing app only if `versionCode` **strictly
increases**. In `android/app/build.gradle`, bump `versionCode` by 1 for every
release you hand out, and update `versionName` (the human label) on real changes.

### Protect the keystore

- **Back up `rrn-release.keystore` and its passwords** somewhere durable. If you
  lose them you cannot ship an update that installs over the installed app —
  users would have to uninstall (losing local wallet state) and reinstall.
- Never commit the keystore or the passwords. `.gitignore` already ignores
  `*.keystore` (except the shared `debug.keystore`).

---

## For pilot users: install the APK

You will receive one file: `app-release.apk`.

1. **Transfer it to your phone** — email, a USB cable, or a download link.
2. **Allow installing from this source.** Open the APK; Android will ask to
   allow "install unknown apps" for whichever app you opened it from (Files,
   Chrome, etc.). Enable it, then tap **Install**.
3. **Open the app** and follow the on-screen setup to join your community.

### If the app can't reach the station in the background

Some phones (notably Motorola) suspend a backgrounded app's network access until
you exempt it from battery optimization. If notifications or background sync stop
working:

- Settings → Apps → **Railroad Network** → Battery → allow **Unrestricted**
  (wording varies by phone).

### Updating

When you get a newer `app-release.apk`, just install it over the top — your
wallet and data are preserved. (Do **not** uninstall first; that erases local
state.)
