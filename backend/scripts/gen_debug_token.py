#!/usr/bin/env python3
"""Generate a DEBUG_CAPTURE_TOKEN for the /debug/capture endpoint.

Usage:
    python backend/scripts/gen_debug_token.py            # 32-byte token
    python backend/scripts/gen_debug_token.py 48         # custom byte length

Set the printed value as the DEBUG_CAPTURE_TOKEN env var on Railway, and paste
the SAME value into the extension (Settings → Debug token). Leaving the env var
unset keeps the endpoint disabled (it 503s).
"""
import secrets
import sys


def main() -> None:
    nbytes = 32
    if len(sys.argv) > 1:
        try:
            nbytes = max(16, int(sys.argv[1]))
        except ValueError:
            print(f"ignoring invalid length {sys.argv[1]!r}, using {nbytes}")
    token = secrets.token_urlsafe(nbytes)
    print("\nDEBUG_CAPTURE_TOKEN generated:\n")
    print(f"  {token}\n")
    print("Railway → Variables (raw line):")
    print(f"  DEBUG_CAPTURE_TOKEN={token}\n")
    print("Local .env line:")
    print(f"  DEBUG_CAPTURE_TOKEN={token}\n")


if __name__ == "__main__":
    main()
