// Octopool read client tests cover the direct GET-only GitHub relay contract.
import { describe, expect, it, vi } from "vitest";
import {
  OCTOPOOL_RESPONSE_BODY_MAX_BYTES,
  createOctopoolReadClient,
  createOctopoolReadClientFromEnv,
  isOctopoolReadPath,
} from "../../scripts/github/octopool-read.mjs";

const pullFilesPath = "/repos/openclaw/openclaw/pulls/123/files";
const headSha = "a".repeat(40);

function relayResponse(body: unknown, options: { cache?: string; status?: number } = {}) {
  const status = options.status ?? 200;
  return Response.json({
    status,
    body,
    body_encoding: "json",
    relay: {
      cache: options.cache ?? "hit",
      request_id: "request-1",
      route_kind: "pr_files",
    },
  });
}

describe("Octopool GitHub read client", () => {
  it("sends the documented GET relay envelope without exposing its bearer token", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(relayResponse([{ filename: "a.ts" }]));
    const log = vi.fn();
    const client = createOctopoolReadClient({
      url: "https://octopool.example.test",
      pool: "maintainers",
      token: "relay-token",
      fetchImpl,
      log,
    });

    await expect(
      client.get(pullFilesPath, {
        query: { per_page: "100" },
        routeHint: { pr_head_sha: headSha },
      }),
    ).resolves.toEqual([{ filename: "a.ts" }]);

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://octopool.example.test/v1/github/request"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer relay-token" }),
      }),
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      pool: "maintainers",
      method: "GET",
      path: pullFilesPath,
      query: { per_page: "100" },
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      route_hint: { pr_head_sha: headSha },
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("cache=hit"));
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("relay-token"));
  });

  it("accepts only guard routes and safe relay request shapes", async () => {
    expect(isOctopoolReadPath("/repos/openclaw/openclaw/pulls/123")).toBe(true);
    expect(isOctopoolReadPath("/repos/openclaw/openclaw/issues/123/labels")).toBe(true);
    expect(isOctopoolReadPath("/orgs/openclaw/teams/secops/memberships/user")).toBe(false);

    const client = createOctopoolReadClient({
      url: "https://octopool.example.test",
      pool: "maintainers",
      token: "relay-token",
      fetchImpl: vi.fn<typeof fetch>(),
      log: vi.fn(),
    });
    await expect(client.get("/repos/openclaw/openclaw/pulls/123?per_page=100")).rejects.toThrow(
      "Invalid Octopool GitHub path",
    );
    await expect(client.get("/orgs/openclaw/teams/secops/memberships/user")).rejects.toThrow(
      "Octopool does not allow GitHub route",
    );
    await expect(client.get(pullFilesPath, { query: { token: "nope" } })).rejects.toThrow(
      "Invalid Octopool query key",
    );
    expect(() =>
      createOctopoolReadClient({
        url: "http://octopool.example.test",
        pool: "maintainers",
        token: "relay-token",
      }),
    ).toThrow("OCTOPOOL_URL must use https");
  });

  it("normalizes relay failures and enforces bounded relay responses", async () => {
    const deniedClient = createOctopoolReadClient({
      url: "https://octopool.example.test",
      pool: "maintainers",
      token: "relay-token",
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(relayResponse({ code: "route_denied" }, { status: 424 })),
      log: vi.fn(),
    });
    await expect(deniedClient.get(pullFilesPath)).rejects.toMatchObject({
      message: `Octopool GET ${pullFilesPath} failed with 424.`,
      status: 424,
    });

    const boundedClient = createOctopoolReadClient({
      url: "https://octopool.example.test",
      pool: "maintainers",
      token: "relay-token",
      responseMaxBodyBytes: 64,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("x".repeat(65), { headers: { "content-length": "65" } }),
      ),
      log: vi.fn(),
    });
    await expect(boundedClient.get(pullFilesPath)).rejects.toThrow(
      "Octopool response body exceeded 64 bytes",
    );
    expect(OCTOPOOL_RESPONSE_BODY_MAX_BYTES).toBeGreaterThan(64);
  });

  it("preserves pagination and fails rather than issuing unbounded relay reads", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(relayResponse(Array.from({ length: 100 }, (_, index) => ({ index }))))
      .mockResolvedValueOnce(relayResponse([{ index: 100 }]));
    const client = createOctopoolReadClient({
      url: "https://octopool.example.test",
      pool: "maintainers",
      token: "relay-token",
      fetchImpl,
      log: vi.fn(),
    });

    await expect(
      client.paginate(pullFilesPath, { routeHint: { pr_head_sha: headSha } }),
    ).resolves.toHaveLength(101);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).query).toMatchObject({
      page: "1",
      per_page: "100",
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)).query).toMatchObject({
      page: "2",
      per_page: "100",
    });

    const fullPageClient = createOctopoolReadClient({
      url: "https://octopool.example.test",
      pool: "maintainers",
      token: "relay-token",
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(relayResponse(Array.from({ length: 100 }))),
      log: vi.fn(),
    });
    await expect(fullPageClient.paginate(pullFilesPath, { maxPages: 1 })).rejects.toThrow(
      "Octopool pagination exceeded 1 pages",
    );
  });

  it("requires a complete relay environment when a workflow supplies Octopool variables", () => {
    expect(createOctopoolReadClientFromEnv({})).toBeNull();
    expect(() =>
      createOctopoolReadClientFromEnv({
        OCTOPOOL_URL: "https://octopool.example.test",
        OCTOPOOL_POOL: "maintainers",
        OCTOPOOL_TOKEN: "",
      }),
    ).toThrow("OCTOPOOL_TOKEN is required");
  });
});
