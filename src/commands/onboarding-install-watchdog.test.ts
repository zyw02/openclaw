import { afterEach, describe, expect, it, vi } from "vitest";
import { runWithPausableInstallWatchdog } from "./onboarding-install-watchdog.js";

describe("runWithPausableInstallWatchdog", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("excludes human review time and resumes with the remaining budget", async () => {
    vi.useFakeTimers();
    let startPrompt: (() => void) | undefined;
    let finishPrompt: (() => void) | undefined;
    const promptReady = new Promise<void>((resolve) => {
      startPrompt = resolve;
    });
    const prompt = new Promise<void>((resolve) => {
      finishPrompt = resolve;
    });
    const never = new Promise<never>(() => {});

    const result = runWithPausableInstallWatchdog(async (withHumanPrompt) => {
      await promptReady;
      await withHumanPrompt(async () => await prompt);
      return await never;
    }, 100);

    await vi.advanceTimersByTimeAsync(90);
    startPrompt?.();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    finishPrompt?.();
    await vi.advanceTimersByTimeAsync(9);

    let settled = false;
    void result.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).rejects.toThrow("timeout");
  });

  it("returns work completed while the watchdog is active", async () => {
    await expect(runWithPausableInstallWatchdog(async () => "installed", 100)).resolves.toBe(
      "installed",
    );
  });

  it("remains paused until every overlapping human prompt finishes", async () => {
    vi.useFakeTimers();
    let startPrompts: (() => void) | undefined;
    let finishFirst: (() => void) | undefined;
    let finishSecond: (() => void) | undefined;
    const promptsReady = new Promise<void>((resolve) => {
      startPrompts = resolve;
    });
    const firstPrompt = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const secondPrompt = new Promise<void>((resolve) => {
      finishSecond = resolve;
    });
    const never = new Promise<never>(() => {});

    const result = runWithPausableInstallWatchdog(async (withHumanPrompt) => {
      await promptsReady;
      const first = withHumanPrompt(async () => await firstPrompt);
      const second = withHumanPrompt(async () => await secondPrompt);
      await Promise.all([first, second]);
      return await never;
    }, 100);

    await vi.advanceTimersByTimeAsync(90);
    startPrompts?.();
    await vi.advanceTimersByTimeAsync(0);
    finishFirst?.();
    await vi.advanceTimersByTimeAsync(1_000);

    let settled = false;
    void result.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    finishSecond?.();
    await vi.advanceTimersByTimeAsync(9);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).rejects.toThrow("timeout");
  });
});
