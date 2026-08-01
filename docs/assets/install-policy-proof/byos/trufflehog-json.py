#!/usr/bin/env python3
import json
import subprocess
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: trufflehog-json.py TARGET", file=sys.stderr)
        return 2

    completed = subprocess.run(
        [
            "trufflehog",
            "filesystem",
            "--json",
            "--no-update",
            "--no-verification",
            sys.argv[1],
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.stderr:
        print(completed.stderr, end="", file=sys.stderr)
    if completed.returncode != 0:
        return completed.returncode

    findings = []
    for line in completed.stdout.splitlines():
        if not line.strip():
            continue
        finding = json.loads(line)
        findings.append(
            {
                "detectorName": finding.get("DetectorName"),
                "detectorType": finding.get("DetectorType"),
                "verified": finding.get("Verified", False),
            }
        )
    json.dump({"findings": findings}, sys.stdout, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
