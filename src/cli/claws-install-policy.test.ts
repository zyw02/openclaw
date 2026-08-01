import { describe, expect, it } from "vitest";
import { resolveClawInstallPolicyOptions } from "./claws-install-policy.js";

describe("resolveClawInstallPolicyOptions", () => {
  it("maps the existing unsafe-install flag to policy acknowledgement", () => {
    expect(
      resolveClawInstallPolicyOptions({
        action: "install",
        dangerouslyForceUnsafeInstall: true,
      }),
    ).toEqual({ acknowledgeInstallPolicyWarning: true });
  });

  it("rejects policy warnings without prompting in JSON mode", async () => {
    const options = resolveClawInstallPolicyOptions({
      action: "update",
      json: true,
    });

    await expect(
      options.onInstallPolicyWarning?.({ reason: "Manual review required." }),
    ).resolves.toBe(false);
  });
});
