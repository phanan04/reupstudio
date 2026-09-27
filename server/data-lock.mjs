import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) throw Error("Lock dữ liệu không hợp lệ; kiểm tra server trước khi xóa .server.lock.");
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}

export function assertDataIdle(dir) {
  const file = path.join(dir, ".server.lock");
  if (fs.existsSync(file) && isAlive(JSON.parse(fs.readFileSync(file, "utf8")).pid))
    throw Error("Thư mục dữ liệu đang có server chạy. Dừng đúng server trước khi tiếp tục.");
}

export function lockData(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, ".server.lock"), token = randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token }), { flag: "wx" });
      const release = () => {
        try { if (JSON.parse(fs.readFileSync(file, "utf8")).token === token) fs.unlinkSync(file); }
        catch { /* Already removed or inaccessible; never remove someone else's lock. */ }
      };
      process.once("exit", release);
      return release;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      assertDataIdle(dir);
      try { fs.unlinkSync(file); } catch (e) { if (e.code !== "ENOENT") throw e; }
    }
  }
  throw Error("Không thể khóa thư mục dữ liệu.");
}
