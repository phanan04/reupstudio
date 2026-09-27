# Kiểm chứng ngày 26/09/2026

## Đã chạy thực tế

- 14 kiểm thử tự động đạt: API, lưu trữ, media byte ranges, chống ghi đè bản sửa cũ, kiểm tra đầu vào, hàng đợi, hủy tiến trình, tạo filter graph, giao thức LLM giả lập và chặn gọi lại runtime bị Windows từ chối.
- Video kiểm thử tự sinh 16 giây: phụ đề Trung → OPUS CPU → Piper → che chữ, gắn phụ đề Việt → MP4 H.264/AAC. Kết quả trong `data/e2e-verification/result.json`.
- Ba giọng Piper chạy thực. OCR nhận được ba câu của video tổng hợp. Đây không phải đánh giá chất lượng trên bộ dữ liệu thực tế lớn.
- Whisper CPU nhận dạng mẫu giọng Trung 19 giây; còn lỗi nhận dạng, chưa đo WER.
- Giao diện mới trên trình duyệt: bố cục 1366×768 có chiều cao trang đúng 768px, không cuộn toàn trang; chọn câu trên timeline, sửa lời Việt, tự lưu trước xuất, xuất lại MP4 thực thành công (video kiểm chứng 16 giây).
- API tải lên, lưu phụ đề và xuất thực: `data/verification/api-result.json`.

## Giới hạn đã biết

- Máy kiểm thử là laptop Intel Iris Xe; chưa kiểm chứng tốc độ hoặc ổn định RX 5600 XT, Vulkan và AMD AMF.
- Windows Code Integrity từ chối ggml.dll của llama.cpp. Không thay đổi bảo mật; laptop dùng OPUS CPU. Chưa xác nhận dịch LLM thực trên máy này.
- Bilibili đọc được danh sách tập của URL mẫu; chưa kiểm chứng tải video từ xa hoàn chỉnh. Douyin yêu cầu cookies. Luồng UI hiện tập trung video tải lên.
- Câu lồng tiếng dài quá giới hạn tốc độ sẽ dừng xuất và chỉ rõ câu cần sửa; không cắt lời tự động. Một video người dùng hiện có lỗi này tại câu 5.
- Timeline chỉnh phụ đề, không phải công cụ cắt ghép video nhiều lớp. Giọng đọc chưa có preview riêng trước xuất; nghe trong MP4 đã tạo.


## Nâng cấp 27/09/2026

20 kiểm thử tự động đạt, thêm SRT CapCut không cần video, TM đã duyệt, RAG giới hạn tập/dự án, metadata người nói, checkpoint, Ollama/API. Ollama chính thức và Qwen3 4B Instruct đã chạy thật trên CPU; xem TRANSLATION-QUALITY.md để biết kết quả và lỗi còn tồn tại. Mục giới hạn llama.cpp cũ ở trên không áp dụng cho runtime Ollama mới đã xác minh chữ ký.

## Sửa lỗi dịch sai ID (2026-09-27)
- Tác vụ 1.315 câu dừng sau checkpoint 92 câu vì đầu ra AI không đủ ID.
- Ràng buộc số phần tử và ID trong JSON schema; vẫn kiểm tra ID trùng/thiếu bằng validator.
- Chia đôi nhóm sau khi hết retry lỗi định dạng; không chia nhóm khi lỗi mạng hoặc hủy.
- Thêm chỉ dẫn giữ nghĩa từng mảnh phụ đề đúng ID, giữ nguyên timestamp; bỏ qua các nhóm đã dịch.
- 21/21 kiểm thử đạt. Kiểm chứng Ollama Qwen3 4B Instruct thật trên câu 93–100 thành công, 92 câu trước và timestamp không thay đổi. Kết quả: data/verification/translation-recovery.json.
- Kiểm chứng này xác nhận khôi phục xử lý, không chứng nhận chất lượng toàn bộ bản dịch. Câu 98 còn dịch 窗户 thành cửa và cần duyệt lại.
