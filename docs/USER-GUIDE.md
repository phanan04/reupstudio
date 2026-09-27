# Hướng dẫn sử dụng Việt Studio

Cài đặt và chạy đa nền tảng: xem [README](../README.md).

## Luồng CapCut / SRT và dịch xuyên tập

Bấm **Nhập phụ đề CapCut** để dịch SRT trực tiếp, không cần video. Mục **Tri thức** quản lý nhân vật, quan hệ, thuật ngữ và cốt truyện; **Duyệt dịch** kiểm tra AI, chỉnh sửa và ghi nhớ câu đã duyệt. Xem [hướng dẫn chi tiết](../TRANSLATION.md).

## Quy trình biên tập video

Giao diện nằm trong một khung màn hình: thư viện bên trái, video ở giữa, thuộc tính bên phải và timeline ở dưới. Chỉ các bảng nội dung dài cuộn riêng; màn hình hẹp dùng bảng thuộc tính đóng/mở.

1. Chọn dự án, bấm **Tải video lên** hoặc kéo video vào khung xem trước. Hỗ trợ nhiều tệp, tối đa 20 GB/tệp.
2. Bấm **Tạo phụ đề Việt**. Chọn âm thanh/phụ đề có sẵn, Whisper hoặc OCR chữ trên video. Hệ thống dừng sau dịch để duyệt.
3. Bấm câu trên timeline hoặc danh sách Phụ đề. Sửa lời Trung, lời Việt, thời gian và giọng của câu ở bảng bên phải. Kéo thân/đầu/cuối thanh phụ đề để điều chỉnh thời gian. Các sửa đổi tự lưu.
4. Tab **Giọng đọc** chọn giọng mặc định và mức âm gốc. Tab **Hình ảnh** chọn cách che chữ Trung, vùng che và gắn phụ đề Việt.
5. Bấm **Xuất video**, chọn độ phân giải/mã hóa, rồi xuất MP4. Xem **Bản xuất** hoặc tải MP4/SRT. Khi câu đọc quá dài, bấm thông báo lỗi để đến câu cần rút gọn hoặc chỉnh thời gian.

Space phát/dừng, Ctrl+S lưu ngay; nút Vừa khung đưa timeline về toàn bộ video. Đổi ngữ cảnh không tự ghi đè bản dịch đã sửa: dùng Dịch lại phụ đề khi cần. Bản xuất cần được xuất lại sau khi sửa.

Giao diện hiện ưu tiên tệp trên máy; nhập URL Bilibili/Douyin đã ẩn khỏi luồng chính, backend vẫn giữ API. Timeline phục vụ phụ đề của từng video; chưa có cắt ghép nhiều video như phần mềm dựng phim đầy đủ.

Bộ dịch chọn trong Cấu hình máy: **OPUS CPU** chạy offline, không áp dụng ngữ cảnh/thuật ngữ LLM và cần duyệt lời Việt; **LLM** dùng Qwen qua llama.cpp hoặc máy chủ tương thích trên localhost, có ngữ cảnh, thuật ngữ và kiểm tra ID câu. Backend và tốc độ phải kiểm tra trên từng máy.

## Giọng và xử lý hình

- Ba mô hình Piper: VAIS1000, VIVOS, 25hours_single; chọn giọng mặc định hoặc từng câu. Mô hình được nạp một lần cho mỗi giọng trong tác vụ, cache theo nội dung và phiên bản tệp.
- Piper CPU không cần CUDA, hoạt động được trên laptop và máy AMD. Độ tự nhiên phụ thuộc mô hình; không có tuyên bố ngang giọng thương mại hay CapCut.
- Vùng phụ đề Trung: làm mờ, dải tối hoặc FFmpeg delogo. Delogo là nội suy ảnh, không phải AI phục dựng nền; nền chuyển động/phức tạp có thể có vệt.
- Âm gốc trộn ở mức tùy chọn. Giảm âm gốc cũng giảm nhạc/hiệu ứng. Chưa có tách riêng giọng Trung khỏi nhạc nền, nhận diện người nói tự động, voice cloning hay timeline nhiều track như CapCut.

## Cookies Bilibili / Douyin

Douyin đã trả lỗi `Fresh cookies needed` khi thử URL công khai trên laptop. Dùng tệp cookies Netscape xuất từ phiên của chính bạn, đặt đường dẫn ở **Cấu hình máy → Tệp cookies**, lưu và thử lại. Ứng dụng không tự lấy cookies/mật khẩu trình duyệt. Cookies không được gửi tới AI; yt-dlp dùng để truy cập nguồn. Không đưa tệp này vào gói chuyển máy hay Git. Nền tảng thay đổi thường xuyên; cập nhật yt-dlp khi cần rồi kiểm thử lại.

## Nguồn và giấy phép

- [yt-dlp](https://github.com/yt-dlp/yt-dlp): Unlicense; hỗ trợ Bilibili/Douyin nhưng không bảo đảm mọi URL đều hoạt động.
- [FFmpeg builds](https://www.gyan.dev/ffmpeg/builds/): gói GPLv3 từ mirror chính thức GyanD; giữ LICENSE khi phân phối.
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp): MIT; [Vulkan build](https://github.com/ggml-org/whisper.cpp#vulkan-gpu-support).
- [llama.cpp](https://github.com/ggml-org/llama.cpp): MIT; [Windows/Vulkan](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md).
- [Qwen3-4B GGUF](https://huggingface.co/Qwen/Qwen3-4B-GGUF): Apache-2.0.
- [OPUS zh-vi](https://huggingface.co/Helsinki-NLP/opus-mt-zh-vi): Apache-2.0.
- [Piper](https://github.com/OHF-Voice/piper1-gpl): GPL-3.0; [giọng Việt](https://huggingface.co/rhasspy/piper-voices/tree/main/vi/vi_VN) có model card/điều khoản riêng từng giọng.
- [RapidOCR](https://github.com/RapidAI/RapidOCR): Apache-2.0, ONNX Runtime; CPU mặc định, DirectML tùy chọn cần cài môi trường phù hợp.

Chỉ nhập và xử lý nội dung bạn có quyền sử dụng. Ứng dụng không vượt DRM hay quyền truy cập nền tảng.
