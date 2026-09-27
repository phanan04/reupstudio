# Bàn giao Việt Studio

## Pipeline tăng dần — 2026-09-28

Nhánh làm việc: `codex/streaming-pipeline`, dựa trên cấu hình đa nền tảng. Kiểm tra Git để xác nhận commit/push thực tế.

### Đã triển khai
- Giữ kiến trúc native HTTP/SQLite/frontend hiện có. Upload tự đọc/cache metadata; Whisper CPU nhận diện từng cửa sổ có checkpoint; producer ASR và bộ dịch theo thứ tự có thể chồng thời gian, tối đa một đoạn chờ. Giảm về tuần tự khi tài nguyên hạn chế.
- Silero VAD tùy khả năng CLI/model; fallback chia theo khoảng lặng. ID và timestamp tuyệt đối của đoạn được giữ khi resume; chỉ thử lại đoạn ASR thất bại, bảo toàn các đoạn đã commit.
- Dịch giữ provider session, tri thức/TM/ngữ cảnh; gộp theo ID/snapshot để không mất câu mới hoặc đè bản sửa. PATCH từng câu có kiểm tra xung đột sau khi đọc request body. Bảo vệ ID ổn định khi thêm/xóa câu.
- Pause/resume giữ jobMode; checkpoint còn trên SQLite khi restart. Thêm số đo từng công đoạn và ETA sau đủ mẫu; FFmpeg xuất có progress thực. Chỉ xuất video khi người dùng chọn xuất, không render ngay sau dịch.
- Timeline và phụ đề cập nhật dần; chỉnh nội dung/thời gian trong lúc ASR/dịch, khóa khi render. Kiểu font/cỡ/màu dùng cho preview/ASS; SRT không chứa style. Nút đóng bảng thuộc tính trên màn hình hẹp.
- QA cảnh báo lặp nguồn/chồng thời gian/câu dài. Retry lỗi dịch chỉ tác động câu lỗi chưa sửa tay/chưa duyệt, không tự áp dụng đề xuất AI. Chặn xuất khi ASR chưa hoàn tất.
- Khắc phục options cũ thiếu font defaults, OPUS cache được gộp vào store, kiểm tra ID OPUS, chờ tác vụ probe/worker khi shutdown để tránh ghi DB đã đóng.

### Kiểm chứng
- **37 test đã kiểm chứng** với DB riêng (36/36 toàn bộ, sau đó 10/10 nhóm streaming gồm test OPUS cache mới): checkpoint lỗi/resume, gộp khi người dùng sửa đồng thời, ID, scheduler giới hạn, tài nguyên, ETA, API PATCH/xung đột, legacy options và chặn render thiếu ASR; các test cũ vẫn đạt.
- UI fixture 40 câu/provider giả lập: sửa khi dịch, pause tại 12/40 rồi resume hoàn tất; bản sửa vẫn còn. Font Verdana/cỡ 54 lưu được. Desktop 1366×768 và hẹp 760×800 không tràn toàn trang; nút đóng thuộc tính hoạt động. Không dùng DB/video thật.
- FFmpeg 7.1 thật trên macOS Intel: video tổng hợp 95 giây → ba cửa sổ PCM, ranh giới 39/79/95 giây, tổng cắt 337 ms. Đây không phải benchmark ASR/LLM.
- Scheduler giả lập 12 đoạn (40 ms ASR/60 ms dịch): chờ toàn bộ có câu đầu 550 ms/tổng 1218 ms; overlap 101 ms/800 ms. Không dùng số này để quảng cáo tốc độ model.
- Kiểm tra cú pháp JavaScript, parse Python và `git diff --check` đạt.
- Chi tiết cách chạy/giới hạn: `docs/STREAMING-PIPELINE.md`; benchmark scripts không tải model hoặc dùng dữ liệu người dùng.

### Chưa kiểm chứng và việc tiếp theo
- Chưa chạy Whisper/LLM thật trên video tiếng Trung hoặc xác minh GPU AMD; chưa chạy Windows/Mac ARM trong phiên này. Không chứng nhận chất lượng ngôn ngữ/timestamp từ test giả lập.
- Whisper CLI nạp model mỗi cửa sổ; cần benchmark thời gian nạp và chất lượng ranh giới trước khi chọn persistent worker. OCR vẫn xử lý theo luồng cũ; render bị ngắt phải chạy lại.
- Chưa có forced alignment/diarization; nhận diện câu bị bỏ sót và semantic QA vẫn có false positive/false negative. Đoạn ASR trống có cảnh báo cần nghe lại; không tự tuyên bố không có lời nói.
- Dùng SRT/video mẫu được phép trên từng máy để đánh giá tốc độ và chất lượng thực trước vận hành dài; giữ checkpoint/dữ liệu cũ, không reset DB để thử.

## Cập nhật đa nền tảng — 2026-09-27

Repository: https://github.com/phanan04/reupstudio. Nhánh triển khai: `codex/cross-platform-runtime`. Đọc phần này trước lịch sử laptop bên dưới. Kiểm tra `git status`/remote để biết thay đổi đã commit/push, không suy ra trạng thái Git từ tài liệu.

### Đã làm
- Giữ HTTP Node 24 + SQLite, frontend thuần và pipeline video/SRT/dịch/duyệt/xuất; không thay kiến trúc hoặc sửa dữ liệu người dùng.
- `npm start` dùng launcher chung Windows/macOS; đọc .env, kiểm tra cổng/dữ liệu trước khi mở Store, đọc DB cấu hình dạng read-only và tái sử dụng Ollama đang chạy. Chỉ dọn Ollama do launcher tạo.
- `server/runtime.mjs`: đường dẫn tương đối theo repo root, tìm portable tools hoặc PATH, resolve trước subprocess kể cả cwd trong thư mục tập. DB cũ không bị tự ghi đè; configure-local chủ động backup SQLite rồi cập nhật đường dẫn, giữ bộ dịch/cues/cấu hình khác.
- `.server.lock` bảo vệ một DB khỏi hai server, kể cả khác cổng. Dữ liệu trên mỗi máy vẫn ở `data/`, bền vững qua restart/Git pull. Không đồng bộ DB bằng Git.
- Setup Python 3.12 theo OS, không tải .exe trên Mac; startup sync dependencies theo fingerprint nếu venv đã có. Thêm version files, package-lock, .env.example, .gitattributes và ignore database/secrets/artifacts.
- Mac Intel dùng ONNX Runtime 1.23.2 (1.30.0 không có wheel Intel); loại bỏ cài chồng hai gói cv2. Không downgrade PyTorch: OPUS Mac Intel dùng Docker CPU, OCR/TTS vẫn native. Windows/Apple Silicon mặc định OPUS native.
- Dockerfile OPUS, Dockerfile kiểm thử và Compose tùy chọn. OPUS tự build theo fingerprint source/lock/worker; suy luận network=none, model read-only, checkpoint ghi vào thư mục job trên host, dọn đúng container khi kết thúc/hủy. Docker không chứa HTTP server/DB hoặc dữ liệu riêng.
- README, AGENTS, ARCHITECTURE, TRANSLATION được cập nhật; hướng dẫn Git/chuyển data và hướng dẫn sử dụng ở docs/. Git local đã đặt pull.ff=only, fetch.prune=true, push.default=simple trên clone hiện tại; clone khác chạy npm run git:setup.
- CI: Node Windows/macOS Intel/macOS ARM/Linux, Python imports Windows/macOS, build Docker và OPUS --help trên Linux. Chưa coi workflow có trong source là CI đã chạy.

### Kiểm chứng tại phiên này
- Máy thực: macOS Intel, RAM 16 GB, Radeon RX 5600 XT 6 GB theo system profiler. Không suy ra GPU backend đã hoạt động.
- Node 24.19.0 dùng runtime có sẵn của môi trường phát triển; npm CLI dùng bản kiểm thử trong thư mục tạm. Máy chưa có node/npm trên PATH hệ thống.
- `npm ci --ignore-scripts` thành công; `npm run check` thành công; toàn bộ **27/27 test đạt**, gồm test migration backup/giữ dữ liệu. Lần xác nhận cuối dùng node scripts/test.mjs trực tiếp vì npm CLI tạm đã được dọn.
- Test API/launcher dùng DB riêng: đọc .env, chạy từ cwd khác, dữ liệu còn nguyên sau restart, từ chối startup trùng; relative paths/OPUS mount và backup cấu hình có kiểm thử.
- Python 3.12: resolve lock thành công; cài trong venv tạm, pip check không có lỗi; import Piper/RapidOCR/ONNX/OpenCV/yt-dlp thành công. Không tạo/copy venv vào dự án người dùng, không tải model/video lớn.
- Metadata PyPI xác nhận wheel Python 3.12 của torch 2.8.0, ONNX Runtime 1.30.0 và OpenCV cho Windows x64/Mac ARM; đây không thay thế test chạy thật.
- YAML Compose/CI parse được; Start.command kiểm tra shell syntax; git diff --check sạch.

### Chưa kiểm chứng / bước tiếp theo
- Đã đăng nhập GitHub qua luồng thiết bị và push commit triển khai `718d612` lên `origin/codex/cross-platform-runtime`; nhánh local đã theo dõi nhánh remote. `main` chưa thay đổi. Máy thứ hai fetch rồi checkout đúng nhánh này; CI cần kiểm tra trên commit mới nhất. GitHub CLI native ở tools/github-cli (gitignored); thông tin đăng nhập lưu trong keyring, không nằm trong source.
- Máy hiện chưa có Docker CLI/Desktop: chưa build/run container thật. CI chưa được xác nhận chạy; Windows và Mac ARM chưa có kiểm chứng runtime trong phiên này.
- Chưa benchmark AMD/Vulkan/Metal/AMF, chưa render hoặc suy luận model thật trên máy hiện tại. Import Python thành công không chứng nhận chất lượng OCR/TTS/OPUS.
- Cài Node 24 (kèm npm) trên PATH và công cụ native/model theo README trên từng máy. Sau cài lần đầu: git pull --ff-only, rồi npm start.
- Nếu cần OPUS trên Mac Intel: cài/mở Docker Desktop; image build tự động lần đầu. Kiểm tra suy luận SRT ngắn và cancellation với checkpoint trên máy có Docker trước xử lý dài.
- Kiểm tra GitHub Actions trên đúng commit đã push, rồi thử SRT ngắn và pipeline video trên Windows. Không chuyển hoặc thay DB thật để thử phá hủy.
- Media tools/models vẫn dùng installer release discovery + checksum/source marker như trước; chưa khóa toàn bộ binary theo một manifest duy nhất.

## Lịch sử bàn giao Windows (giữ để tham khảo)

Bản bàn giao trước nâng cấp đa nền tảng, ngày 2026-09-27; mô tả máy Windows cũ.

## Mục tiêu và ưu tiên đã thống nhất
Ứng dụng local Windows Việt hóa video Trung–Việt. Ưu tiên video tải lên và luồng CapCut xuất SRT → nhập SRT → dịch → duyệt/chỉnh sửa → xuất SRT. Giao diện một khung như trình biên tập video. Phần cứng đích RX 5600 XT 6 GB; máy phát triển laptop Intel Iris Xe, không phải máy AMD.

## Đã triển khai
- Video upload, nhập URL Bilibili/Douyin qua yt-dlp; trích xuất phụ đề, Whisper/OCR, TTS, FFmpeg render và xuất SRT/MP4. Khả năng tải URL phụ thuộc nguồn/cookie, không coi mọi URL đều đã kiểm chứng.
- Giao diện viewer, danh sách phụ đề, chỉnh câu, timeline, quản lý tiến độ series trong một khung.
- Nhập SRT/VTT độc lập không cần video; chỉnh tiếng Trung/Việt; xuất giữ timestamp tới mili giây; chặn xuất khi thiếu bản dịch.
- Dịch ngữ cảnh bằng Ollama/Qwen, tùy chọn llama.cpp, OPUS CPU hoặc API HTTPS có opt-in.
- Glossary, nhân vật, quan hệ xưng hô, synopsis/notes, approved Translation Memory; RAG lexical BM25 chạy CPU. Chưa có embedding RAG hoặc tự nhận diện người nói.
- QA theo luật và AI; gợi ý sửa riêng, duyệt thủ công, fingerprint phát hiện kết quả cũ. Kiểm tra đầy đủ ID trong từng nhóm.
- Checkpoint dịch theo nhóm, cache, tiếp tục phần chưa dịch. Lỗi AI sai định dạng/ID sau retry sẽ chia nhỏ nhóm; không áp dụng fallback chia nhóm cho lỗi mạng/hủy.
- Sửa dropdown nền trắng/chữ sáng; luồng tạo phụ đề đặt tự động: ưu tiên phụ đề nhập/có sẵn rồi Whisper. Chưa tự dò chữ cháy trên hình để chọn OCR.
- Xóa dự án bằng nút thùng rác cạnh chọn dự án, xác nhận, chặn khi chạy/queued/uploading; nút khôi phục. Soft delete giữ dữ liệu trên đĩa, chưa có purge giải phóng dung lượng.

## Cấu hình laptop tại thời điểm bàn giao
- Ollama portable 0.34.4; model `qwen3:4b-instruct`.
- `forceCpu=true`, 4 luồng, batch 4, context 4096, autoReview bật.
- App chưa tự dò CPU/GPU/RAM/VRAM để chọn cấu hình tối ưu. Mang cấu hình này sang máy AMD vẫn ép CPU.
- `/api/settings`, `/api/state` phản ánh trạng thái hiện tại; không dùng số tiến độ trong lịch sử chat làm trạng thái mới.
- Một tác vụ video dài đang được dịch trên laptop; không có dữ liệu/tác vụ đó trong clone GitHub.

## Kiểm chứng đã thực hiện
- 22/22 kiểm thử Node đạt sau thay đổi xóa/khôi phục dự án.
- Ollama thật đã vượt đoạn lỗi ID ở câu 93–100; giữ timestamp và 92 câu trước. Tác vụ được tiếp tục từ checkpoint.
- Dịch ngữ cảnh 8 câu trên CPU: khoảng 58 giây; QA 8 câu khoảng 143 giây trong lần đo. Đây là mẫu nhỏ, không phải cam kết tốc độ cho toàn bộ video.
- QA phát hiện 3/3 lỗi cố ý trong mẫu nhưng vẫn có false positive và đề xuất chưa đúng. Xem `TRANSLATION-QUALITY.md` và `TEST-REPORT.md`.
- SRT import/edit/approve/export kiểm tra trên UI; viewport desktop 1366×768 không cuộn toàn trang. Tệp bằng chứng nằm trong `data/` laptop nên không có trên GitHub.
- AMD/Vulkan, chất lượng toàn bộ series và hiệu năng trên máy bàn chưa được kiểm chứng.

## Bắt đầu trên máy bàn
1. Clone repository, đọc `AGENTS.md` và tài liệu này. Kiểm tra Node 24+, Python 3.12, GPU/driver/RAM thực tế.
2. Git chỉ chứa source; cần cài hoặc chuyển riêng `tools/` và `models/`. Không sao chép `.venv` từ máy khác. Muốn giữ dự án cũ phải chuyển riêng `data/` khi server đã dừng và có bản sao lưu.
3. `Setup.cmd` hiện cài tài nguyên/OPUS và cấu hình CPU; chưa tự cài đầy đủ Ollama + model instruct. Đọc các script `install-ollama*.py` và `configure-local.mjs`; kiểm tra model qua Ollama trước khi chọn trong giao diện.
4. Khởi động `Start.cmd`; kiểm tra công cụ/cấu hình. Không dùng đường dẫn tuyệt đối của laptop cho máy bàn.
5. Chạy bộ test; thử một SRT ngắn trước khi xử lý cả series.

## Việc tiếp theo được đề xuất, chưa hoàn thành
- Nhận diện phần cứng và chọn profile tự động, hiển thị backend thực sự đang chạy.
- Benchmark Qwen 4B trên RX 5600 XT qua Vulkan, xác minh VRAM/CPU fallback; không giả định ROCm hỗ trợ card này.
- Đo batch 4/6/8 và số luồng CPU phù hợp; không tăng đồng thời nhiều tác vụ khi thiếu VRAM.
- Tách dịch và QA để xuất bản nháp sớm; QA toàn bộ hiện tốn thêm thời gian đáng kể.
- Tăng chất lượng ASR, giữ tên/xưng hô và căn nghĩa từng mảnh câu. Một số bản dịch cũ đã lệch nghĩa dù đúng ID; không tự ghi đè bản duyệt.
- Cải thiện UI khôi phục dự án (hiện dùng hộp nhập số), cân nhắc purge có xác nhận nếu người dùng yêu cầu.

Không tự bắt đầu các hạng mục trên chỉ vì có trong danh sách; ưu tiên yêu cầu mới của người dùng và đánh giá trạng thái máy hiện tại.
