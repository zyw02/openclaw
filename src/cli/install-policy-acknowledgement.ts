import { formatInstallPolicyWarningDetails } from "../../packages/gateway-protocol/src/install-policy-warning-details.js";
import { sanitizeTerminalText } from "../../packages/terminal-core/src/safe-text.js";
import type { InstallPolicyWarning } from "../plugins/install-security-scan.js";
import { promptYesNo } from "./prompt.js";

function canPromptForInstallPolicyWarning(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}

export function resolveInstallPolicyAcknowledgementCliOptions(params: {
  dangerouslyForceUnsafeInstall?: boolean;
  action: "install" | "update";
  allowPrompt?: boolean;
}): {
  acknowledgeInstallPolicyWarning?: boolean;
  onInstallPolicyWarning?: (warning: InstallPolicyWarning) => Promise<boolean>;
} {
  if (params.dangerouslyForceUnsafeInstall === true) {
    return { acknowledgeInstallPolicyWarning: true };
  }
  if (params.allowPrompt === false || !canPromptForInstallPolicyWarning()) {
    return {};
  }
  return {
    onInstallPolicyWarning: async (warning) =>
      await promptYesNo(
        `${params.action === "install" ? "Install" : "Update"} after this policy warning?\n${formatInstallPolicyWarningDetails(
          warning,
          sanitizeTerminalText,
        )}`,
      ),
  };
}
