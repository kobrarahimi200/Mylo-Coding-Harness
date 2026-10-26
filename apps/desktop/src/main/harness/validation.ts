import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { sandboxOperations } from "./sandbox";

const MAX_OUTPUT_BYTES = 128_000;
const VALIDATION_TIMEOUT_MS = 120_000;

export type ValidationCommand = {
  executable: string;
  args: string[];
  cwd: string;
  label: string;
};

export type ValidationResult = {
  command: ValidationCommand;
  passed: boolean;
  output: string;
  exitCode: number | null;
};

export async function findValidationCommands(cwd: string): Promise<ValidationCommand[]> {
  const commands: ValidationCommand[] = [];
  try {
    const manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    for (const name of ["test", "lint", "typecheck", "check"]) {
      const script = manifest.scripts?.[name];
      if (typeof script !== "string" || !script.trim()) continue;
      if (
        name === "check" &&
        (commands.some((command) => command.args.includes("lint")) ||
          commands.some((command) => command.args.includes("typecheck")))
      )
        continue;
      const args = ["run", name];
      if (name === "test" && /\bvitest\b/.test(script) && !/\brun\b/.test(script))
        args.push("--", "--run");
      commands.push({ executable: "npm", args, cwd, label: `npm ${args.join(" ")}` });
    }
  } catch (error) {
    if (!isMissingFile(error))
      throw new Error(`Unable to inspect workspace validation configuration: ${String(error)}`);
  }
  try {
    await access(join(cwd, "Cargo.toml"));
    commands.push(
      ...["test", "check"].map((name) => ({
        executable: "cargo",
        args: [name],
        cwd,
        label: `cargo ${name}`,
      })),
    );
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  return commands;
}
export async function findValidationCommand(cwd: string): Promise<ValidationCommand | undefined> {
  return (await findValidationCommands(cwd))[0];
}

export async function runValidation(
  command: ValidationCommand,
  operations = sandboxOperations(command.cwd),
  signal?: AbortSignal,
): Promise<ValidationResult> {
  let output = "";
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  let result: { exitCode: number | null };
  try {
    result = await operations.exec(
      [command.executable, ...command.args].map(quote).join(" "),
      command.cwd,
      {
        timeout: VALIDATION_TIMEOUT_MS / 1000,
        ...(signal ? { signal } : {}),
        onData: (chunk) => {
          if (output.length < MAX_OUTPUT_BYTES)
            output += chunk.toString("utf8").slice(0, MAX_OUTPUT_BYTES - output.length);
        },
      },
    );
  } catch (error) {
    result = { exitCode: null };
    output += `\n${error instanceof Error ? error.message : String(error)}`;
  }
  return {
    command,
    passed: result.exitCode === 0,
    exitCode: result.exitCode,
    output: output.trim(),
  };
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
