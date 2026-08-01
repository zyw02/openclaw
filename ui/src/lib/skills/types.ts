import type { GatewayBrowserClient } from "../../api/gateway.ts";
import type { SkillStatusReport } from "../../api/types.ts";
import type { ClawHubInstallMessage, SkillMessage } from "./messages.ts";

export type ClawHubSearchResult = {
  score: number;
  slug: string;
  displayName: string;
  summary?: string;
  icon?: string | null;
  version?: string;
  updatedAt?: number;
};

export type ClawHubSkillDetail = {
  skill: {
    slug: string;
    displayName: string;
    summary?: string;
    icon?: string | null;
    tags?: Record<string, string>;
    channel?: string | null;
    isOfficial?: boolean | null;
    createdAt: number;
    updatedAt: number;
  } | null;
  latestVersion?: {
    version: string;
    createdAt: number;
    changelog?: string;
  } | null;
  metadata?: {
    os?: string[] | null;
    systems?: string[] | null;
  } | null;
  owner?: {
    handle?: string | null;
    displayName?: string | null;
    image?: string | null;
    official?: boolean | null;
    channel?: string | null;
    isOfficial?: boolean | null;
  } | null;
};

export type ClawHubSkillSecurityVerdict = {
  registry: string;
  ok: boolean;
  decision: string;
  reasons: string[];
  requestedSlug: string;
  requestedVersion: string;
  slug?: string | null;
  version?: string | null;
  displayName?: string | null;
  publisherHandle?: string | null;
  publisherDisplayName?: string | null;
  createdAt?: number | null;
  checkedAt?: number | null;
  skillUrl?: string | null;
  securityAuditUrl?: string | null;
  securityStatus?: string | null;
  securityPassed?: boolean | null;
  error?: {
    code?: string;
    message?: string;
  };
};

export type SkillOperation =
  | { kind: "refresh" }
  | { kind: "skill"; skillKey: string }
  | { kind: "clawhub"; slug: string }
  | null;

export type ActiveSkillOperation = Exclude<SkillOperation, null>;
export type SkillMessageMap = Record<string, SkillMessage>;

export type SkillsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  skillsAgentId: string | null;
  skillsAgentRevision: number;
  skillsLoading: boolean;
  skillsReport: SkillStatusReport | null;
  skillsError: string | null;
  skillOperation: SkillOperation;
  skillEdits: Record<string, string>;
  skillMessages: SkillMessageMap;
  clawhubSearchQuery: string;
  clawhubSearchResults: ClawHubSearchResult[] | null;
  clawhubSearchLoading: boolean;
  clawhubSearchError: string | null;
  clawhubDetail: ClawHubSkillDetail | null;
  clawhubDetailSlug: string | null;
  clawhubDetailLoading: boolean;
  clawhubDetailError: string | null;
  clawhubInstallMessage: ClawHubInstallMessage | null;
  clawhubVerdicts: Record<string, ClawHubSkillSecurityVerdict>;
  clawhubVerdictsLoading: boolean;
  clawhubVerdictsError: string | null;
  skillCardContents: Record<string, string>;
  skillCardContentKeys: Record<string, string>;
  skillCardLoadingKey: string | null;
  skillCardErrors: Record<string, string>;
};
