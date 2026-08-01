import {
  formatInstallPolicyWarningDetails,
  readInstallPolicyWarningDetails,
  type InstallPolicyWarningDetails,
} from "../../../packages/gateway-protocol/src/install-policy-warning-details.js";

export function formatInstallPolicyWarning(
  warning: InstallPolicyWarningDetails["installPolicyWarning"],
): string {
  return formatInstallPolicyWarningDetails(warning);
}

export function readInstallPolicyWarningText(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("details" in error)) {
    return undefined;
  }
  const warning = readInstallPolicyWarningDetails(
    (error as { details?: unknown }).details,
  )?.installPolicyWarning;
  return warning ? formatInstallPolicyWarning(warning) : undefined;
}
