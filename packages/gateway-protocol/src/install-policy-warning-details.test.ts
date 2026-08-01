import { describe, expect, it } from "vitest";
import {
  buildInstallPolicyWarningDetails,
  formatInstallPolicyWarningDetails,
  readInstallPolicyWarningDetails,
} from "./install-policy-warning-details.js";

describe("install-policy warning details", () => {
  it("round-trips a warning with findings", () => {
    const details = buildInstallPolicyWarningDetails({
      warning: {
        reason: "manual review recommended",
        findings: [
          {
            ruleId: "dangerous-exec",
            severity: "warn",
            message: "The package launches a child process.",
            file: "index.js",
            line: 12,
          },
        ],
      },
    });

    expect(readInstallPolicyWarningDetails(details)).toEqual(details);
  });

  it("requires a non-empty reason and ignores malformed findings", () => {
    expect(
      readInstallPolicyWarningDetails({ installPolicyWarning: { reason: " " } }),
    ).toBeUndefined();
    expect(
      readInstallPolicyWarningDetails({
        installPolicyWarning: {
          reason: "manual review recommended",
          findings: [
            {
              ruleId: "dangerous-exec",
              severity: "unknown",
              message: "The package launches a child process.",
            },
          ],
        },
      }),
    ).toEqual({
      installPolicyWarning: {
        reason: "manual review recommended",
      },
    });
  });

  it("bounds findings read from Gateway error details", () => {
    const findings = Array.from({ length: 101 }, (_, index) => ({
      ruleId: `rule-${index}`,
      severity: "info",
      message: `Finding ${index}`,
    }));

    expect(
      readInstallPolicyWarningDetails({
        installPolicyWarning: { reason: "manual review recommended", findings },
      })?.installPolicyWarning.findings,
    ).toHaveLength(100);
  });

  it("formats every finding with location and evidence", () => {
    expect(
      formatInstallPolicyWarningDetails({
        reason: "manual review recommended",
        findings: [
          {
            ruleId: "dangerous-exec",
            severity: "critical",
            message: "The package launches a child process.",
            file: "index.js",
            line: 12,
            evidence: "exec(command)",
          },
          {
            ruleId: "network-access",
            severity: "info",
            message: "The package opens a network connection.",
            line: 7,
          },
        ],
      }),
    ).toBe(
      [
        "manual review recommended",
        "• [CRITICAL · dangerous-exec · index.js:12] The package launches a child process.",
        "  ↳ exec(command)",
        "• [INFO · network-access · line 7] The package opens a network connection.",
      ].join("\n"),
    );
  });
});
