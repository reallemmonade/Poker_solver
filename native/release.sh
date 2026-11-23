#!/bin/bash
# Builds the Guava Poker iPhone/Mac app and uploads it to TestFlight.
# Run on the Mac with Xcode signed in to the Apple developer account:
#   TEAM_ID=XXXXXXXXXX native/release.sh
# The app loads https://guava.poker, so web changes never need a new upload; only native changes do.
set -euo pipefail
cd "$(dirname "$0")"
: "${TEAM_ID:?Set TEAM_ID to the Apple developer team ID}"
npm ci --no-audit --no-fund
npx cap sync ios
BUILD=$(date -u +%Y%m%d%H%M)
OUT=ios/App/output
rm -rf "$OUT" && mkdir -p "$OUT"
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/App.xcarchive" \
  DEVELOPMENT_TEAM="$TEAM_ID" CURRENT_PROJECT_VERSION="$BUILD" \
  -allowProvisioningUpdates archive
cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST
xcodebuild -exportArchive -archivePath "$OUT/App.xcarchive" -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -exportPath "$OUT/export" -allowProvisioningUpdates
echo "Uploaded build $BUILD to App Store Connect; it shows in TestFlight after processing (~5-15 min)."
