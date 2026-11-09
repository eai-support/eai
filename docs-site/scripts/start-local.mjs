import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function localAssistantEnvironment(environment = process.env) {
  return {
    ...environment,
    EAI_DOCS_ASSISTANT_API_URL:
      environment.EAI_DOCS_ASSISTANT_API_URL ||
      "http://localhost:3000/api/chat",
  };
}

export function localDocsStartArgs(args = process.argv.slice(2)) {
  const hasPort = args.some(
    (arg) => arg === "-p" || arg === "--port" || arg.startsWith("--port="),
  );
  return hasPort ? ["start", ...args] : ["start", ...args, "--port", "3017"];
}

export function startLocalDocs(args = process.argv.slice(2)) {
  const command =
    process.platform === "win32" ? "docusaurus.cmd" : "docusaurus";
  const child = spawn(command, localDocsStartArgs(args), {
    env: localAssistantEnvironment(),
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  child.on("error", (error) => {
    console.error(`Could not start Docusaurus: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
  return child;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  startLocalDocs();
}
