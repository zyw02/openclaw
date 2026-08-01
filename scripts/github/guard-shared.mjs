import { setTimeout as wait } from "node:timers/promises";
import { readBoundedResponseText } from "../lib/bounded-response.mjs";
import { isOctopoolReadPath } from "./octopool-read.mjs";

export const GITHUB_ERROR_BODY_MAX_BYTES = 64 * 1024;
export const GITHUB_RESPONSE_BODY_MAX_BYTES = 4 * 1024 * 1024;
export const GITHUB_API_REQUEST_TIMEOUT_MS = 30_000;
export const GITHUB_PAGINATION_MAX_PAGES = 100;

const githubApiRetryStatuses = new Set([502, 503, 504]);
const githubApiRetryDelaysMs = [1_000, 2_000, 4_000];

export function guardTrustedActorCandidates({ pullRequest, event, currentHeadSha }) {
  const eventHeadSha = event?.pull_request?.head?.sha;
  const eventAfterSha = event?.after;
  const eventMatchesCurrentHead =
    Boolean(currentHeadSha) &&
    (eventHeadSha === currentHeadSha || eventAfterSha === currentHeadSha);
  if (!eventMatchesCurrentHead) {
    return [];
  }
  const candidates = [];
  const seen = new Set();
  for (const [source, login] of [["pull request author", pullRequest?.user?.login]]) {
    if (typeof login !== "string" || login.length === 0) {
      continue;
    }
    const normalizedLogin = login.toLowerCase();
    if (seen.has(normalizedLogin)) {
      continue;
    }
    seen.add(normalizedLogin);
    candidates.push({ login, source });
  }
  return candidates;
}

export function isCommentNewerThan(comment, newerThan) {
  if (!newerThan) {
    return false;
  }
  const commentTime = Date.parse(comment.created_at ?? "");
  const barrierTime = Date.parse(newerThan);
  return Number.isFinite(commentTime) && Number.isFinite(barrierTime) && commentTime > barrierTime;
}

export function guardCommentHeadSha(comment) {
  const body = comment?.body ?? "";
  const patterns = [
    /Approved SHA:\s+`([a-f0-9]{40})`/iu,
    /current head SHA\s+\(`([a-f0-9]{40})`\)/iu,
    /Current SHA:\s+`([a-f0-9]{40})`/iu,
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

export function createIssueMutationHelpers({
  api,
  issuePath,
  owner,
  repo,
  labelNames,
  warn = console.warn,
}) {
  const ignoreUnavailableWritePermission = (action) => (error) => {
    if (error?.status === 403) {
      warn(`Skipping ${action}; token does not have write permission.`);
      return;
    }
    if (error?.status === 404 || error?.status === 422) {
      warn(`${action} is unavailable.`);
      return;
    }
    throw error;
  };
  const removeLabelIfPresent = async (label) => {
    if (!labelNames.has(label)) {
      return;
    }
    await api
      .request(`${issuePath}/labels/${encodeURIComponent(label)}`, {
        method: "DELETE",
      })
      .catch(ignoreUnavailableWritePermission(`label "${label}" removal`));
    labelNames.delete(label);
  };
  const addLabelIfMissing = async (label) => {
    if (labelNames.has(label)) {
      return;
    }
    await api
      .request(`${issuePath}/labels`, {
        method: "POST",
        body: JSON.stringify({ labels: [label] }),
      })
      .catch(ignoreUnavailableWritePermission(`label "${label}" update`));
    labelNames.add(label);
  };
  const deleteCommentIfPresent = async (comment) => {
    if (!comment) {
      return;
    }
    await api
      .request(`/repos/${owner}/${repo}/issues/comments/${comment.id}`, {
        method: "DELETE",
      })
      .catch(ignoreUnavailableWritePermission("comment deletion"));
  };
  const upsertComment = async (comment, body) => {
    if (comment) {
      return await api
        .request(`/repos/${owner}/${repo}/issues/comments/${comment.id}`, {
          method: "PATCH",
          body: JSON.stringify({ body }),
        })
        .catch(ignoreUnavailableWritePermission("comment update"));
    }
    return await api
      .request(`${issuePath}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      })
      .catch(ignoreUnavailableWritePermission("comment creation"));
  };
  return { removeLabelIfPresent, addLabelIfMissing, deleteCommentIfPresent, upsertComment };
}

export function createGuardApproverChecks({
  api,
  owner,
  repo,
  securityTeamSlug,
  explicitSecurityApprovers,
  warn = console.warn,
}) {
  const membershipCache = new Map();
  const permissionCache = new Map();
  const isSecurityMember = async (login) => {
    const normalizedLogin = login.toLowerCase();
    if (explicitSecurityApprovers.has(normalizedLogin)) {
      return true;
    }
    if (membershipCache.has(normalizedLogin)) {
      return membershipCache.get(normalizedLogin);
    }
    try {
      const membership = await api.request(
        `/orgs/${owner}/teams/${securityTeamSlug}/memberships/${encodeURIComponent(login)}`,
      );
      const allowed = membership?.state === "active";
      membershipCache.set(normalizedLogin, allowed);
      return allowed;
    } catch (error) {
      if (error?.status !== 404) {
        warn(`Could not verify ${login} against ${securityTeamSlug}: ${error.message}`);
      }
      membershipCache.set(normalizedLogin, false);
      return false;
    }
  };
  const isRepositoryAdmin = async (login) => {
    const normalizedLogin = login.toLowerCase();
    if (permissionCache.has(normalizedLogin)) {
      return permissionCache.get(normalizedLogin);
    }
    try {
      const result = await api.request(
        `/repos/${owner}/${repo}/collaborators/${encodeURIComponent(login)}/permission`,
      );
      const allowed = result?.permission === "admin";
      permissionCache.set(normalizedLogin, allowed);
      return allowed;
    } catch (error) {
      if (error?.status !== 404) {
        warn(`Could not verify repository permission for ${login}: ${error.message}`);
      }
      permissionCache.set(normalizedLogin, false);
      return false;
    }
  };
  return { isSecurityMember, isRepositoryAdmin };
}

function githubErrorBodyTooLarge(maxBytes) {
  return new Error(`GitHub error response body exceeded ${maxBytes} bytes`);
}

function githubResponseBodyTooLarge(maxBytes) {
  return new Error(`GitHub response body exceeded ${maxBytes} bytes`);
}

export async function readBoundedGitHubErrorText(
  response,
  maxBytes = GITHUB_ERROR_BODY_MAX_BYTES,
  options = {},
) {
  return await readBoundedResponseText(response, "GitHub error", maxBytes, {
    createTooLargeError: () => githubErrorBodyTooLarge(maxBytes),
    ...options,
  });
}

export async function readBoundedGitHubJson(
  response,
  maxBytes = GITHUB_RESPONSE_BODY_MAX_BYTES,
  options = {},
) {
  const text = await readBoundedResponseText(response, "GitHub", maxBytes, {
    createTooLargeError: () => githubResponseBodyTooLarge(maxBytes),
    ...options,
  });
  return JSON.parse(text);
}

function timeoutError(path, method, timeoutMs) {
  return new Error(`GitHub API ${method} ${path} exceeded timeout ${timeoutMs}ms`);
}

function combineAbortSignals(signals) {
  const activeSignals = signals.filter(Boolean);
  if (activeSignals.length === 0) {
    return undefined;
  }
  if (activeSignals.length === 1) {
    return activeSignals[0];
  }
  return AbortSignal.any(activeSignals);
}

function queryEntries(query) {
  if (query === undefined) {
    return [];
  }
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    throw new Error("GitHub API query must be an object.");
  }
  const entries = [];
  for (const [key, value] of Object.entries(query)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (typeof entry !== "string") {
        throw new Error(`GitHub API query value for ${key} must be a string.`);
      }
      entries.push([key, entry]);
    }
  }
  return entries;
}

function splitGitHubPath(path, query) {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new Error(`GitHub API path must be relative: ${path}`);
  }
  const url = new URL(path, "https://api.github.com");
  if (url.origin !== "https://api.github.com") {
    throw new Error(`GitHub API path must be relative: ${path}`);
  }
  const entriesByKey = new Map();
  for (const [key, value] of queryEntries(query)) {
    const entries = entriesByKey.get(key) ?? [];
    entries.push(value);
    entriesByKey.set(key, entries);
  }
  for (const [key, values] of entriesByKey) {
    url.searchParams.delete(key);
    for (const value of values) {
      url.searchParams.append(key, value);
    }
  }
  const normalizedQuery = {};
  for (const [key, value] of url.searchParams.entries()) {
    const existing = normalizedQuery[key];
    normalizedQuery[key] =
      existing === undefined ? value : [...(Array.isArray(existing) ? existing : [existing]), value];
  }
  return {
    path: url.pathname,
    query: Object.keys(normalizedQuery).length > 0 ? normalizedQuery : undefined,
  };
}

function formatGitHubQuery(query) {
  const parameters = new URLSearchParams();
  for (const [key, value] of queryEntries(query)) {
    parameters.append(key, value);
  }
  return parameters.toString();
}

export function createGitHubApi(token, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? GITHUB_API_REQUEST_TIMEOUT_MS;
  const retryDelaysMs = options.retryDelaysMs ?? githubApiRetryDelaysMs;
  const responseMaxBodyBytes = options.responseMaxBodyBytes ?? GITHUB_RESPONSE_BODY_MAX_BYTES;
  const maxPages = options.maxPages ?? GITHUB_PAGINATION_MAX_PAGES;
  const readTransport = options.readTransport;
  const baseHeaders = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": options.userAgent,
    "x-github-api-version": "2022-11-28",
  };
  const request = async (path, requestOptions = {}) => {
    const method = (requestOptions.method ?? "GET").toUpperCase();
    const { query, routeHint, ...fetchOptions } = requestOptions;
    const normalized = splitGitHubPath(path, query);
    const useReadTransport =
      method === "GET" && readTransport && isOctopoolReadPath(normalized.path);
    const timeoutController = new AbortController();
    const requestSignal = combineAbortSignals([requestOptions.signal, timeoutController.signal]);
    let timeout;
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        timeoutController.abort();
        reject(timeoutError(path, method, timeoutMs));
      }, timeoutMs);
      timeout.unref?.();
    });
    const operationPromise = (async () => {
      for (let attempt = 0; ; attempt += 1) {
        if (useReadTransport) {
          try {
            return await readTransport.get(normalized.path, {
              query: normalized.query,
              routeHint,
              signal: requestSignal,
            });
          } catch (error) {
            if (
              githubApiRetryStatuses.has(error?.status) &&
              attempt < retryDelaysMs.length
            ) {
              await wait(retryDelaysMs[attempt], undefined, { signal: requestSignal });
              continue;
            }
            throw error;
          }
        }
        const queryString = formatGitHubQuery(normalized.query);
        const response = await fetchImpl(`https://api.github.com${normalized.path}${
          queryString ? `?${queryString}` : ""
        }`, {
          ...fetchOptions,
          signal: requestSignal,
          headers: { ...baseHeaders, ...fetchOptions.headers },
        });
        if (response.status === 204) {
          return null;
        }
        if (!response.ok) {
          if (
            (method === "GET" || method === "HEAD") &&
            githubApiRetryStatuses.has(response.status) &&
            attempt < retryDelaysMs.length
          ) {
            await response.body?.cancel().catch(() => {});
            await wait(retryDelaysMs[attempt], undefined, { signal: requestSignal });
            continue;
          }
          let errorText;
          try {
            errorText = await readBoundedGitHubErrorText(response, GITHUB_ERROR_BODY_MAX_BYTES, {
              signal: timeoutController.signal,
              timeoutPromise,
            });
          } catch (bodyError) {
            errorText = bodyError instanceof Error ? bodyError.message : String(bodyError);
          }
          const error = new Error(`${response.status} ${response.statusText}: ${errorText}`);
          error.status = response.status;
          throw error;
        }
        return await readBoundedGitHubJson(response, responseMaxBodyBytes, {
          signal: timeoutController.signal,
          timeoutPromise,
        });
      }
    })();
    operationPromise.catch(() => {});
    try {
      return await Promise.race([operationPromise, timeoutPromise]);
    } finally {
      clearTimeout(timeout);
    }
  };
  return {
    request,
    paginate: async (path, paginateOptions = {}) => {
      const items = [];
      for (let page = 1; page <= maxPages; page += 1) {
        const pageItems = await request(path, {
          ...paginateOptions,
          query: { ...paginateOptions.query, per_page: "100", page: String(page) },
        });
        if (!Array.isArray(pageItems)) {
          throw new Error(`GitHub API returned a non-array page for ${path}.`);
        }
        items.push(...pageItems);
        if (pageItems.length < 100) {
          return items;
        }
      }
      throw new Error(`GitHub API pagination exceeded ${maxPages} pages for ${path}.`);
    },
  };
}
