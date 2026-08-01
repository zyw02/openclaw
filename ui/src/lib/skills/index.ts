import { ClawHubTrustErrorCodes } from "../../../../packages/gateway-protocol/src/clawhub-trust-error-details.js";
import type {
  SkillsInstallParams,
  SkillsUpdateParams,
} from "../../../../packages/gateway-protocol/src/schema/agents-models-skills.js";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import type {
  AgentsListResult,
  SkillClawHubLink,
  SkillStatusEntry,
  SkillStatusReport,
} from "../../api/types.ts";
import {
  formatClawHubAcknowledgementMessage,
  formatClawHubInstallMessage,
  readInstallPolicyWarningText,
  readClawHubTrustDetailsFromError,
  type SkillMessage,
} from "./messages.ts";
import type {
  ActiveSkillOperation,
  ClawHubSearchResult,
  ClawHubSkillDetail,
  ClawHubSkillSecurityVerdict,
  SkillOperation,
  SkillsState,
} from "./types.ts";
export type { ClawHubInstallMessage } from "./messages.ts";
export type {
  ClawHubSearchResult,
  ClawHubSkillDetail,
  ClawHubSkillSecurityVerdict,
  SkillMessageMap,
  SkillOperation,
} from "./types.ts";

function ownsSkillOperation(
  state: SkillsState,
  client: GatewayBrowserClient,
  operation: ActiveSkillOperation,
): boolean {
  return state.connected && state.client === client && state.skillOperation === operation;
}

function releaseSkillOperation(state: SkillsState, operation: ActiveSkillOperation) {
  // Agent/source changes can outlive an owner request; identity keeps stale
  // cleanup from releasing a newer connection's operation.
  if (state.skillOperation === operation) {
    state.skillOperation = null;
  }
}

function setSkillMessage(state: SkillsState, key: string, message: SkillMessage) {
  if (!key.trim()) {
    return;
  }
  state.skillMessages = { ...state.skillMessages, [key]: message };
}

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function clawhubVerdictKey(target: {
  registry: string;
  slug: string;
  version: string;
}): string {
  return `${target.registry}\0${target.slug}\0${target.version}`;
}

function isValidClawHubLink(
  link: SkillClawHubLink | undefined,
): link is Extract<SkillClawHubLink, { status: "linked"; valid: true }> {
  return Boolean(link && link.status === "linked" && link.valid);
}

function reportHasLinkedClawHubSkills(report: SkillStatusReport): boolean {
  return report.skills.some((skill) => isValidClawHubLink(skill.clawhub));
}

function skillCardCacheKey(skill: SkillStatusEntry): string | undefined {
  if (!skill.skillCard?.present) {
    return undefined;
  }
  const installedVersion =
    skill.clawhub?.status === "linked" && skill.clawhub.valid ? skill.clawhub.installedVersion : "";
  return `${skill.skillCard.path}\0${skill.skillCard.sizeBytes}\0${installedVersion}`;
}

function currentSkillCardCacheKey(state: SkillsState, skillKey: string): string | undefined {
  const skill = state.skillsReport?.skills.find((entry) => entry.skillKey === skillKey);
  return skill ? skillCardCacheKey(skill) : undefined;
}

function skillsAgentParams(agentId: string | null | undefined): { agentId?: string } {
  const normalized = agentId?.trim();
  return normalized ? { agentId: normalized } : {};
}

function stateSkillsAgentParams(state: Pick<SkillsState, "skillsAgentId">): { agentId?: string } {
  const agentId = state.skillsAgentId?.trim();
  return agentId ? { agentId } : {};
}

export async function loadSkillStatusReport(
  client: GatewayBrowserClient,
  agentId: string | null | undefined,
): Promise<SkillStatusReport | undefined> {
  return client.request<SkillStatusReport | undefined>("skills.status", skillsAgentParams(agentId));
}

type SkillsAgentScope = {
  agentId: string | null;
  revision: number;
};

function captureSkillsAgentScope(
  state: Pick<SkillsState, "skillsAgentId" | "skillsAgentRevision">,
): SkillsAgentScope {
  return {
    agentId: state.skillsAgentId,
    revision: state.skillsAgentRevision,
  };
}

function isSkillsAgentScopeCurrent(
  state: Pick<SkillsState, "skillsAgentId" | "skillsAgentRevision">,
  scope: SkillsAgentScope,
): boolean {
  return state.skillsAgentId === scope.agentId && state.skillsAgentRevision === scope.revision;
}

async function runStaleAwareRequest<T>(
  isCurrent: () => boolean,
  request: () => Promise<T>,
  onSuccess: (value: T) => void,
  onError: (err: unknown) => void,
  onFinally: () => void,
) {
  try {
    const result = await request();
    if (!isCurrent()) {
      return;
    }
    onSuccess(result);
  } catch (err) {
    if (!isCurrent()) {
      return;
    }
    onError(err);
  }
  onFinally();
}

export function setSkillsAgentId(state: SkillsState, agentId: string | null) {
  const nextAgentId = agentId?.trim() || null;
  if (state.skillsAgentId === nextAgentId) {
    return;
  }
  state.skillsAgentId = nextAgentId;
  state.skillsAgentRevision++;
  state.skillsLoading = false;
  state.skillsReport = null;
  state.skillsError = null;
  state.skillEdits = {};
  state.skillMessages = {};
  state.clawhubInstallMessage = null;
  state.clawhubVerdicts = {};
  state.clawhubVerdictsLoading = false;
  state.clawhubVerdictsError = null;
  state.skillCardContents = {};
  state.skillCardContentKeys = {};
  state.skillCardLoadingKey = null;
  state.skillCardErrors = {};
}

export function reconcileSkillsAgentId(
  state: SkillsState,
  agentsList: AgentsListResult | null | undefined,
) {
  if (
    agentsList &&
    state.skillsAgentId &&
    !agentsList.agents.some((agent) => agent.id === state.skillsAgentId)
  ) {
    setSkillsAgentId(state, null);
  }
}

export async function loadSkills(
  state: SkillsState,
  options?: {
    clearMessages?: boolean;
    operation?: Exclude<SkillOperation, null>;
  },
) {
  const client = state.client;
  if (
    !client ||
    !state.connected ||
    state.skillsLoading ||
    (state.skillOperation && state.skillOperation !== options?.operation)
  ) {
    return;
  }
  if (options?.clearMessages && Object.keys(state.skillMessages).length > 0) {
    state.skillMessages = {};
  }
  const agentScope = captureSkillsAgentScope(state);
  const ownsLoad = () =>
    state.client === client &&
    isSkillsAgentScopeCurrent(state, agentScope) &&
    (!options?.operation || state.skillOperation === options.operation);
  const isCurrent = () => state.connected && ownsLoad();
  state.skillsLoading = true;
  state.skillsError = null;
  try {
    const res = await loadSkillStatusReport(client, state.skillsAgentId);
    if (!isCurrent()) {
      return;
    }
    if (res && Array.isArray(res.skills)) {
      state.skillsReport = res;
      pruneSkillCardState(state, res);
      void loadClawHubSecurityVerdicts(state, res);
    }
  } catch (err) {
    if (!isCurrent()) {
      return;
    }
    state.skillsError = getErrorMessage(err);
  } finally {
    // A transient disconnect invalidates the result, not this invocation's
    // loading ownership. Source/scope identity still protects newer loads.
    if (ownsLoad()) {
      state.skillsLoading = false;
    }
  }
}

async function loadCurrentSkillsForOperation(
  state: SkillsState,
  client: GatewayBrowserClient,
  operation: ActiveSkillOperation,
  clearMessages = false,
) {
  let shouldClearMessages = clearMessages;
  // Reconciliation can change scope while a status request is pending. Keep
  // the operation owner until one response belongs to the current scope.
  while (ownsSkillOperation(state, client, operation)) {
    const scope = captureSkillsAgentScope(state);
    await loadSkills(state, { clearMessages: shouldClearMessages, operation });
    shouldClearMessages = false;
    if (!ownsSkillOperation(state, client, operation) || isSkillsAgentScopeCurrent(state, scope)) {
      return;
    }
  }
}

export async function refreshSkills(state: SkillsState, loadAgents: () => Promise<void>) {
  const client = state.client;
  if (!client || !state.connected || state.skillsLoading || state.skillOperation) {
    return;
  }
  const operation = { kind: "refresh" } as const;
  // Reserve one operation across both awaits so a second refresh or write
  // cannot enter while agent discovery is still pending.
  state.skillOperation = operation;
  try {
    await loadAgents();
    if (!ownsSkillOperation(state, client, operation)) {
      return;
    }
    await loadCurrentSkillsForOperation(state, client, operation, true);
  } finally {
    releaseSkillOperation(state, operation);
  }
}

function pruneSkillCardState(state: SkillsState, report: SkillStatusReport) {
  const cacheKeys = new Map(
    report.skills
      .map((skill) => [skill.skillKey, skillCardCacheKey(skill)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
  );
  state.skillCardContents = Object.fromEntries(
    Object.entries(state.skillCardContents).filter(
      ([key]) => state.skillCardContentKeys[key] === cacheKeys.get(key),
    ),
  );
  state.skillCardContentKeys = Object.fromEntries(
    Object.entries(state.skillCardContentKeys).filter(
      ([key, value]) => value === cacheKeys.get(key),
    ),
  );
  state.skillCardErrors = Object.fromEntries(
    Object.entries(state.skillCardErrors).filter(([key]) => cacheKeys.has(key)),
  );
  if (state.skillCardLoadingKey && !cacheKeys.has(state.skillCardLoadingKey)) {
    state.skillCardLoadingKey = null;
  }
}

export async function loadSkillCard(state: SkillsState, skillKey: string) {
  if (
    !state.client ||
    !state.connected ||
    state.skillCardLoadingKey === skillKey ||
    (state.skillCardContents[skillKey] !== undefined &&
      state.skillCardContentKeys[skillKey] === currentSkillCardCacheKey(state, skillKey))
  ) {
    return;
  }
  const cacheKey = currentSkillCardCacheKey(state, skillKey);
  if (!cacheKey) {
    return;
  }
  const agentScope = captureSkillsAgentScope(state);
  const requestParams = { ...stateSkillsAgentParams(state), skillKey };
  state.skillCardLoadingKey = skillKey;
  const { [skillKey]: _previousError, ...nextErrors } = state.skillCardErrors;
  state.skillCardErrors = nextErrors;
  try {
    const response = await state.client.request<{
      schema: "openclaw.skills.skill-card.v1";
      skillKey: string;
      path: string;
      sizeBytes: number;
      content: string;
    }>("skills.skillCard", requestParams);
    if (
      isSkillsAgentScopeCurrent(state, agentScope) &&
      response?.skillKey === skillKey &&
      typeof response.content === "string" &&
      currentSkillCardCacheKey(state, skillKey) === cacheKey
    ) {
      state.skillCardContents = { ...state.skillCardContents, [skillKey]: response.content };
      state.skillCardContentKeys = { ...state.skillCardContentKeys, [skillKey]: cacheKey };
    }
  } catch (err) {
    if (isSkillsAgentScopeCurrent(state, agentScope)) {
      state.skillCardErrors = { ...state.skillCardErrors, [skillKey]: getErrorMessage(err) };
    }
  } finally {
    if (isSkillsAgentScopeCurrent(state, agentScope) && state.skillCardLoadingKey === skillKey) {
      state.skillCardLoadingKey = null;
    }
  }
}

async function loadClawHubSecurityVerdicts(state: SkillsState, report: SkillStatusReport) {
  const client = state.client;
  const agentScope = captureSkillsAgentScope(state);
  if (!client || !state.connected || !reportHasLinkedClawHubSkills(report)) {
    state.clawhubVerdicts = {};
    state.clawhubVerdictsLoading = false;
    state.clawhubVerdictsError = null;
    return;
  }
  state.clawhubVerdictsLoading = true;
  state.clawhubVerdictsError = null;
  try {
    const response = await client.request<{
      schema: "openclaw.skills.security-verdicts.v1";
      items: ClawHubSkillSecurityVerdict[];
    }>("skills.securityVerdicts", stateSkillsAgentParams(state));
    if (!isSkillsAgentScopeCurrent(state, agentScope)) {
      return;
    }
    state.clawhubVerdicts = Object.fromEntries(
      (response?.items ?? []).map((item) => [
        clawhubVerdictKey({
          registry: item.registry,
          slug: item.requestedSlug,
          version: item.requestedVersion,
        }),
        item,
      ]),
    );
  } catch (err) {
    if (!isSkillsAgentScopeCurrent(state, agentScope)) {
      return;
    }
    state.clawhubVerdicts = {};
    state.clawhubVerdictsError = getErrorMessage(err);
  } finally {
    if (isSkillsAgentScopeCurrent(state, agentScope)) {
      state.clawhubVerdictsLoading = false;
    }
  }
}

export function updateSkillEdit(state: SkillsState, skillKey: string, value: string) {
  if (state.skillOperation || state.skillsLoading) {
    return;
  }
  state.skillEdits = { ...state.skillEdits, [skillKey]: value };
}

async function runSkillMutation(
  state: SkillsState,
  skillKey: string,
  run: (client: GatewayBrowserClient) => Promise<SkillMessage>,
) {
  const client = state.client;
  if (!client || !state.connected || state.skillsLoading || state.skillOperation) {
    return;
  }
  const agentScope = captureSkillsAgentScope(state);
  const operation = { kind: "skill", skillKey } as const;
  // All writes share one owner: overlapping refreshes can otherwise publish
  // a stale snapshot after both Gateway mutations have already succeeded.
  state.skillOperation = operation;
  state.skillsError = null;
  try {
    const message = await run(client);
    if (!ownsSkillOperation(state, client, operation)) {
      return;
    }
    if (!isSkillsAgentScopeCurrent(state, agentScope)) {
      return;
    }
    await loadSkills(state, { operation });
    if (
      !ownsSkillOperation(state, client, operation) ||
      !isSkillsAgentScopeCurrent(state, agentScope)
    ) {
      return;
    }
    setSkillMessage(state, skillKey, message);
  } catch (err) {
    if (
      !ownsSkillOperation(state, client, operation) ||
      !isSkillsAgentScopeCurrent(state, agentScope)
    ) {
      return;
    }
    const message = getErrorMessage(err);
    state.skillsError = message;
    setSkillMessage(state, skillKey, {
      kind: "error",
      message,
    });
  } finally {
    if (
      ownsSkillOperation(state, client, operation) &&
      !isSkillsAgentScopeCurrent(state, agentScope)
    ) {
      await loadCurrentSkillsForOperation(state, client, operation);
    }
    releaseSkillOperation(state, operation);
  }
}

export async function updateSkillEnabled(state: SkillsState, skillKey: string, enabled: boolean) {
  await runSkillMutation(state, skillKey, async (client) => {
    await client.request("skills.update", {
      skillKey,
      enabled,
    } satisfies SkillsUpdateParams);
    return {
      kind: "success",
      message: enabled ? "Skill enabled" : "Skill disabled",
    };
  });
}

export async function saveSkillApiKey(state: SkillsState, skillKey: string) {
  await runSkillMutation(state, skillKey, async (client) => {
    const editValue = state.skillEdits[skillKey] ?? "";
    await client.request("skills.update", {
      skillKey,
      apiKey: editValue,
    } satisfies SkillsUpdateParams);
    return {
      kind: "success",
      message: `API key saved — stored in openclaw.json (skills.entries.${skillKey})`,
    };
  });
}

export async function installSkill(
  state: SkillsState,
  skillKey: string,
  name: string,
  installId: string,
  dangerouslyForceUnsafeInstall = false,
  acknowledgeInstallPolicyWarning = false,
) {
  await runSkillMutation(state, skillKey, async (client) => {
    try {
      const result = await client.request<{ message?: string }>("skills.install", {
        ...stateSkillsAgentParams(state),
        name,
        installId,
        dangerouslyForceUnsafeInstall,
        ...(acknowledgeInstallPolicyWarning ? { acknowledgeInstallPolicyWarning: true } : {}),
        timeoutMs: 120000,
      } satisfies Extract<SkillsInstallParams, { installId: string }>);
      return {
        kind: "success",
        message: result?.message ?? "Installed",
      };
    } catch (error) {
      const warningText = readInstallPolicyWarningText(error);
      if (!warningText) {
        throw error;
      }
      return {
        kind: "error",
        message: warningText,
        acknowledgeInstallPolicyWarning: { name, installId },
      };
    }
  });
}

export async function searchClawHub(
  client: GatewayBrowserClient,
  query: string,
  signal?: AbortSignal,
): Promise<ClawHubSearchResult[]> {
  if (!query.trim()) {
    return [];
  }
  const response = await client.request<{ results: ClawHubSearchResult[] }>(
    "skills.search",
    { query, limit: 20 },
    { signal },
  );
  return response?.results ?? [];
}

export async function loadClawHubDetail(state: SkillsState, slug: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const client = state.client;
  const agentScope = captureSkillsAgentScope(state);
  state.clawhubDetailSlug = slug;
  state.clawhubDetailLoading = true;
  state.clawhubDetailError = null;
  state.clawhubDetail = null;
  await runStaleAwareRequest(
    () =>
      state.connected &&
      state.client === client &&
      slug === state.clawhubDetailSlug &&
      isSkillsAgentScopeCurrent(state, agentScope),
    () => client.request<ClawHubSkillDetail>("skills.detail", { slug }),
    (res) => {
      state.clawhubDetail = res ?? null;
    },
    (err) => {
      state.clawhubDetailError = getErrorMessage(err);
    },
    () => {
      state.clawhubDetailLoading = false;
    },
  );
}

export function closeClawHubDetail(state: SkillsState) {
  state.clawhubDetailSlug = null;
  state.clawhubDetail = null;
  state.clawhubDetailError = null;
  state.clawhubDetailLoading = false;
}

export async function installFromClawHub(
  state: SkillsState,
  slug: string,
  acknowledgeClawHubRisk = false,
  version?: string,
  acknowledgeInstallPolicyWarning = false,
) {
  const client = state.client;
  if (!client || !state.connected || state.skillsLoading || state.skillOperation) {
    return;
  }
  const agentScope = captureSkillsAgentScope(state);
  const operation = { kind: "clawhub", slug } as const;
  state.skillOperation = operation;
  state.clawhubInstallMessage = null;
  try {
    const result = await client.request<{ message?: string; warning?: string }>("skills.install", {
      ...stateSkillsAgentParams(state),
      source: "clawhub",
      slug,
      ...(version ? { version } : {}),
      ...(acknowledgeClawHubRisk ? { acknowledgeClawHubRisk: true } : {}),
      ...(acknowledgeInstallPolicyWarning ? { acknowledgeInstallPolicyWarning: true } : {}),
    } satisfies Extract<SkillsInstallParams, { source: "clawhub" }>);
    if (!ownsSkillOperation(state, client, operation)) {
      return;
    }
    if (!isSkillsAgentScopeCurrent(state, agentScope)) {
      return;
    }
    await loadSkills(state, { operation });
    if (
      !ownsSkillOperation(state, client, operation) ||
      !isSkillsAgentScopeCurrent(state, agentScope)
    ) {
      return;
    }
    state.clawhubInstallMessage = {
      kind: "success",
      text: formatClawHubInstallMessage(result?.message ?? `Installed ${slug}`, result?.warning),
    };
  } catch (err) {
    if (
      ownsSkillOperation(state, client, operation) &&
      isSkillsAgentScopeCurrent(state, agentScope)
    ) {
      const trustDetails = readClawHubTrustDetailsFromError(err);
      const installPolicyWarningText = readInstallPolicyWarningText(err);
      if (installPolicyWarningText) {
        state.clawhubInstallMessage = {
          kind: "error",
          text: installPolicyWarningText,
          acknowledgeSlug: slug,
          ...(version ? { acknowledgeVersion: version } : {}),
          ...(acknowledgeClawHubRisk ? { acknowledgeClawHubRisk: true } : {}),
          acknowledgeInstallPolicyWarning: true,
        };
        return;
      }
      const needsAcknowledgement =
        trustDetails?.clawhubTrustCode === ClawHubTrustErrorCodes.RISK_ACKNOWLEDGEMENT_REQUIRED;
      state.clawhubInstallMessage = needsAcknowledgement
        ? {
            kind: "error",
            text: formatClawHubAcknowledgementMessage(trustDetails?.warning),
            acknowledgeSlug: slug,
            ...(trustDetails?.version ? { acknowledgeVersion: trustDetails.version } : {}),
            acknowledgeLabel: "Acknowledge risk and install",
            acknowledgeClawHubRisk: true,
          }
        : {
            kind: "error",
            text: formatClawHubInstallMessage(getErrorMessage(err), trustDetails?.warning),
          };
    }
  } finally {
    if (
      ownsSkillOperation(state, client, operation) &&
      !isSkillsAgentScopeCurrent(state, agentScope)
    ) {
      await loadCurrentSkillsForOperation(state, client, operation);
    }
    releaseSkillOperation(state, operation);
  }
}
