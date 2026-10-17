import { Command } from "commander";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { executeRound, validateDirectory } from "./executor.ts";
import { StepModel } from "./model.ts";
import { WorkerError } from "./errors.ts";
import { initializeIdentities } from "./config.ts";
import { communicate } from "./communication.ts";
import { reconcileSubmission, startWorker } from "./runtime.ts";
import { enrollIdentity } from "./enrollment.ts";

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => controller.abort(new Error(signal)));

const program = new Command().name("co-vibe-worker").description("合成业务 CSV 独立执行与验收");
program.option("--config <path>", "忽略目录内的私有环境配置").hook("preAction", () => {
  const file = program.opts().config;
  if (file) process.loadEnvFile(file);
});
program.command("init-identities")
  .requiredOption("--directory <path>", "私有 .local 目录")
  .requiredOption("--model <id>", "从 models 列表选择的文本模型")
  .requiredOption("--service-url <url>", "实际任务服务地址")
  .action(async options => console.log(JSON.stringify(await initializeIdentities(options.directory, options.model, options.serviceUrl), null, 2)));
program.command("start").action(async () => startWorker(controller.signal));
program.command("enroll")
  .requiredOption("--identity-config <path>", "待登记的私有节点配置")
  .requiredOption("--manifest-file <path>", "实际公开角色说明文件")
  .requiredOption("--manifest-uri <uri>", "该文件的实际公开 URI")
  .action(async options => console.log(JSON.stringify(await enrollIdentity(options.identityConfig, options.manifestFile, options.manifestUri, controller.signal), null, 2)));
program.command("reconcile")
  .requiredOption("--task-id <id>", "待确认的实际任务")
  .requiredOption("--attempt <number>", "已保存的 attempt", Number)
  .action(async options => console.log(JSON.stringify(await reconcileSubmission(options.taskId, options.attempt, controller.signal), null, 2)));
program.command("communicate")
  .requiredOption("--run-id <id>", "真实已创建的运行")
  .requiredOption("--task-id <id>", "该运行中真实存在的任务")
  .action(async options => communicate(options.runId, options.taskId, controller.signal));
program.command("models").action(async () => {
  console.log(JSON.stringify(await StepModel.listAvailable(process.env, controller.signal), null, 2));
});
program.command("execute")
  .requiredOption("--input <path>", "实际原始 CSV")
  .requiredOption("--output <path>", "新建输出目录")
  .action(async options => {
    await mkdir(dirname(options.output), { recursive: true });
    console.log(JSON.stringify(await executeRound(options.input, options.output, controller.signal), null, 2));
  });
program.command("validate")
  .requiredOption("--input <path>", "实际原始 CSV")
  .requiredOption("--output <path>", "实际产物目录")
  .action(async options => console.log(JSON.stringify(await validateDirectory(options.input, options.output), null, 2)));

try {
  await program.parseAsync();
} catch (error) {
  if (controller.signal.aborted) {
    console.log(JSON.stringify({ event: "worker_stopped", reason: "signal" }));
    process.exitCode = 130;
  } else {
    const code = error instanceof WorkerError ? error.code : "WORKER_FAILED";
    let message = error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ") : error instanceof Error ? error.message : "Worker 执行失败";
    for (const key of ["STEP_API_KEY", "WORKER_NODE_CREDENTIAL", "WORKER_PRIVATE_KEY"]) {
      if (process.env[key]) message = message.replaceAll(process.env[key]!, "[REDACTED]");
    }
    console.error(JSON.stringify({ code, message }));
    process.exitCode = 1;
  }
}
