import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {readObservation, runObserved} from "./harness-execution.mjs";

function parseArgs(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return {help: true};
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (["--project", "--task-id", "--verifier-id", "--read-observation", "--timeout-ms"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      options[argument.slice(2).replaceAll("-", "_")] = value;
      index += 1;
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
  }
  if (!options.project || !options.task_id) throw new Error("--project and --task-id are required");
  if (Boolean(options.verifier_id) === Boolean(options.read_observation)) {
    throw new Error("use exactly one of --verifier-id or --read-observation");
  }
  if (options.read_observation && options.timeout_ms !== undefined) throw new Error("--timeout-ms requires --verifier-id");
  if (options.timeout_ms !== undefined && (!/^\d+$/.test(options.timeout_ms) || Number(options.timeout_ms) < 1)) {
    throw new Error("invalid timeout");
  }
  return options;
}

function usage() {
  return [
    "用法：harness-run.mjs --project <项目目录> --task-id <任务 ID> --verifier-id <已登记 ID> [--timeout-ms <毫秒>]",
    "      harness-run.mjs --project <项目目录> --task-id <任务 ID> --read-observation <observation ID>",
    "",
    "只运行 Agent Map 机器清单中已登记的非交互 verifier；不接受任意命令。"
  ].join("\n");
}

async function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const base = {projectRoot: options.project, taskId: options.task_id};
  let result;
  if (options.read_observation) {
    result = readObservation({...base, observationId: options.read_observation});
  } else {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    try {
      result = await runObserved({
        ...base,
        verifierId: options.verifier_id,
        ...(options.timeout_ms ? {timeoutMs: Number(options.timeout_ms)} : {}),
        signal: controller.signal
      });
    } finally {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (options.verifier_id && result.status !== "passed") process.exitCode = 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`harness run failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

