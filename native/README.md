# Guava Poker app (iPhone and Mac)

A Capacitor shell that opens https://guava.poker full screen. Every web deploy shows up in the app on its next launch; only changes in this folder need a new build.

- iPhone: TestFlight, then the App Store when wanted.
- Mac: the same build runs on Apple silicon Macs (iPhone/iPad app on Mac), installed from TestFlight for Mac.

Release from the Mac (Xcode signed in to the developer account): `TEAM_ID=<team id> native/release.sh`. It syncs Capacitor, archives with automatic signing and uploads to App Store Connect with a timestamp build number.

Icons and the launch screen come from `node studio/make-icons.cjs`.
