import { beforeEach, describe, expect, it, vi } from "vitest";
import { installPluginFromPluginsCommand } from "./commands-plugins-install.js";

const installManagedPluginSourceMock = vi.hoisted(() => vi.fn());

vi.mock("../../plugins/management-service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../plugins/management-service.js")>()),
  installManagedPluginSource: installManagedPluginSourceMock,
}));

describe("/plugins install policy warnings", () => {
  beforeEach(() => {
    installManagedPluginSourceMock.mockReset();
  });

  it("returns full findings with a trusted-shell recovery command", async () => {
    installManagedPluginSourceMock.mockResolvedValue({
      ok: false,
      error: "Manual review required.",
      code: "install_policy_acknowledgement_required",
      installPolicyWarning: {
        reason: "Manual review required.",
        findings: [
          {
            ruleId: "dangerous-exec",
            severity: "critical",
            message: "The package launches a child process.",
            file: "index.js",
            line: 12,
            evidence: "exec(command)",
          },
        ],
      },
    });

    const result = await installPluginFromPluginsCommand({
      raw: "@acme/policy-plugin@1.0.0",
      force: true,
      snapshot: {} as never,
    });

    expect(result).toEqual({
      ok: false,
      error: [
        "Manual review required.",
        "• [CRITICAL · dangerous-exec · index.js:12] The package launches a child process.",
        "  ↳ exec(command)",
        "The /plugins chat command cannot acknowledge operator install policy warnings.",
        "After reviewing the findings, run openclaw plugins install @acme/policy-plugin@1.0.0 --force --dangerously-force-unsafe-install from a trusted shell to continue.",
      ].join("\n"),
    });
  });
});
