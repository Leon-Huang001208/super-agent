import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {readHarnessEvents, readHarnessTask} from "./harness-project.mjs";
import {validateCleanedDelivery} from "./iteration-delivery.mjs";

export function enforceHarnessTask({projectRoot, taskId, requireDelivery = false}) {
  const task = readHarnessTask({projectRoot, taskId});
  const events = readHarnessEvents({projectRoot, taskId});
  if (!events.some(event => event.event === "task_started")) throw new Error("missing task_started event");
  const outcome = Array.isArray(task.outcomes) ? task.outcomes.at(-1) : null;
  if (!outcome || outcome.status !== "completed" || outcome.verification?.status !== "passed") {
    throw new Error("latest outcome is not completed/passed");
  }
  if (typeof outcome.verification.command !== "string" || outcome.verification.command.trim().length === 0) {
    throw new Error("missing verification command");
  }
  if (!Number.isInteger(outcome.verificationDurationSeconds) || outcome.verificationDurationSeconds < 0) {
    throw new Error("missing verification duration seconds");
  }
  if (!events.some(event => event.event === "verification_completed" && event.verificationStatus === "passed")) {
    throw new Error("missing passing verification_completed event");
  }
  const result = {
    taskId,
    verificationStatus: outcome.verification.status,
    verificationDurationSeconds: outcome.verificationDurationSeconds
  };
  if (requireDelivery || task.delivery?.required) {
    const receipt = validateCleanedDelivery({projectRoot, taskId});
    Object.assign(result, {
      deliveryStatus: receipt.status,
      ciStatus: receipt.ci.status,
      remote: receipt.remote,
      defaultBranch: receipt.defaultBranch,
      remoteCommit: receipt.remoteCommit
    });
  }
  return result;
}

function parseArgs(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return {help: true};
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--require-delivery") {
      options.requireDelivery = true;
      continue;
    }
    if (argument !== "--project" && argument !== "--task-id") throw new Error(`unknown option: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    options[argument === "--project" ? "project" : "taskId"] = value;
    index += 1;
  }
  if (!options.project || !options.taskId) throw new Error("--project and --task-id are required");
  return options;
}

function usage() {
  return [
    "用法：harness-enforce.mjs --project <项目目录> --task-id <任务 ID> [--require-delivery]",
    "",
    "只读交付硬门：要求自动开始事件、真实 completed/passed 结果和已记录的验证完成事件；可实时核验交付 receipt。"
  ].join("\n");
}

function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(enforceHarnessTask({
    projectRoot: options.project,
    taskId: options.taskId,
    requireDelivery: Boolean(options.requireDelivery)
  }))}\n`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`harness enforce failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
