import { expectDefined } from "@openclaw/normalization-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyUninstall: vi.fn(),
  clawReferenceWarnings: vi.fn(),
  commitRecords: vi.fn(),
  installRecords: vi.fn(),
  metadata: vi.fn(),
  planUninstall: vi.fn(),
  readConfig: vi.fn(),
  refreshRegistry: vi.fn(),
  replaceConfig: vi.fn(),
}));

vi.mock("../config/config.js", () => ({
  assertConfigWriteAllowedInCurrentMode: () => undefined,
  readConfigFileSnapshotForWrite: () => mocks.readConfig(),
  replaceConfigFile: (params: unknown) => mocks.replaceConfig(params),
}));
vi.mock("./plugin-metadata-snapshot.js", () => ({
  loadPluginMetadataSnapshot: (...args: unknown[]) => mocks.metadata(...args),
  resolvePluginMetadataSnapshot: (...args: unknown[]) => mocks.metadata(...args),
}));
vi.mock("./installed-plugin-index-records.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./installed-plugin-index-records.js")>()),
  loadInstalledPluginIndexInstallRecords: (...args: unknown[]) => mocks.installRecords(...args),
}));
vi.mock("./uninstall.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./uninstall.js")>()),
  applyPluginUninstallDirectoryRemoval: (...args: unknown[]) => mocks.applyUninstall(...args),
  planPluginUninstall: (...args: unknown[]) => mocks.planUninstall(...args),
}));
vi.mock("./install-record-commit.js", () => ({
  commitPluginInstallRecordsWithConfig: (...args: unknown[]) => mocks.commitRecords(...args),
}));
vi.mock("./uninstall-claw-references.js", () => ({
  collectClawPluginUninstallWarnings: (...args: unknown[]) => mocks.clawReferenceWarnings(...args),
}));
vi.mock("./registry-refresh.js", () => ({
  refreshPluginRegistryAfterConfigMutation: (...args: unknown[]) => mocks.refreshRegistry(...args),
}));

const { listManagedPlugins, uninstallManagedPlugin } = await import("./management-service.js");

function configSnapshot(config: Record<string, unknown> = {}) {
  return {
    snapshot: {
      valid: true,
      parsed: {},
      path: "/tmp/openclaw.json",
      sourceConfig: config,
      hash: "base-hash",
    },
    writeOptions: {
      expectedConfigPath: "/tmp/openclaw.json",
      includeFileHashesForWrite: { "/tmp/plugins.json": "include-hash" },
      includeFileTargetsForWrite: { "/tmp/plugins.json": "/tmp/plugins.json" },
    },
  };
}

function metadataSnapshot(params: {
  enabled: boolean;
  id?: string;
  name?: string;
  origin?: "bundled" | "global";
  installRecord?: Record<string, unknown>;
}) {
  const id = params.id ?? "workboard";
  const manifest = {
    id,
    name: params.name ?? "Workboard",
    channels: [],
    providers: [],
    cliBackends: [],
    skills: [],
    hooks: [],
    origin: params.origin ?? "bundled",
    rootDir: `/tmp/${id}`,
    source: `/tmp/${id}/index.ts`,
    manifestPath: `/tmp/${id}/openclaw.plugin.json`,
  };
  return {
    index: {
      plugins: [
        {
          pluginId: id,
          packageName: `@openclaw/${id}`,
          origin: params.origin ?? "bundled",
          enabled: params.enabled,
        },
      ],
      installRecords: params.installRecord ? { [id]: params.installRecord } : {},
    },
    byPluginId: new Map([[id, manifest]]),
    plugins: [manifest],
    diagnostics: [],
    normalizePluginId: (pluginId: string) => pluginId,
  };
}

function emptyMetadataSnapshot() {
  return {
    index: { plugins: [], installRecords: {} },
    byPluginId: new Map(),
    plugins: [],
    diagnostics: [],
    normalizePluginId: (pluginId: string) => pluginId,
  };
}

describe("plugin management uninstall", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
    mocks.replaceConfig.mockResolvedValue(undefined);
    mocks.refreshRegistry.mockResolvedValue(undefined);
  });

  it("marks external installs removable and bundled plugins non-removable", async () => {
    mocks.metadata.mockReturnValue(
      metadataSnapshot({
        enabled: true,
        id: "diffs",
        name: "Diffs",
        origin: "global",
        installRecord: { source: "clawhub", installPath: "/tmp/extensions/diffs" },
      }),
    );
    const external = await listManagedPlugins({
      config: {},
      env: {},
      officialCatalog: { entries: [] },
    });
    expect(external.plugins[0]).toMatchObject({ id: "diffs", removable: true });

    mocks.metadata.mockReturnValue(metadataSnapshot({ enabled: false }));
    const bundled = await listManagedPlugins({
      config: {},
      env: {},
      officialCatalog: { entries: [] },
    });
    expect(bundled.plugins[0]).toMatchObject({ id: "workboard", removable: false });
  });

  it("uninstalls an external plugin through commit, file removal, and registry refresh", async () => {
    const installRecord = {
      source: "clawhub",
      spec: "clawhub:@openclaw/diffs",
      installPath: "/tmp/extensions/diffs",
    };
    const prepared = configSnapshot({ plugins: { entries: { diffs: { enabled: true } } } });
    mocks.readConfig.mockResolvedValue(prepared);
    mocks.installRecords.mockResolvedValue({ diffs: installRecord });
    mocks.metadata.mockReturnValue(
      metadataSnapshot({
        enabled: true,
        id: "diffs",
        name: "Diffs",
        origin: "global",
        installRecord,
      }),
    );
    mocks.planUninstall.mockReturnValue({
      ok: true,
      config: { plugins: { installs: { diffs: installRecord } } },
      pluginId: "diffs",
      actions: {
        entry: true,
        install: true,
        allowlist: false,
        denylist: false,
        loadPath: false,
        memorySlot: false,
        contextEngineSlot: false,
        channelConfig: false,
        directory: false,
      },
      directoryRemoval: { target: "/tmp/extensions/diffs" },
    });
    mocks.commitRecords.mockResolvedValue(undefined);
    mocks.applyUninstall.mockResolvedValue({ directoryRemoved: true, warnings: [] });
    mocks.clawReferenceWarnings.mockReturnValue([
      'Warning: plugin "diffs" is referenced by Claw: @acme/review.',
    ]);

    const result = await uninstallManagedPlugin({ pluginId: "diffs", env: {} });

    expect(mocks.planUninstall).toHaveBeenCalledWith(
      expect.objectContaining({ pluginId: "diffs", deleteFiles: true }),
    );
    expect(mocks.commitRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        previousInstallRecords: { diffs: installRecord },
        nextInstallRecords: {},
        baseHash: "base-hash",
        writeOptions: expect.objectContaining(prepared.writeOptions),
      }),
    );
    expect(
      expectDefined(
        mocks.commitRecords.mock.calls[0],
        "mocks.commitRecords.mock.calls[0] test invariant",
      )[0].nextConfig.plugins?.installs,
    ).toBeUndefined();
    expect(mocks.applyUninstall).toHaveBeenCalledWith({ target: "/tmp/extensions/diffs" });
    expect(result).toMatchObject({
      pluginId: "diffs",
      removed: ["config entry", "install record", "directory"],
      warnings: ['Warning: plugin "diffs" is referenced by Claw: @acme/review.'],
    });
  });

  it("refuses to uninstall bundled plugins", async () => {
    mocks.readConfig.mockResolvedValue(configSnapshot());
    mocks.installRecords.mockResolvedValue({});
    mocks.metadata.mockReturnValue(metadataSnapshot({ enabled: false }));

    await expect(uninstallManagedPlugin({ pluginId: "workboard", env: {} })).rejects.toThrow(
      "bundled plugin cannot be uninstalled",
    );
    expect([mocks.commitRecords.mock.calls, mocks.applyUninstall.mock.calls]).toEqual([[], []]);
  });

  it("surfaces uninstall plan failures as lifecycle errors", async () => {
    mocks.readConfig.mockResolvedValue(configSnapshot());
    mocks.installRecords.mockResolvedValue({});
    mocks.metadata.mockReturnValue(emptyMetadataSnapshot());
    mocks.planUninstall.mockReturnValue({ ok: false, error: "Plugin not found: ghost" });

    await expect(uninstallManagedPlugin({ pluginId: "ghost", env: {} })).rejects.toThrow(
      "Plugin not found: ghost",
    );
    expect(mocks.commitRecords).not.toHaveBeenCalled();
  });
});
