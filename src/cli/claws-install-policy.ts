import type { InstallSafetyOverrides } from "../plugins/install-security-scan.js";
import { resolveInstallPolicyAcknowledgementCliOptions } from "./install-policy-acknowledgement.js";

type ClawInstallPolicyOptions = Pick<
  InstallSafetyOverrides,
  "acknowledgeInstallPolicyWarning" | "onInstallPolicyWarning"
>;

export function resolveClawInstallPolicyOptions(params: {
  action: "install" | "update";
  dangerouslyForceUnsafeInstall?: boolean;
  json?: boolean;
}): ClawInstallPolicyOptions {
  const resolved = resolveInstallPolicyAcknowledgementCliOptions({
    action: params.action,
    dangerouslyForceUnsafeInstall: params.dangerouslyForceUnsafeInstall,
    allowPrompt: params.json !== true,
  });
  if (resolved.acknowledgeInstallPolicyWarning || resolved.onInstallPolicyWarning) {
    return resolved;
  }
  return { onInstallPolicyWarning: async () => false };
}
