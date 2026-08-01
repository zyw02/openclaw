import { describe, expect, it, vi } from "vitest";
import { confirmWizardInstallPolicyWarning } from "./install-policy-warning.js";

describe("confirmWizardInstallPolicyWarning", () => {
  it("shows sanitized structured findings before asking for confirmation", async () => {
    const note = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.fn().mockResolvedValue(true);

    await expect(
      confirmWizardInstallPolicyWarning({
        prompter: { note, confirm } as never,
        warning: {
          reason: "Review\nthis package.",
          findings: [
            {
              ruleId: "dangerous-exec",
              severity: "warn",
              message: "Launches an executable.",
              file: "index.js",
              line: 12,
              evidence: "exec(\u001b[2Kcommand)",
            },
          ],
        },
      }),
    ).resolves.toBe(true);

    expect(note).toHaveBeenCalledWith(
      [
        "Review\\nthis package.",
        "• [WARN · dangerous-exec · index.js:12] Launches an executable.",
        "  ↳ exec(command)",
      ].join("\n"),
      "Install policy warning",
    );
    expect(confirm).toHaveBeenCalledWith({
      message: "Continue after reviewing this install policy warning?",
      initialValue: false,
    });
  });
});
