import crypto from "node:crypto";
import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {startHarnessSession} from "./harness-project.mjs";

function generatedTaskId() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `task-${date}-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function parseArgs(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return {help: true};
  const options = {acceptanceCriteria: []};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (["--project", "--host", "--session-id", "--task-id", "--goal", "--acceptance"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      if (argument === "--acceptance") options.acceptanceCriteria.push(value);
      else options[argument.slice(2).replaceAll("-", "_")] = value;
      index += 1;
    } else if (argument === "--start") options.start = true;
    else if (argument === "--new-task") options.newTask = true;
    else if (argument === "--delivery-required") options.deliveryRequired = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  if (!options.start) throw new Error("--start is required");
  if (!options.project || !options.host || !options.session_id) throw new Error("--project, --host and --session-id are required");
  if (!new Set(["claude", "codex"]).has(options.host)) throw new Error("--host must be claude or codex");
  return options;
}

function usage() {
  return [
    "用法：harness-session.mjs --start --project <项目目录> --host claude|codex --session-id <不透明会话 ID> [--new-task] [--task-id <任务 ID>] [--goal <目标>] [--acceptance <验收标准>] [--delivery-required]",
    "",
    "自动创建或恢复指定宿主的项目 Harness 会话。任务目标只保存在任务记录，不会写入事件流。"
  ].join("\n");
}

function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const taskId = options.task_id ?? generatedTaskId();
  const result = startHarnessSession({
    projectRoot: options.project,
    host: options.host,
    sessionId: options.session_id,
    newTask: Boolean(options.newTask),
    task: {
      id: taskId,
      goal: options.goal ?? "受管项目任务",
      acceptanceCriteria: options.acceptanceCriteria.length > 0
        ? options.acceptanceCriteria
        : ["Harness 记录完整且验证结果已写入"],
      deliveryRequired: Boolean(options.deliveryRequired)
    }
  });
  process.stdout.write(`${JSON.stringify({session: {taskId: result.taskId, resumed: result.resumed, host: options.host}})}\n`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`harness session failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
