// Direct Octopool transport for the repository's allowlisted GitHub REST reads.
import { readBoundedResponseText } from "../lib/bounded-response.mjs";

export const OCTOPOOL_RESPONSE_BODY_MAX_BYTES = 4 * 1024 * 1024;
export const OCTOPOOL_PAGINATION_MAX_PAGES = 100;

const octopoolRoutePatterns = [
  /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/u,
  /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/files$/u,
  /^\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments$/u,
  /^\/repos\/[^/]+\/[^/]+\/issues\/\d+\/labels$/u,
  /^\/repos\/[^/]+\/[^/]+\/contents\/.+$/u,
  /^\/repos\/[^/]+\/[^/]+\/git\/blobs\/[0-9a-f]+$/iu,
];
const secretLikeQueryKey = /(?:token|secret|password|api[_-]?key)/iu;

function createOctopoolError(message, { relay, status } = {}) {
  const error = new Error(message);
  if (status !== undefined) {
    error.status = status;
  }
  if (relay) {
    error.relay = relay;
  }
  return error;
}

function requireNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required for Octopool GitHub reads.`);
  }
  return value.trim();
}

function normalizeUrl(value) {
  const url = new URL(requireNonEmptyString(value, "OCTOPOOL_URL"));
  if (url.protocol !== "https:") {
    throw new Error("OCTOPOOL_URL must use https.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("OCTOPOOL_URL must not include credentials, a query, or a fragment.");
  }
  return url;
}

function validatePath(path) {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.includes("://") ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    /(?:^|\/)\.{1,2}(?:\/|$)/u.test(path) ||
    /%(?:2e|5c)/iu.test(path)
  ) {
    throw new Error(`Invalid Octopool GitHub path: ${String(path)}`);
  }
  if (!octopoolRoutePatterns.some((pattern) => pattern.test(path))) {
    throw new Error(`Octopool does not allow GitHub route: ${path}`);
  }
  return path;
}

function normalizeQuery(query) {
  if (query === undefined) {
    return undefined;
  }
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    throw new Error("Octopool query must be an object of string values.");
  }
  const normalized = {};
  for (const [key, value] of Object.entries(query)) {
    if (!/^[a-z0-9_.-]+$/iu.test(key) || secretLikeQueryKey.test(key)) {
      throw new Error(`Invalid Octopool query key: ${key}`);
    }
    if (typeof value === "string") {
      normalized[key] = value;
      continue;
    }
    if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      normalized[key] = value;
      continue;
    }
    throw new Error(`Octopool query value for ${key} must be a string or string array.`);
  }
  return normalized;
}

function normalizeRouteHint(routeHint) {
  if (routeHint === undefined) {
    return undefined;
  }
  if (!routeHint || typeof routeHint !== "object" || Array.isArray(routeHint)) {
    throw new Error("Octopool route hint must be an object.");
  }
  const keys = Object.keys(routeHint);
  if (keys.length !== 1 || keys[0] !== "pr_head_sha") {
    throw new Error("Octopool supports only the pr_head_sha route hint.");
  }
  const prHeadSha = routeHint.pr_head_sha;
  if (typeof prHeadSha !== "string" || !/^[a-f0-9]{40}$/iu.test(prHeadSha)) {
    throw new Error("Octopool pr_head_sha route hint must be a 40-character SHA.");
  }
  return { pr_head_sha: prHeadSha };
}

function relayMetadata(envelope) {
  const relay = envelope?.relay;
  if (!relay || typeof relay !== "object") {
    return undefined;
  }
  return {
    cache: typeof relay.cache === "string" ? relay.cache : undefined,
    requestId: typeof relay.request_id === "string" ? relay.request_id : undefined,
    routeKind: typeof relay.route_kind === "string" ? relay.route_kind : undefined,
  };
}

function logRead(log, path, envelope) {
  const metadata = relayMetadata(envelope);
  const details = [
    `status=${envelope.status}`,
    metadata?.routeKind ? `route=${metadata.routeKind}` : null,
    metadata?.cache ? `cache=${metadata.cache}` : null,
    metadata?.requestId ? `request_id=${metadata.requestId}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  log(`Octopool GET ${path} ${details}`);
}

function appendQuery(path, query) {
  const url = new URL(path, "https://api.github.invalid");
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.delete(key);
    for (const entry of Array.isArray(value) ? value : [value]) {
      url.searchParams.append(key, entry);
    }
  }
  return `${url.pathname}${url.search}`;
}

export function isOctopoolReadPath(path) {
  try {
    validatePath(path);
    return true;
  } catch {
    return false;
  }
}

export function createOctopoolReadClient({
  url,
  pool,
  token,
  fetchImpl = fetch,
  log = console.info,
  responseMaxBodyBytes = OCTOPOOL_RESPONSE_BODY_MAX_BYTES,
  maxPages = OCTOPOOL_PAGINATION_MAX_PAGES,
} = {}) {
  const baseUrl = normalizeUrl(url);
  const relayUrl = new URL("/v1/github/request", baseUrl);
  const relayPool = requireNonEmptyString(pool, "OCTOPOOL_POOL");
  const relayToken = requireNonEmptyString(token, "OCTOPOOL_TOKEN");
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new Error("Octopool maxPages must be a positive integer.");
  }

  const get = async (path, { query, routeHint, signal } = {}) => {
    const validatedPath = validatePath(path);
    const response = await fetchImpl(relayUrl, {
      method: "POST",
      signal,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${relayToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        pool: relayPool,
        method: "GET",
        path: validatedPath,
        ...(query === undefined ? {} : { query: normalizeQuery(query) }),
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
        },
        ...(routeHint === undefined ? {} : { route_hint: normalizeRouteHint(routeHint) }),
      }),
    });
    let envelope;
    try {
      envelope = JSON.parse(
        await readBoundedResponseText(response, "Octopool", responseMaxBodyBytes, { signal }),
      );
    } catch (error) {
      if (!response.ok) {
        throw createOctopoolError(`Octopool GET ${validatedPath} failed with ${response.status}.`, {
          status: response.status,
        });
      }
      throw error;
    }
    if (!envelope || typeof envelope !== "object" || !Number.isInteger(envelope.status)) {
      throw createOctopoolError(`Octopool returned an invalid response for ${validatedPath}.`);
    }
    const metadata = relayMetadata(envelope);
    if (!response.ok || envelope.status < 200 || envelope.status >= 300) {
      throw createOctopoolError(
        `Octopool GET ${validatedPath} failed with ${envelope.status}.`,
        { relay: metadata, status: envelope.status },
      );
    }
    if (envelope.body_encoding !== "json") {
      throw createOctopoolError(`Octopool returned non-JSON data for ${validatedPath}.`, {
        relay: metadata,
        status: envelope.status,
      });
    }
    logRead(log, validatedPath, envelope);
    return envelope.body;
  };

  return {
    get,
    paginate: async (path, { query, routeHint, maxPages: pageLimit = maxPages, signal } = {}) => {
      if (!Number.isSafeInteger(pageLimit) || pageLimit < 1) {
        throw new Error("Octopool page limit must be a positive integer.");
      }
      const items = [];
      for (let page = 1; page <= pageLimit; page += 1) {
        const pageItems = await get(path, {
          query: { ...query, page: String(page), per_page: "100" },
          routeHint,
          signal,
        });
        if (!Array.isArray(pageItems)) {
          throw createOctopoolError(`Octopool returned a non-array page for ${path}.`);
        }
        items.push(...pageItems);
        if (pageItems.length < 100) {
          return items;
        }
      }
      throw new Error(
        `Octopool pagination exceeded ${pageLimit} pages for ${appendQuery(path, query)}.`,
      );
    },
  };
}

export function createOctopoolReadClientFromEnv(environment = process.env, options = {}) {
  const values = [environment.OCTOPOOL_URL, environment.OCTOPOOL_POOL, environment.OCTOPOOL_TOKEN];
  if (values.every((value) => value === undefined)) {
    return null;
  }
  return createOctopoolReadClient({
    url: environment.OCTOPOOL_URL,
    pool: environment.OCTOPOOL_POOL,
    token: environment.OCTOPOOL_TOKEN,
    ...options,
  });
}
