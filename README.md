# Việt Studio — Windows và macOS

Xưởng Việt hóa video Trung–Việt local: video/SRT → dịch → duyệt/chỉnh sửa → xuất SRT/MP4. Giữ nguyên frontend HTML/CSS/JS một khung, HTTP server Node.js 24, SQLite, pipeline tuần tự và các worker Python 3.12. Không có bước build frontend, Redis hoặc database server cần vận hành.

## Khởi động hằng ngày

Sau khi cài lần đầu trên mỗi máy, cập nhật đúng nhánh khi working tree sạch:

```sh
git pull --ff-only
npm start
```

`npm start` là **một lệnh khởi động cho cả Windows/macOS**. Mở [Việt Studio](http://127.0.0.1:8765). Windows vẫn dùng được `Start.cmd`. Dừng bằng Ctrl+C để giải phóng server và runtime do launcher sở hữu.

Launcher đọc `.env`, giữ cấu hình/dữ liệu hiện có, đồng bộ Python nếu `.venv` đã tồn tại và lockfile thay đổi, rồi thử mở Ollama local nếu chưa chạy. Không tự tải model hoặc chạy lại setup ở mỗi lần mở. Nếu Ollama chưa cài, trình biên tập vẫn mở được; dịch cần runtime/model tương ứng. `npm run start:server` chỉ mở HTTP server, dành cho kiểm thử/vận hành thủ công.

## Cài lần đầu trên mỗi máy

1. Cài Git, Node.js **24.19.0** (kèm npm), Python **3.12**. Phiên bản dùng chung nằm trong `.node-version` và `.python-version`. Node server không có npm dependency bên ngoài; `package-lock.json` được commit để `npm ci` tái lập.
2. Clone repo, chọn cùng nhánh công việc rồi chạy:

   ```sh
   npm ci
   npm run git:setup
   ```

3. Có thể sao chép `.env.example` thành `.env` bằng trình quản lý tệp. Không bắt buộc: mặc định lưu ở `./data`, cổng `8765`. `.env` chỉ ở máy đó, không commit.
4. Chỉ cần biên tập SRT và dịch Ollama: cài Ollama chính thức, chạy `npm start`, sau đó ở terminal khác chạy `ollama pull qwen3:4b-instruct` một lần. Khi launcher tự mở Ollama, model nằm tại `./models/ollama`. Nếu Ollama đã chạy như ứng dụng/dịch vụ, model và cấu hình của dịch vụ đó được giữ nguyên. Chọn Ollama và kiểm tra model trong **Cấu hình máy**.
5. Cần đầy đủ tải video/OCR/TTS/Whisper/OPUS: cài công cụ native bên dưới, rồi chạy `npm run setup`. Setup tạo `.venv` mới trên chính máy đó, cài lockfile, tải model giọng/Whisper/GGUF/OPUS. Cần mạng và nhiều GB dung lượng; không chạy lại để sửa UI.

### Windows x64

Cài Node/Python 3.12 vào PATH. `Setup.cmd` tương đương `npm run setup`; setup tải FFmpeg, Whisper CPU và llama.cpp Vulkan bản Windows như trước. Ollama cài riêng từ nhà phát hành hoặc dùng portable trong `tools/ollama-local`. Không bỏ chặn DLL bằng cách tắt bảo mật Windows.

Nếu `python` không trỏ Python 3.12, đặt `PYTHON` riêng trong `.env` hoặc truyền executable qua `node scripts/setup.mjs <python-executable>`. Không commit đường dẫn máy.

### macOS Intel và Apple Silicon

Có Homebrew thì cài công cụ native:

```sh
brew install python@3.12 ffmpeg whisper.cpp
```

Đặt `PYTHON=python3.12` trong `.env` khi máy có nhiều Python, rồi chạy `npm run setup`. Cài thêm `brew install llama.cpp` nếu muốn dùng GGUF thay Ollama. Setup trên macOS **chỉ tải model dùng chung**, không tải/chạy `.exe`. Không sao chép `.venv` hoặc tool Windows sang Mac.

Mac Intel dùng ONNX Runtime 1.23.2 cho OCR/TTS; OPUS dùng Docker CPU vì PyTorch mới không phát hành wheel macOS Intel. Cài và mở Docker Desktop nếu sử dụng OPUS. Mac Apple Silicon và Windows mặc định dùng OPUS native. Đây là lựa chọn tương thích dependency, không phải chứng nhận GPU đã chạy.

## Docker dùng ở đâu?

| Thành phần | Cách chạy | Lý do |
|---|---|---|
| HTTP server + frontend + SQLite | Native | Nhẹ, không cần build; giữ localhost và lưu trữ hiện tại |
| FFmpeg, Whisper, Ollama/llama.cpp | Native | Dùng tool/GPU theo OS, tránh lớp VM làm mất backend GPU |
| Python OCR/TTS | Native `.venv` | Các wheel tương thích theo nền tảng |
| OPUS trên Mac Intel | Container CPU tùy chọn | Giữ PyTorch hiện đại và cùng worker, không hạ phiên bản PyTorch |
| Kiểm thử Node sạch | Container tùy chọn | Kiểm tra source/lockfile trên Linux |

OPUS dùng cùng mã worker và checkpoint. Khi chạy lần đầu hoặc source/lockfile/image đổi, ứng dụng tự build image `vietstudio-opus:local` (cần mạng); sau đó container suy luận **không có mạng**, chỉ mount thư mục model dạng chỉ đọc và thư mục của tác vụ để lưu checkpoint. Dữ liệu không nằm trong filesystem tạm của container. Hủy tác vụ dọn đúng container của tác vụ đó. Có thể build trước hoặc chạy kiểm thử sạch:

```sh
docker compose build opus
docker compose build test
```

`VIETSTUDIO_OPUS_RUNTIME=auto|native|docker` trong `.env` chọn cơ chế. Compose không thay thế `npm start`, không mở HTTP port và không tạo database thứ hai. Không cần chạy `docker compose up` hằng ngày. Image build thủ công được ứng dụng kiểm tra/build lại một lần để gắn fingerprint nguồn.

## Dữ liệu và cấu hình

- `data/studio.sqlite` + WAL, các thư mục tập, video, checkpoint và bản xuất ở `data/`. Tồn tại qua restart, pull và đổi nhánh; không được Git/Docker build context thu thập.
- Mỗi máy có DB **độc lập**. GitHub đồng bộ mã nguồn, lockfile, `.env.example` và tài liệu; không tự đồng bộ video/dữ liệu/bản dịch.
- `.env` chọn cổng, thư mục dữ liệu và runtime; cấu hình biên tập/AI vẫn nằm trong SQLite và quản lý qua UI. `.env` không chứa cờ tự bật API cloud; khóa chỉ đọc từ môi trường khi người dùng opt-in.
- Đường dẫn mặc định trong cấu hình là tương đối với thư mục repo. Trước gọi subprocess, ứng dụng resolve sang đường dẫn của máy hiện tại, kể cả khi worker chạy trong thư mục tập. Tên lệnh đơn dùng PATH hoặc portable tool đã phát hiện.
- DB cũ được giữ nguyên, không tự ghi đè lựa chọn bộ dịch. Nếu DB chuyển từ máy khác có đường dẫn cũ: dừng server rồi chạy `node scripts/configure-local.mjs`; script sao lưu DB trước khi đặt lại **đường dẫn tool/model**, giữ nội dung và thiết lập dịch.
- Không mở hai server trên cùng DB, kể cả khác cổng. Lock `.server.lock` chặn việc constructor đánh dấu nhầm tác vụ đang chạy thành gián đoạn. Một server cũ từ trước thay đổi này chưa tạo lock: phải dừng nó trước khi cập nhật.
- Sao lưu/chuyển `data/` khi đã dừng server trên cả hai máy; sao chép toàn thư mục gồm WAL nếu còn. Không merge SQLite bằng Git, không đặt DB sống trong thư mục đồng bộ cloud. Chi tiết ở [quy trình phát triển](docs/DEVELOPMENT.md).

## Kiểm chứng và phát triển

```sh
npm run check
npm test
```

`check` kiểm tra cú pháp mọi JS hiện hành; `test` tự tìm test bằng Node, không phụ thuộc shell glob Windows. Test dùng DB tạm, không mở `Store` trên DB người dùng. Kiểm tra Python sau setup: chạy Python trong `.venv` với `scripts/check-python.py`.

GitHub Actions đã được cấu hình cho Node trên Windows, macOS Intel, macOS ARM và Linux; Python imports trên Windows/macOS; Docker build + worker `--help` trên Linux. Workflow chỉ chạy khi được push lên GitHub, không đồng nghĩa đã đạt CI. Kiểm thử codec/GPU/model thật vẫn cần từng máy.

Xem [AGENTS.md](AGENTS.md), [PROGRESS.md](PROGRESS.md), [kiến trúc](ARCHITECTURE.md), [dịch ngữ cảnh](TRANSLATION.md), [hướng dẫn sử dụng](docs/USER-GUIDE.md) và [Git/chuyển máy](docs/DEVELOPMENT.md).

Nguồn native: [Whisper Homebrew](https://formulae.brew.sh/formula/whisper.cpp), [llama.cpp Homebrew](https://formulae.brew.sh/formula/llama.cpp), [FFmpeg Homebrew](https://formulae.brew.sh/formula/ffmpeg), [giới hạn PyTorch Mac Intel](https://discuss.pytorch.org/t/why-no-macosx-x86-64-build-after-torch-2-2-2-cp39-none-macosx-10-9-x86_64.whl/204546). Giấy phép công cụ/model nằm trong [hướng dẫn sử dụng](docs/USER-GUIDE.md#nguồn-và-giấy-phép).
