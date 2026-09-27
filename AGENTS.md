# Hướng dẫn cho Codex

## Đọc trước khi làm việc
- Đọc `PROGRESS.md`, `ARCHITECTURE.md`, `TRANSLATION.md` và các tệp liên quan trước khi sửa.
- Đây là ứng dụng đang hoạt động, không dựng lại từ đầu. Giữ luồng tải video/SRT → dịch → duyệt → xuất.
- Trao đổi với người dùng bằng tiếng Việt. Ưu tiên mã nguồn mở, miễn phí, local Windows; phần cứng đích AMD RX 5600 XT 6 GB, có CPU fallback.
- Không coi trạng thái máy laptop trong tài liệu là cấu hình của máy đang chạy. Kiểm tra cấu hình và phần cứng thực tế.

## Kiến trúc và lệnh
- Node.js 24+ ESM, HTTP server thuần, `node:sqlite`; frontend HTML/CSS/JS thuần, Python 3.12 cho OCR/TTS/OPUS.
- `server/main.mjs`: API localhost và media; `store.mjs`: SQLite; `pipeline.mjs`: hàng đợi tuần tự và FFmpeg.
- `translation.mjs`: dịch ngữ cảnh, checkpoint, QA; `ai-provider.mjs`: Ollama/llama.cpp/API; `knowledge.mjs`: glossary, nhân vật, quan hệ, approved TM, lexical RAG.
- `public/`: giao diện một khung kiểu CapCut. Không thay bằng trang dài cuộn toàn bộ.
- Khởi động bình thường: `node scripts/start.mjs` hoặc `Start.cmd`. `npm start` chỉ chạy server, không thực hiện bước tự khởi động Ollama của launcher.
- Kiểm thử: `node --test tests/*.test.mjs`. Kiểm tra cú pháp: `npm run check`.
- Cài đặt: đọc `scripts/setup.mjs` trước khi chạy `Setup.cmd`; nó tải tài nguyên và cập nhật cấu hình máy. Không chạy lại để sửa lỗi giao diện.

## Bảo toàn dữ liệu và chất lượng
- `data/` chứa dự án, SQLite, checkpoint, video, phụ đề; không xóa/reset để chữa lỗi. Sao lưu trước thay đổi schema hoặc dữ liệu lớn.
- Giữ nguyên ID và timestamp phụ đề. Không chấp nhận đầu ra AI thiếu/trùng ID; không tự nối bản dịch sai ID theo vị trí.
- Không dịch lại câu đã hoàn thành hoặc ghi đè chỉnh sửa/duyệt của người dùng khi resume.
- Chỉ bản dịch được người dùng duyệt mới vào Translation Memory. QA AI là gợi ý, không tự áp dụng.
- Các bản dịch có thể sai nghĩa, ASR có thể nhận sai tiếng Trung; phân biệt thành công kỹ thuật và chất lượng ngôn ngữ.
- Dự án đã xóa hiện là soft delete, có thể khôi phục; không tự purge video để giải phóng dung lượng.
- Không mở `Store` trên DB đang chạy từ script kiểm tra: constructor có cơ chế đánh dấu tác vụ gián đoạn. Đọc qua API hoặc SQLite chỉ đọc; dùng DB riêng cho kiểm thử.
- Trước restart, kiểm tra `/api/state`, giữ checkpoint và tiếp tục đúng tác vụ/chế độ. Tránh giết mọi tiến trình Node/Ollama trên máy.

## Phần cứng và bảo mật
- AMD chưa được benchmark. Không tuyên bố GPU hoạt động chỉ vì đã cài driver hoặc bỏ forceCpu; xác minh backend thực tế và đo tốc độ.
- Giữ localhost, same-origin header `X-VietStudio: 1`, kiểm tra URL và subprocess không qua shell.
- API từ xa chỉ hoạt động khi người dùng bật gửi dữ liệu; khóa lấy từ biến môi trường, không lưu vào Git/DB hoặc log.
- Không tắt Windows Code Integrity/Defender để chạy DLL bị chặn. Laptop từng bị chặn `ggml.dll`; runtime Ollama chính thức thay thế đã chạy được.
- Không commit `data/`, `tools/`, `models/`, `.venv/`, `node_modules/`, `.env`, cookies, token hay cấu hình đường dẫn máy.

## Khi sửa và bàn giao
- Kiểm thử phù hợp thay đổi; dùng dự án/DB riêng cho thử xóa, reset và dịch. Không dùng video của người dùng làm dữ liệu phá hủy.
- Với UI, kiểm tra trên trình duyệt, cả dropdown và bố cục desktop/hẹp. Giữ tác vụ backend đang chạy khi chỉ đổi tài nguyên frontend.
- Các script `feature-update.mjs`, `final-ui-update.mjs`, `health-update.mjs`, `refine.mjs` là script sửa mã lịch sử; không chạy như bước cài đặt vì có thể ghi đè bản mới.
- Cập nhật `PROGRESS.md` sau thay đổi đáng kể: đã làm, kiểm chứng, giới hạn, việc tiếp theo. Không ghi bí mật hoặc dữ liệu riêng của người dùng.
