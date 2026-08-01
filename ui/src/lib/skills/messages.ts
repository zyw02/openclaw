import { readClawHubTrustErrorDetails } from "../../../../packages/gateway-protocol/src/clawhub-trust-error-details.js";

export { readInstallPolicyWarningText } from "../install-policy-warning.ts";

export function readClawHubTrustDetailsFromError(error: unknown) {
  if (!error || typeof error !== "object" || !("details" in error)) {
    return undefined;
  }
  return readClawHubTrustErrorDetails((error as { details?: unknown }).details);
}

export const formatClawHubInstallMessage = (message: string, warning?: string): string =>
  warning ? `${message}\n\n${warning}` : message;

export function formatClawHubAcknowledgementMessage(warning?: string): string {
  return formatClawHubInstallMessage(
    "Review the ClawHub warning before installing this skill.",
    warning,
  );
}

type ClawHubInstallMessageBase = {
  text: string;
};

type ClawHubInstallMessageWithoutRetry = ClawHubInstallMessageBase & {
  acknowledgeSlug?: never;
  acknowledgeVersion?: never;
  acknowledgeLabel?: never;
  acknowledgeClawHubRisk?: never;
  acknowledgeInstallPolicyWarning?: never;
};

type ClawHubInstallRetryMessage = ClawHubInstallMessageBase & {
  kind: "error";
  acknowledgeSlug: string;
  acknowledgeVersion?: string;
  acknowledgeLabel?: string;
} & (
    | {
        acknowledgeClawHubRisk: true;
        acknowledgeInstallPolicyWarning?: never;
      }
    | {
        acknowledgeClawHubRisk?: true;
        acknowledgeInstallPolicyWarning: true;
      }
  );

export type ClawHubInstallMessage =
  | (ClawHubInstallMessageWithoutRetry & { kind: "success" | "error" })
  | ClawHubInstallRetryMessage;

export type SkillMessage = {
  kind: "success" | "error";
  message: string;
  acknowledgeInstallPolicyWarning?: {
    name: string;
    installId: string;
  };
};
