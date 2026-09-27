import path from "node:path";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { run } from "./core.mjs";

export function opusRuntime(platform = process.platform, arch = process.arch, setting = process.env.VIETSTUDIO_OPUS_RUNTIME || "auto") {
  if (!["auto", "native", "docker"].includes(setting)) throw Error("VIETSTUDIO_OPUS_RUNTIME: auto, native hoặc docker.");
  return setting === "auto" ? (platform === "darwin" && arch === "x64" ? "docker" : "native") : setting;
}

export async function ensureOpusImage(root, signal, log = console.log) {
  const digest = createHash("sha256");
  for (const file of ["docker/opus.Dockerfile", "requirements-opus.lock.txt", "workers/translate_opus.py"])
    digest.update(fs.readFileSync(path.join(root, file)));
  const fingerprint = digest.digest("hex");
  let installed = "";
  try {
    installed = (await run("docker", ["image", "inspect", "--format", '{{index .Config.Labels "vietstudio.opus.build"}}', "vietstudio-opus:local"], { signal, timeout: 15000 })).trim();
  } catch { /* First use, or Docker is not running; the build reports the error. */ }
  if (installed === fingerprint) return;
  log("Đang build OPUS CPU Docker theo lockfile; lần đầu cần mạng và dung lượng cho image.");
  await run("docker", ["build", "--file", path.join(root, "docker/opus.Dockerfile"),
    "--build-arg", `VIETSTUDIO_OPUS_BUILD=${fingerprint}`, "--tag", "vietstudio-opus:local", root],
  { signal, timeout: 30 * 60000, onLine: log });
}

export function opusCommand(c, root, dir, runtime, name) {
  const args = ["--model", c.opusModel, "--input", path.join(dir, "opus-input.json"),
    "--output", path.join(dir, "opus-output.json"), "--threads", String(c.threads)];
  if (runtime === "native") return { bin: c.python, args: [path.join(root, "workers/translate_opus.py"), ...args] };
  const mount = (source, target, readonly = false) => {
    if (source.includes(",")) throw Error("Docker OPUS không hỗ trợ dấu phẩy trong đường dẫn. Dùng thư mục dự án/mô hình không có dấu phẩy.");
    return `type=bind,source=${path.resolve(source)},target=${target}${readonly ? ",readonly" : ""}`;
  };
  return { bin: "docker", args: ["run", "--rm", "--pull=never", "--name", name,
    "--network=none", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--read-only", "--tmpfs", "/tmp",
    ...(process.platform === "linux" && process.getuid ? ["--user", `${process.getuid()}:${process.getgid()}`] : []),
    "--mount", mount(c.opusModel, "/model", true), "--mount", mount(dir, "/job"),
    "vietstudio-opus:local", "--model", "/model", "--input", "/job/opus-input.json",
    "--output", "/job/opus-output.json", "--threads", String(c.threads)] };
}

export async function runOpus(c, root, dir, options) {
  const runtime = opusRuntime(), name = "vietstudio-opus-" + randomUUID();
  const command = opusCommand(c, root, dir, runtime, name);
  try {
    if (runtime === "docker") await ensureOpusImage(root, options.signal, options.onLine);
    return await run(command.bin, command.args, options);
  }
  catch (error) {
    if (runtime === "docker" && !options.signal?.aborted)
      error.message += "\nOPUS Docker: mở Docker Desktop và chạy docker compose build opus (chỉ cần khi cài hoặc cập nhật dependencies).";
    throw error;
  } finally {
    // Killing the Docker CLI alone can leave its container running.
    if (runtime === "docker") await run("docker", ["rm", "--force", name], { timeout: 15000 }).catch(() => {});
  }
}
