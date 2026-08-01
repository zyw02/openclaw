import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerClawsCli } from "./claws-cli.js";

describe("Claws install policy options", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the existing unsafe-install acknowledgement flag for add and update", () => {
    vi.stubEnv("OPENCLAW_EXPERIMENTAL_CLAWS", "1");
    const program = new Command();
    registerClawsCli(program);
    const claws = program.commands.find((command) => command.name() === "claws");

    for (const name of ["add", "update"]) {
      const command = claws?.commands.find((candidate) => candidate.name() === name);
      expect(command?.options.map((option) => option.long)).toContain(
        "--dangerously-force-unsafe-install",
      );
    }
  });
});
