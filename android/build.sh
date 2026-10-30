#!/usr/bin/env bash
# Compile, aligne et signe l'APK AssibaService sans Gradle.
# Prérequis : JDK 17, Android SDK avec platforms;android-34 et build-tools;34.0.0.
# Usage : ANDROID_HOME=... KEYSTORE=... KEYSTORE_PASS_FILE=... ./build.sh 1.0.0 1
set -euo pipefail
VERSION_NAME="${1:-1.0.0}"
VERSION_CODE="${2:-1}"
SDK="${ANDROID_HOME:?ANDROID_HOME manquant}"
BT="$SDK/build-tools/34.0.0"
JAR="$SDK/platforms/android-34/android.jar"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/build"
rm -rf "$OUT" && mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex"

sed -i "s/VERSION = \"[^\"]*\"/VERSION = \"$VERSION_NAME\"/" "$HERE/src/com/assibaservice/app/BuildInfo.java"

"$BT/aapt2" compile --dir "$HERE/res" -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/unsigned.apk" -I "$JAR" \
  --manifest "$HERE/AndroidManifest.xml" -A "$HERE/assets" --java "$OUT/gen" \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" "$OUT/res.zip"

javac --release 11 -classpath "$JAR" -d "$OUT/classes" -Xlint:-options \
  $(find "$HERE/src" "$OUT/gen" -name '*.java') 2>&1 | grep -v "deprecat" || true
test -f "$OUT/classes/com/assibaservice/app/MainActivity.class"

"$BT/d8" --release --min-api 24 --lib "$JAR" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')
(cd "$OUT/dex" && zip -q -u "$OUT/unsigned.apk" classes.dex)

"$BT/zipalign" -p -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
"$BT/zipalign" -c -p 4 "$OUT/aligned.apk"

# Sans clé : on s'arrête à l'APK aligné, signé ensuite hors de la CI
if [ -z "${KEYSTORE:-}" ]; then
  cp "$OUT/aligned.apk" "$OUT/AssibaService-$VERSION_NAME-unsigned.apk"
  echo "APK non signé : $OUT/AssibaService-$VERSION_NAME-unsigned.apk"
  exit 0
fi
"$BT/apksigner" sign --ks "${KEYSTORE:?KEYSTORE manquant}" --ks-key-alias assibaservice \
  --ks-pass "file:${KEYSTORE_PASS_FILE:?}" --key-pass "file:${KEYSTORE_PASS_FILE}" \
  --out "$OUT/AssibaService-$VERSION_NAME.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify --verbose "$OUT/AssibaService-$VERSION_NAME.apk" | head -6
echo "APK : $OUT/AssibaService-$VERSION_NAME.apk"
