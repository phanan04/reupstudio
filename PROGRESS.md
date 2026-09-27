# Bàn giao Việt Studio

Cập nhật: 2026-09-27. Repository: https://github.com/phanan04/reupstudio, nhánh `main`.

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
