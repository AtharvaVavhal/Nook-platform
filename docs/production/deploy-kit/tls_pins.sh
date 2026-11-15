#!/bin/sh
# Prints the PUBLIC TLS facts a Nook deployment needs to pin the database certificate. Read-only. Run it INSIDE the
# PostgreSQL container (for example through the platform's remote shell), as any user that can run openssl:
#
#   sh tls_pins.sh [port]          (default port 5432; it connects to 127.0.0.1)
#
# It asks the running server for the certificate chain it actually presents (a PostgreSQL STARTTLS handshake), so the
# result is what clients will see. It never opens a private key and prints no secret. Output:
#   - DB_CERT_SHA256  SHA-256 fingerprint of the LEAF (server) certificate, the first one presented
#   - DB_CA_PEM       the CA certificate the clients must trust: the LAST certificate presented
#                     (with the Railway PostgreSQL template this is the self-signed `root-ca`, NOT the leaf; the leaf is
#                     issued by it and is refused as its own trust anchor)
#   - subject, issuer, validity and subject alternative names of both, and whether the leaf verifies against the CA
# If the server presents a single self-signed certificate, that certificate is both the leaf and the CA.
set -eu
PORT="${1:-5432}"
command -v openssl >/dev/null 2>&1 || { echo "STOP: openssl is not available in this container" >&2; exit 2; }

umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT INT TERM

echo | openssl s_client -starttls postgres -connect "127.0.0.1:${PORT}" -showcerts >"$work/handshake.txt" 2>/dev/null || true
if grep -q "PRIVATE KEY" "$work/handshake.txt"; then echo "STOP: unexpected key material in the handshake output" >&2; exit 3; fi

# split the presented certificates into c1.pem, c2.pem, ... in presentation order
awk -v dir="$work" '
  /-----BEGIN CERTIFICATE-----/ { n++; f = dir "/c" n ".pem" }
  n > 0 && f != "" { print > f }
  /-----END CERTIFICATE-----/ { close(f); f = "" }
' "$work/handshake.txt"

count="$(ls "$work"/c*.pem 2>/dev/null | wc -l | tr -d ' ')"
if [ "$count" -lt 1 ]; then
  echo "STOP: the server on port ${PORT} did not present a certificate (is TLS enabled, \`SHOW ssl\`?)" >&2
  exit 1
fi
leaf="$work/c1.pem"
ca="$work/c${count}.pem"
# any certificates between the leaf and the CA are intermediates: they are needed to verify the chain, not to pin it
: > "$work/intermediates.pem"
i=2
while [ "$i" -lt "$count" ]; do cat "$work/c${i}.pem" >> "$work/intermediates.pem"; i=$((i + 1)); done
untrusted=""
[ -s "$work/intermediates.pem" ] && untrusted="-untrusted $work/intermediates.pem"   # openssl rejects an empty -untrusted file

proto="$(grep -E "^New, TLSv|Protocol +:" "$work/handshake.txt" | head -2 | tr '\n' ' ')"
echo "chain: ${count} certificate(s) presented; ${proto:-negotiated protocol not reported}"
describe() {
  echo "  subject : $(openssl x509 -in "$1" -noout -subject | sed 's/^subject= *//')"
  echo "  issuer  : $(openssl x509 -in "$1" -noout -issuer | sed 's/^issuer= *//')"
  echo "  valid   : $(openssl x509 -in "$1" -noout -startdate | sed 's/^notBefore=//') -> $(openssl x509 -in "$1" -noout -enddate | sed 's/^notAfter=//')"
  san="$(openssl x509 -in "$1" -noout -ext subjectAltName 2>/dev/null | sed -n '2,$p' | sed 's/^ *//' | tr '\n' ' ')"
  echo "  SAN     : ${san:-none}"
  echo "  SHA-256 : $(openssl x509 -in "$1" -noout -fingerprint -sha256 | sed 's/^.*Fingerprint=//')"
}
echo
echo "LEAF (server) certificate: its fingerprint is DB_CERT_SHA256"
describe "$leaf"
echo
if [ "$count" -ge 2 ]; then
  echo "CA certificate (last presented): its PEM is DB_CA_PEM"
else
  echo "CA certificate: the server presents a single certificate, so the leaf is also the CA (self-signed): its PEM is DB_CA_PEM"
fi
describe "$ca"
echo
if openssl verify -CAfile "$ca" $untrusted "$leaf" >/dev/null 2>&1; then
  echo "check: the leaf verifies against the CA certificate (OK)"
else
  echo "check: the leaf does NOT verify against that CA certificate; do not use these values" >&2
  exit 4
fi
if [ "$count" -ge 2 ] && openssl verify -CAfile "$leaf" $untrusted "$leaf" >/dev/null 2>&1; then
  :
elif [ "$count" -ge 2 ]; then
  echo "note : the leaf cannot be its own trust anchor (it is not self-signed): DB_CA_PEM must be the CA above, not the leaf"
fi
echo
echo "DB_CERT_SHA256 (leaf fingerprint, hex without colons):"
openssl x509 -in "$leaf" -noout -fingerprint -sha256 | sed 's/^.*Fingerprint=//' | tr -d ':'
echo
echo "DB_CA_PEM (public CA certificate):"
cat "$ca"
echo
echo "Record the validity end date above. If the platform regenerates the certificates, both values change and must be refreshed."
