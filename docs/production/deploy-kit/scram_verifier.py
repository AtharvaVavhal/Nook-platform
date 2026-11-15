#!/usr/bin/env python3
"""Print a PostgreSQL SCRAM-SHA-256 verifier for a password read from stdin (first line).

Used so a role password can be set with ALTER ROLE ... PASSWORD '<verifier>' without the plaintext password ever
appearing in a command, a server log or shell history. The verifier is not the password.
"""
import base64, hashlib, hmac, os, sys

password = sys.stdin.readline().rstrip("\n")
if len(password) < 24:
    sys.exit("password too short (minimum 24 characters)")
salt = os.urandom(16)
iterations = 4096
salted = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
stored_key = hashlib.sha256(client_key).digest()
server_key = hmac.new(salted, b"Server Key", hashlib.sha256).digest()
b64 = lambda b: base64.b64encode(b).decode()
print(f"SCRAM-SHA-256${iterations}:{b64(salt)}${b64(stored_key)}:{b64(server_key)}")
