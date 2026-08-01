type HumanPromptRunner = <T>(prompt: () => Promise<T>) => Promise<T>;

/**
 * Runs install work under a watchdog while excluding time spent at human prompts.
 * The install promise is not cancelled on timeout, so callers should keep their
 * underlying installer timeout slightly shorter than this watchdog.
 */
export async function runWithPausableInstallWatchdog<T>(
  run: (withHumanPrompt: HumanPromptRunner) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let remainingMs = timeoutMs;
  let activeSinceMs = Date.now();
  let timer: NodeJS.Timeout | undefined;
  let settled = false;
  let pauseDepth = 0;
  let rejectTimeout: (error: Error) => void = () => undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const stopTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const armTimer = () => {
    if (settled || pauseDepth > 0) {
      return;
    }
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      rejectTimeout(new Error("timeout"));
      return;
    }
    activeSinceMs = Date.now();
    timer = setTimeout(() => rejectTimeout(new Error("timeout")), remainingMs);
  };
  const withHumanPrompt: HumanPromptRunner = async (prompt) => {
    pauseDepth += 1;
    if (pauseDepth === 1) {
      stopTimer();
      remainingMs -= Math.max(0, Date.now() - activeSinceMs);
    }
    try {
      return await prompt();
    } finally {
      pauseDepth -= 1;
      if (pauseDepth === 0) {
        armTimer();
      }
    }
  };

  armTimer();
  try {
    return await Promise.race([run(withHumanPrompt), timeout]);
  } finally {
    settled = true;
    stopTimer();
  }
}
