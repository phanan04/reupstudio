# Làm việc qua GitHub trên hai máy

## Một lần trên mỗi clone

Chạy `npm run git:setup`: đặt `pull.ff=only`, `fetch.prune=true`, `push.default=simple` **chỉ trong repo này**. `.gitattributes` thống nhất LF cho source và CRLF cho `.cmd`. Không cấu hình lại Git global.

## Bắt đầu phiên

1. Đọc `AGENTS.md` và `PROGRESS.md`. Kiểm tra `git status --short --branch`.
2. Nếu có thay đổi chưa commit, hoàn tất/commit hoặc chủ động stash trước; không `reset --hard`, `clean -fdx` hay ép ghi đè để pull.
3. `git fetch --prune`, `git switch <nhánh-công-việc>`, `git pull --ff-only`.
4. Máy đầu tạo nhánh bằng `git switch -c codex/<tên-việc>`. Máy thứ hai tiếp tục **cùng nhánh** bằng `git switch --track origin/codex/<tên-việc>` trong lần đầu, sau đó dùng `git switch` bình thường.
5. Chạy `npm start`. Sau cài lần đầu, launcher xử lý đồng bộ Python theo lockfile nếu có `.venv`. Source Node không có dependency ngoài; khi thêm npm package sau này phải commit cả `package.json`/`package-lock.json` và cập nhật launcher nếu muốn tự `npm ci`.

Không sửa cùng một nhánh đồng thời trên hai máy. Nếu cần làm song song, dùng hai nhánh khác nhau rồi hợp nhất qua PR.

## Kết thúc phiên / chuyển sang máy kia

1. Lưu công việc, chạy `npm run check` và `npm test`; với Python chạy import smoke test bằng Python trong `.venv`.
2. Cập nhật `PROGRESS.md`: đã làm, lệnh kiểm chứng, giới hạn và bước tiếp theo. Không ghi dữ liệu riêng, token, đường dẫn máy.
3. `git diff --check`, `git status --short`, xem `git diff`. Stage **các tệp cụ thể** đã xem; không stage `.env`, `data/`, `models/`, `tools/`, `.venv/`.
4. `git commit -m "Mô tả thay đổi"`, `git push -u origin <nhánh-công-việc>` lần đầu; về sau `git push`.
5. Đợi GitHub Actions của đúng commit thành công. Ghi lại nhánh/commit để máy kia tiếp tục. Chỉ chuyển máy sau khi push xong.

Không dùng force push khi chuyển máy. Nếu pull báo diverged: giữ nguyên working tree, `git fetch`, xem `git log --oneline --graph --all`, đối chiếu thay đổi rồi merge/rebase có chủ đích; giải quyết từng xung đột và chạy test lại. PR/main nên bật yêu cầu CI và review trong GitHub repository settings; cấu hình đó không tự được áp dụng bởi tệp trong repo.

## Dữ liệu mỗi máy

Git đồng bộ source; SQLite/video/model mỗi máy được lưu riêng. Không kỳ vọng dự án vừa tạo trên Windows tự xuất hiện trên Mac sau pull.

Muốn chuyển một snapshot dự án:

1. Kiểm tra `/api/state`; lưu/sửa xong, hủy hoặc đợi tác vụ hoàn thành, ghi lại chế độ đang xử lý (translate/quality/render).
2. Dừng đúng server/launcher trên cả hai máy; không kill toàn bộ Node/Ollama.
3. Sao lưu `data/` của cả hai bên. Sao chép toàn bộ thư mục dữ liệu nguồn vào **thư mục mới** trên máy đích, không trộn từng file với DB đang có. Nếu dùng đường dẫn khác, đặt `VIETSTUDIO_DATA=./<thư-mục-mới>` riêng trong `.env`.
4. Model có thể chuyển riêng; công cụ phải đúng OS, `.venv` phải tạo lại. Không chuyển cookie/khóa API cùng gói source.
5. Nếu đường dẫn cũ không còn hợp lệ, chạy `node scripts/configure-local.mjs` khi server đã dừng. Script backup SQLite trước khi sửa cấu hình. Nếu snapshot sau sự cố còn status chạy/queued: sao lưu trước, mở rồi dừng server để recovery đánh dấu interrupted, sau đó cấu hình đường dẫn; không xóa cues/checkpoint.
6. `npm start`, kiểm tra `/api/state` và `/api/health`, mở SRT ngắn trước, tiếp tục đúng mode. Bản đã duyệt và timestamp phải giữ nguyên.

`data/backups/` của script cấu hình chỉ sao lưu SQLite, **không phải backup video**. Backup đầy đủ phải bao gồm cả thư mục dữ liệu. Lock sau shutdown bình thường được tự xóa; nếu lock lỗi/không đọc được, xác minh PID/server trước khi tự xử lý, không xóa lock đang dùng.

## Dependencies và kiểm chứng

- Node: phiên bản trong `.node-version`, package lock không có dependency ngoài. Không cần compile/bundle app.
- Python: `requirements.lock.txt` khóa phiên bản và marker OS/architecture. Không `pip freeze` toàn bộ máy lên Git. Mac Intel không cài torch native; ONNX Runtime dùng bản có wheel Intel.
- OPUS Docker: `requirements-opus.lock.txt` là bộ phụ thuộc worker, PyTorch CPU từ index chính thức. Giữ các package trùng tên cùng phiên bản với lock native; image tự rebuild theo fingerprint Dockerfile/lock/worker khi chạy OPUS.
- Media binary/model vẫn theo installer hiện có (release discovery + checksum/source marker), chưa phải bộ artifact đóng băng tất cả phiên bản. Chỉ tuyên bố tái lập tool/GPU sau khi kiểm tra trên từng máy.
- Docker build context dùng allowlist, không chứa data/model/.env/keys. Container không lưu DB, không expose app lên mạng.
- CI kiểm chứng giao thức/dữ liệu và import thư viện; không thay cho benchmark GPU, chất lượng dịch, TTS hoặc thử render đầy đủ.
