import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const dir = path.resolve("tools/llama");
fs.writeFileSync(
  path.join(dir, "llama-server.exe.blocked.json"),
  JSON.stringify(
    {
      library: "ggml.dll",
      sha256: createHash("sha256")
        .update(fs.readFileSync(path.join(dir, "ggml.dll")))
        .digest("hex"),
      reason:
        "Windows Code Integrity chặn ggml.dll (0xC0E90002). Ứng dụng đã ngừng gọi bản này để tránh hộp lỗi. Cần bản runtime được quản trị viên cho phép, hoặc kết nối máy chủ AI local đã được cho phép.",
    },
    null,
    2,
  ),
);
console.log(
  "Recorded confirmed Windows Code Integrity block; runtime will not be launched.",
);
