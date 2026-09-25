#!/bin/bash
# Create the long-lived self-signed code signing certificate for popMind.
#
# macOS keeps Accessibility / Screen Recording grants only while the app's
# signing identity stays the same. Run this ONCE, store the output as GitHub
# secrets and keep a backup: a new certificate means every user has to
# authorize popMind again.
#
#   MAC_SELF_SIGN_P12_BASE64   -> contents of popmind-signing.p12.base64
#   MAC_SELF_SIGN_P12_PASSWORD -> contents of popmind-signing.password
set -euo pipefail

OUT_DIR="${1:-./popmind-signing}"
CERT_NAME="popMind Self Signed"
mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

if [ -e popmind-signing.p12 ]; then
  echo "popmind-signing.p12 already exists in $OUT_DIR, refusing to overwrite" >&2
  exit 1
fi

cat > cert.cnf <<CNF
[req]
distinguished_name=dn
prompt=no
x509_extensions=ext
[dn]
CN=$CERT_NAME
[ext]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,codeSigning
CNF

PASSWORD="$(openssl rand -hex 16)"
openssl req -x509 -newkey rsa:2048 -nodes -days 36500 -config cert.cnf -keyout key.pem -out cert.pem
# -legacy keeps the p12 importable by macOS `security import`
openssl pkcs12 -export -legacy -inkey key.pem -in cert.pem -name "$CERT_NAME" \
  -out popmind-signing.p12 -passout "pass:$PASSWORD"
base64 -i popmind-signing.p12 | tr -d '\n' > popmind-signing.p12.base64
printf '%s' "$PASSWORD" > popmind-signing.password
chmod 600 popmind-signing.p12 popmind-signing.p12.base64 popmind-signing.password
rm -f key.pem cert.cnf

echo
echo "Certificate SHA-1: $(openssl x509 -in cert.pem -noout -fingerprint -sha1 | cut -d= -f2 | tr -d ':')"
echo "Created $OUT_DIR/popmind-signing.p12 (keep a private backup, never commit it)"
echo
echo "GitHub secrets:"
echo "  MAC_SELF_SIGN_P12_BASE64   = contents of $OUT_DIR/popmind-signing.p12.base64"
echo "  MAC_SELF_SIGN_P12_PASSWORD = contents of $OUT_DIR/popmind-signing.password"
