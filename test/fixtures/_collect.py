#!/usr/bin/env python3
"""
_collect.py - Build fixture JSON from curl output
"""

import json
import argparse
import os

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--provider", default="default")
    parser.add_argument("--fetched-at", required=True)
    parser.add_argument("--status", type=int, required=True)
    parser.add_argument("--content-type", required=True)
    parser.add_argument("--encoding", required=True)
    parser.add_argument("--header-file", required=True)
    parser.add_argument("--body-file", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    fixture_dir = os.path.join(args.output_dir, args.name)

    # Parse headers
    headers = {}
    with open(args.header_file, "r") as f:
        for line in f:
            line = line.rstrip("\r\n")
            if ":" in line and not line.startswith(" ") and not line.startswith("\t"):
                idx = line.index(":")
                key = line[:idx].strip().lower()
                value = line[idx+1:].strip()
                headers[key] = value

    # Build response JSON - body as file reference
    response = {
        "url": args.url,
        "method": "GET",
        "fetchedAt": args.fetched_at,
        "provider": args.provider,
        "status": args.status,
        "contentType": args.content_type,
        "contentEncoding": args.encoding,
        "headers": headers,
        "bodyFile": "body.raw"
    }

    # Save response JSON
    response_file = os.path.join(fixture_dir, "response.json")
    with open(response_file, "w", encoding="utf-8") as f:
        json.dump(response, f, indent=2, ensure_ascii=False)

    # Move body file to fixture dir
    body_file = os.path.join(fixture_dir, "body.raw")
    os.rename(args.body_file, body_file)

    print(f"bodySize: {os.path.getsize(body_file)}")

if __name__ == "__main__":
    main()
