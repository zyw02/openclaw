export const OCTOPOOL_RESPONSE_BODY_MAX_BYTES: number;
export const OCTOPOOL_PAGINATION_MAX_PAGES: number;

type Query = Record<string, string | string[]>;
type RouteHint = { pr_head_sha: string };

export function isOctopoolReadPath(path: string): boolean;
export function createOctopoolReadClient(options: {
  url: string;
  pool: string;
  token: string;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  responseMaxBodyBytes?: number;
  maxPages?: number;
}): {
  get(path: string, options?: { query?: Query; routeHint?: RouteHint; signal?: AbortSignal }): Promise<unknown>;
  paginate(
    path: string,
    options?: { query?: Query; routeHint?: RouteHint; maxPages?: number; signal?: AbortSignal },
  ): Promise<unknown[]>;
};
export function createOctopoolReadClientFromEnv(
  environment?: NodeJS.ProcessEnv,
  options?: {
    fetchImpl?: typeof fetch;
    log?: (message: string) => void;
    responseMaxBodyBytes?: number;
    maxPages?: number;
  },
): ReturnType<typeof createOctopoolReadClient> | null;
