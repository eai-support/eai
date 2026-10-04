import { resolve } from "node:path";
import { Command } from "commander";
import { findProjectRoot } from "../lib/config.js";
import { buildCliManagedSourceBundle, ManagedSourceError } from "../lib/eai-managed-source.js";
import * as out from "../lib/output.js";

export const SOURCE_VALIDATION_SCHEMA = "eai.cli_managed_source_validation.v1";

/** Uses the publication guard without authentication, receipt writes or provider operations. */
export function createManagedSourceValidateCommand(): Command {
  return new Command("validate")
    .description("Check local app source for EAI-managed publication without publishing")
    .option("--project-dir <path>", "Exact generated-app directory (defaults to the current project)")
    .option("--format <format>", "Output format (text|json)", "text")
    .action(async (options: { projectDir?: string; format: string }) => {
      const base = { schemaVersion: SOURCE_VALIDATION_SCHEMA, sourceMode: "eai-cli-generated" };
      try {
        if (options.format !== "json" && options.format !== "text") {
          throw new ManagedSourceError("FORMAT_INVALID", "Use --format text or --format json.");
        }
        const root = options.projectDir ? resolve(options.projectDir) : await findProjectRoot();
        if (!root) throw new ManagedSourceError("PROJECT_NOT_FOUND", "Run this check inside your generated app or supply --project-dir.");
        const { bundle, totalBytes } = await buildCliManagedSourceBundle(root);
        const result = {
          ...base, status: "passed", templateCommitSha: bundle.templateCommitSha,
          fileCount: bundle.files.length, totalBytes,
        };
        if (options.format === "json") out.json(result);
        else out.success(`Managed source is ready: ${result.fileCount} app files (${totalBytes} bytes).`);
      } catch (error) {
        const failure = error instanceof ManagedSourceError
          ? { code: error.code, message: error.message }
          : { code: "SOURCE_VALIDATION_FAILED", message: "Local source validation could not complete. Check the project and retry." };
        if (options.format === "json") out.json({ ...base, status: "failed", error: failure });
        else out.error(`${failure.code}: ${failure.message}`);
        process.exitCode = 1;
      }
    });
}
