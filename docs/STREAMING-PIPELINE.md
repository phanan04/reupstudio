# Pipeline tăng dần

## Cách dùng

Upload video rồi chọn tạo phụ đề. Metadata được đọc ngay sau upload và dùng lại khi chạy. Phụ đề nhập/kèm/nhúng được ưu tiên; nếu cần Whisper, các cửa sổ âm thanh được nhận diện rồi chuyển sang dịch theo thứ tự. Timeline cập nhật theo các checkpoint, không chờ toàn bộ video.

Trong lúc nhận diện/dịch có thể sửa nội dung và thời gian từng câu. Thêm/xóa câu chỉ thực hiện khi dừng. Nút **Tạm dừng** hủy công đoạn đang chạy; **Tiếp tục phần còn lại** giữ đúng chế độ cũ và bỏ qua các checkpoint đã hoàn thành. Một nhóm dịch/đoạn ASR chưa commit có thể chạy lại. Khi đang xuất video, biên tập bị khóa.

**Kiểu phụ đề xem trước & xuất** đổi font, cỡ và màu chữ mà không nhận diện/dịch lại. SRT chỉ chứa văn bản/thời gian, không mang kiểu chữ; kiểu được dùng trong preview và ASS chèn vào video. Font phải có trên máy xuất để tránh fallback.

Trong **Duyệt dịch**, kiểm tra chất lượng rồi chọn thử lại câu lỗi: chỉ các câu được đánh dấu lỗi dịch, chưa sửa tay và chưa duyệt được xóa bản dịch để chạy lại. AI không tự áp dụng đề xuất sửa. Lỗi thời gian/nguyên văn cần nghe và chỉnh, không tự dịch lại cả video. ASR thất bại được thử lại riêng đoạn tối đa hai lần mỗi lượt; đoạn trống sau kiểm tra lại có cảnh báo, không được coi là đã chứng minh không có lời nói.

Chỉ khi bấm xuất mới chạy TTS/render. Không cho tải SRT/xuất video khi ASR chưa hoàn tất hoặc còn thiếu bản dịch.

## Thiết kế

- Giữ Node HTTP/SQLite/FFmpeg native, một tập hoạt động. Không thêm Redis, broker hoặc server Docker.
- `streaming.mjs`: một producer ASR và một consumer dịch có thứ tự; tối đa một đoạn được chuẩn bị trước. RAM trống, số CPU và tải máy được kiểm tra giữa các đoạn để chọn một hoặc hai công đoạn. Đây là quy tắc thận trọng, chưa phải bộ tối ưu đã benchmark GPU.
- ASR ép CPU để tránh tranh VRAM với bộ dịch. Cửa sổ mục tiêu 45 giây, ưu tiên khoảng lặng sau 25 giây; có phần âm thanh trước/sau ranh giới. Dùng Silero VAD nếu có model và CLI hỗ trợ; nếu không, `silencedetect` chỉ hỗ trợ chia đoạn, không thay thế phát hiện lời nói bằng mô hình.
- `asrManifest` lưu cửa sổ, mốc tuyệt đối, âm thanh đã chuẩn bị, số lần thử, ID câu, lỗi/cảnh báo và trạng thái hoàn thành trong SQLite. Thay đổi nguồn/model bị từ chối khi đã có cues để bảo vệ bản sửa.
- Giữ một phiên provider trong giai đoạn ASR/dịch. Batch dịch theo thứ tự có tri thức dự án, ngữ cảnh và TM đã duyệt; giữ hai câu cuối để có thêm ngữ cảnh từ đoạn kế tiếp. OPUS vẫn là bộ dịch từng câu, không có khả năng ngữ cảnh của LLM.
- `cue-merge.mjs` gộp kết quả theo ID và snapshot; chỉ điền câu còn trống, không ghi đè câu người dùng vừa sửa hoặc các câu ASR mới thêm. PATCH từng câu kiểm tra base; xung đột cùng câu trả 409. Thêm/xóa dùng revision toàn bộ.
- `pipelineMetrics` đếm giây video/câu đã xử lý, thời gian đo và tốc độ trung bình có trọng số. ETA chỉ xuất hiện sau ít nhất hai mẫu; tổng số câu chưa biết khi ASR còn chạy. Phần trăm chung vẫn là chỉ báo giai đoạn, không phải dự báo thời gian toàn pipeline.
- FFmpeg xuất báo tiến độ bằng `-progress pipe:1`; đổi tên output chỉ sau thành công. ASR/dịch tiếp tục từ checkpoint; render bị ngắt phải xuất lại từ đầu. OCR/TTS giữ cơ chế hiện có.

## Kiểm chứng ngày 28/09/2026

Trên macOS Intel, Node 24.19.0; test dùng DB/media tạm, không chạm dữ liệu người dùng.

| Phép đo | Kết quả | Phạm vi |
| --- | --- | --- |
| FFmpeg 7.1: cắt PCM từ video tổng hợp 95 giây | 337 ms; 3 đoạn có ranh giới 39, 79, 95 giây | FFmpeg thật, video 160×90, không suy luận AI |
| Scheduler giả lập: chờ toàn bộ ASR | câu đầu 550 ms; tổng 1218 ms | 12 đoạn, ASR 40 ms + dịch 60 ms/đoạn |
| Scheduler giả lập: tuần tự từng đoạn | câu đầu 101 ms; tổng 1225 ms | Cùng tải giả lập |
| Scheduler giả lập: ASR/dịch chồng thời gian | câu đầu 101 ms; tổng 800 ms | Chỉ đo scheduler, không suy ra tốc độ Whisper/LLM |

UI: 40 câu với provider giả lập; sửa trong lúc dịch, pause/resume, giữ bản sửa và bản dịch đã xong, đổi Verdana/cỡ 54; desktop 1366×768 và cửa sổ 760×800 không cuộn toàn trang. Có nút đóng bảng thuộc tính trên màn hình hẹp.

Chạy lại:

```sh
npm test
npm run check
node scripts/benchmark-streaming.mjs
node scripts/benchmark-media.mjs
```

Lệnh cuối cần `ffmpeg` trên PATH; có thể truyền đường dẫn công cụ làm đối số. Benchmark chỉ tạo/xóa thư mục tạm do nó tạo, không dùng video người dùng.

## Giới hạn cần kiểm chứng tiếp

Chưa đo suy luận Whisper/LLM với lời thoại Trung thật, chất lượng ngôn ngữ, GPU AMD, Windows hoặc Mac ARM trong phiên này. Whisper CLI hiện nạp model theo từng cửa sổ: giúp có kết quả sớm và resume theo đoạn nhưng có thể làm tổng thời gian tăng; cần benchmark trước khi chọn persistent worker. Timestamp ASR và nối ranh giới vẫn có sai số, chưa có forced alignment/diarization; QA chỉ cảnh báo chồng thời gian/lặp câu, không bảo đảm tìm được mọi câu bị bỏ sót. OCR chưa được chuyển sang pipeline tăng dần. Không tự sửa lỗi ngữ nghĩa/thời gian khi thiếu bằng chứng.

Tài liệu gốc: [whisper.cpp CLI](https://github.com/ggml-org/whisper.cpp/tree/master/examples/cli), [model VAD](https://github.com/ggml-org/whisper.cpp/blob/master/models/download-vad-model.sh), [FFmpeg silencedetect](https://ffmpeg.org/ffmpeg-filters.html#silencedetect), [FFmpeg progress](https://ffmpeg.org/ffmpeg.html).
