# Kiến trúc và các giai đoạn

## Giai đoạn 1 — Dữ liệu và giao diện

Node 24 HTTP server + SQLite (WAL), không Redis/Docker và không cần build frontend. SPA HTML/CSS/JS đồng nguồn trên 127.0.0.1. API kiểm tra Host/Origin, yêu cầu header riêng cho mutation, không mở CORS, CSP hạn chế và không chèn HTML từ phụ đề. Upload stream ra đĩa, không nạp cả video vào RAM. Video phục vụ byte-range để tua.

`series` chứa thiết lập dùng chung; `episodes` chứa metadata, cues và trạng thái. Các tệp nằm trong thư mục ID UUID, không dùng tên file do người dùng gửi làm đường dẫn lưu. SQLite lưu log và cache dịch. Edits dùng revision để tránh ghi đè dữ liệu đã thay đổi. Server chỉ dành cho một máy/người dùng tin cậy; không publish trực tiếp lên LAN/Internet.

## Giai đoạn 2 — Pipeline thật

`Pipeline` chạy một tập mỗi lần để kiểm soát VRAM. Tác vụ queued/running bị ngắt bởi restart chuyển interrupted. Video nguồn, phụ đề và bản dịch từng batch được lưu; khi chạy tiếp sẽ tái sử dụng. Trạng thái không giả lập bằng timer; phần trăm thể hiện giai đoạn/câu đã xong, không phải ETA chính xác.

```text
URL / upload
  → yt-dlp / local file
  → ffprobe
  → phụ đề kèm/nhúng | whisper.cpp | RapidOCR
  → normalize cues + time validation
  → Qwen OpenAI-compatible (context + glossary) | OPUS CPU
  → duyệt và sửa
  → Piper theo từng giọng
  → atempo có giới hạn + silence padding + concat
  → che vùng chữ + ASS burn + audio mix + H.264/AAC
  → output.pending.mp4 → output.mp4
```

Mọi CLI dùng `spawn` với mảng tham số, `shell:false`, `windowsHide:true`. Cancellation dừng cây process trên Windows. Output lớn có giới hạn; lỗi công cụ không khiến các tập sau mắc kẹt. Tệp xuất được đổi tên sau khi render thành công.

## Giai đoạn 3 — Chất lượng và phần cứng

- LLM giữ ID/timestamp, dịch batch có ngữ cảnh trước/sau và bảng thuật ngữ. Validate JSON, retry, content cache; bản sửa tay không bị dịch đè.
- OPUS là chế độ riêng: nhỏ, CPU, không tự nhận là context-aware. Chất lượng tên riêng/xưng hô cần biên tập.
- OCR: ROI, lọc confidence, so khớp chuỗi và bỏ rung chữ qua nhiều khung. Độ chính xác thời gian giới hạn bởi tần số lấy mẫu.
- TTS giữ mốc bắt đầu/kết thúc, dùng khoảng lặng và tăng tốc tối đa 1.35× mặc định. Câu chồng nhau hoặc không đủ chỗ sẽ báo lỗi để biên tập, không cắt âm tiết.
- GPU mục tiêu RX 5600 XT: Vulkan cho LLM, AMF cho encode; Whisper Vulkan là adapter tùy chọn. Bản ASR cài sẵn CPU. LLM được mở sau ASR và đóng trước TTS/export. Không yêu cầu ROCm hoặc CUDA.
- Pipeline đã chạy thật trên laptop Intel bằng OPUS + Piper + FFmpeg CPU; GPU AMD cần acceptance test trên máy đích.

## Giai đoạn 4 — Vận hành và bàn giao

Setup tái lập bằng Python lockfile, mô hình/tool có SHA256 và tệp nguồn kèm. Gói chuyển máy loại bỏ dữ liệu cá nhân, .venv, cookies và dấu chặn runtime của laptop. Khi chuyển dự án, phải chạy configure-local để cập nhật đường dẫn tuyệt đối.

Không dùng dịch vụ có phí; không đưa video/phụ đề lên cloud. Không có scheduler ngoài ứng dụng. Muốn xử lý xuyên đêm phải giữ máy/server chạy và tắt sleep bằng thiết lập của người dùng.

## Hạn chế có chủ đích

Đây là xưởng Việt hóa series với trình sửa cues/timeline đơn, không phải bản sao NLE đầy đủ của CapCut. Chưa có timeline dựng nhiều clip/track, tách nhạc nền bằng mô hình, inpainting video bằng AI, diarization/voice cloning hoặc benchmark chất lượng sản xuất. Không tự bật các tác vụ nặng này trên GPU 6 GB khi chưa kiểm chứng.


## Nâng cấp dịch ngữ cảnh (27/09/2026)

Giữ pipeline video và SQLite; thêm `knowledge.mjs` (glossary, nhân vật, TM đã duyệt, BM25 RAG), `ai-provider.mjs` (Ollama/llama.cpp/API), `translation.mjs` (context batching, checkpoint, quality review). Chế độ hàng đợi translate/quality chạy chỉ từ cues, không cần video. Xem TRANSLATION.md cho mô hình dữ liệu, phạm vi truy xuất và giới hạn.
