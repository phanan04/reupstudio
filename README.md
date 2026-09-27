# Việt Studio — Việt hóa video local trên Windows

Ứng dụng web local để nhập series Bilibili/Douyin hoặc video trên máy, lấy phụ đề, dịch, sửa lời thoại, tạo giọng Việt và xuất MP4. Frontend và backend thực, dữ liệu SQLite trên đĩa; không cần dịch vụ cloud trả phí.

## Mở trên laptop đang phát triển

Chạy **Start.cmd**, mở **http://127.0.0.1:8765**. Giữ cửa sổ chạy server mở khi xử lý. Đóng tab trình duyệt không làm mất tác vụ. Khi đóng server hoặc tắt máy, tác vụ chưa xong được đánh dấu gián đoạn; bấm xử lý lại để tiếp tục từ dữ liệu đã lưu.

Các công cụ và mô hình đã cài trong `tools/`, `models/`, `.venv/`. Dữ liệu nằm trong `data/`; không xóa thư mục này nếu muốn giữ dự án. Bản cài laptop hiện dùng Ollama + Qwen3 4B Instruct trên CPU; OPUS vẫn là lựa chọn nhẹ. Bản llama.cpp đã tải bị Windows Code Integrity chặn `ggml.dll` (0xC0E90002), được đánh dấu để không gọi lại. Runtime Ollama chính thức mới đã được kiểm tra chữ ký riêng. Không thay đổi thiết lập bảo mật Windows để chạy nó.

## Chuyển sang máy RX 5600 XT 6 GB

1. Cài Node.js **24+** và Python **3.12 x64** từ nhà phát hành chính thức. Cập nhật driver AMD từ AMD nếu cần Vulkan/AMF.
2. Trên laptop: `node scripts/package.mjs --with-models` tạo thư mục `vietstudio-transfer` cạnh dự án. Sao chép thư mục đó sang máy đích. Không mang `.venv` của laptop sang máy khác.
3. Trên máy đích, chạy `Setup.cmd`. Có thể chỉ định đường dẫn Python: `Setup.cmd "C:\Python312\python.exe"`. Bộ cài tạo venv, cài đúng phiên bản thư viện, kiểm tra SHA256 mô hình đã có và bổ sung phần thiếu.
4. Chạy `Start.cmd`, mở **Cấu hình máy → Kiểm tra công cụ**.
5. Đổi bộ dịch sang **LLM** khi bản llama.cpp được Windows máy đích cho phép chạy. Qwen3-4B-Q4_K_M (~2,5 GB), context 8192, một tác vụ; thử 99 lớp GPU rồi giảm nếu driver thiếu bộ nhớ. 6 GB là cấu hình mục tiêu, chưa được benchmark trên laptop Intel.
6. Xuất bằng **AMD AMF** nếu lần kiểm thử thực tế thành công. CPU H.264 là lựa chọn dự phòng.

Gói cài hiện cung cấp Whisper small và whisper.cpp **CPU** chính thức. Adapter hỗ trợ cùng CLI của bản Vulkan; để ASR dùng AMD, build whisper.cpp với `-DGGML_VULKAN=ON` theo tài liệu upstream rồi chọn `whisper-cli.exe` tương ứng trong Cấu hình máy. Không coi chỉ có driver Vulkan là ASR đã chạy GPU.

## Luồng CapCut / SRT và dịch xuyên tập

Bấm **Nhập phụ đề CapCut** để dịch SRT trực tiếp, không cần video. Mục **Tri thức** quản lý nhân vật, quan hệ, thuật ngữ và cốt truyện; **Duyệt dịch** kiểm tra AI, chỉnh sửa và ghi nhớ câu đã duyệt. Xem [hướng dẫn chi tiết](TRANSLATION.md).

## Quy trình biên tập video

Giao diện nằm trong một khung màn hình: thư viện bên trái, video ở giữa, thuộc tính bên phải và timeline ở dưới. Chỉ các bảng nội dung dài cuộn riêng; màn hình hẹp dùng bảng thuộc tính đóng/mở.

1. Chọn dự án, bấm **Tải video lên** hoặc kéo video vào khung xem trước. Hỗ trợ nhiều tệp, tối đa 20 GB/tệp.
2. Bấm **Tạo phụ đề Việt**. Chọn âm thanh/phụ đề có sẵn, Whisper hoặc OCR chữ trên video. Hệ thống dừng sau dịch để duyệt.
3. Bấm câu trên timeline hoặc danh sách Phụ đề. Sửa lời Trung, lời Việt, thời gian và giọng của câu ở bảng bên phải. Kéo thân/đầu/cuối thanh phụ đề để điều chỉnh thời gian. Các sửa đổi tự lưu.
4. Tab **Giọng đọc** chọn giọng mặc định và mức âm gốc. Tab **Hình ảnh** chọn cách che chữ Trung, vùng che và gắn phụ đề Việt.
5. Bấm **Xuất video**, chọn độ phân giải/mã hóa, rồi xuất MP4. Xem **Bản xuất** hoặc tải MP4/SRT. Khi câu đọc quá dài, bấm thông báo lỗi để đến câu cần rút gọn hoặc chỉnh thời gian.

Space phát/dừng, Ctrl+S lưu ngay; nút Vừa khung đưa timeline về toàn bộ video. Đổi ngữ cảnh không tự ghi đè bản dịch đã sửa: dùng Dịch lại phụ đề khi cần. Bản xuất cần được xuất lại sau khi sửa.

Giao diện hiện ưu tiên tệp trên máy; nhập URL Bilibili/Douyin đã ẩn khỏi luồng chính, backend vẫn giữ API. Timeline phục vụ phụ đề của từng video; chưa có cắt ghép nhiều video như phần mềm dựng phim đầy đủ.

Bộ dịch chọn trong Cấu hình máy: **OPUS CPU** chạy offline, không áp dụng ngữ cảnh/thuật ngữ LLM và cần duyệt lời Việt; **LLM** dùng Qwen qua llama.cpp hoặc máy chủ tương thích trên localhost, có ngữ cảnh, thuật ngữ và kiểm tra ID câu. Laptop hiện dùng Qwen qua Ollama CPU.

## Giọng và xử lý hình

- Ba mô hình Piper: VAIS1000, VIVOS, 25hours_single; chọn giọng mặc định hoặc từng câu. Mô hình được nạp một lần cho mỗi giọng trong tác vụ, cache theo nội dung và phiên bản tệp.
- Piper CPU không cần CUDA, hoạt động được trên laptop và máy AMD. Độ tự nhiên phụ thuộc mô hình; không có tuyên bố ngang giọng thương mại hay CapCut.
- Vùng phụ đề Trung: làm mờ, dải tối hoặc FFmpeg delogo. Delogo là nội suy ảnh, không phải AI phục dựng nền; nền chuyển động/phức tạp có thể có vệt.
- Âm gốc trộn ở mức tùy chọn. Giảm âm gốc cũng giảm nhạc/hiệu ứng. Chưa có tách riêng giọng Trung khỏi nhạc nền, nhận diện người nói tự động, voice cloning hay timeline nhiều track như CapCut.

## Cookies Bilibili / Douyin

Douyin đã trả lỗi `Fresh cookies needed` khi thử URL công khai trên laptop. Dùng tệp cookies Netscape xuất từ phiên của chính bạn, đặt đường dẫn ở **Cấu hình máy → Tệp cookies**, lưu và thử lại. Ứng dụng không tự lấy cookies/mật khẩu trình duyệt. Cookies không được gửi tới AI; yt-dlp dùng để truy cập nguồn. Không đưa tệp này vào gói chuyển máy hay Git. Nền tảng thay đổi thường xuyên; cập nhật yt-dlp khi cần rồi kiểm thử lại.

## Cài mới bằng terminal

```powershell
node scripts/setup.mjs "C:\Python312\python.exe"
node scripts/start.mjs
```

Lần đầu cần Internet và khoảng 5–7 GB cho công cụ, môi trường và mô hình; video/cache/xuất cần thêm dung lượng. Sau khi đã cài, nhập video từ máy và toàn bộ suy luận chạy offline. Tải video mạng vẫn cần Internet.

## Kiểm thử

```powershell
node --test tests/*.test.mjs
node scripts/smoke.mjs
node scripts/verify-ocr.mjs
node scripts/verify-end-to-end.mjs
node scripts/verify-whisper.mjs
```

Các kiểm thử video cần server đang chạy để đọc cấu hình. `verify-whisper` tải mẫu tiếng Trung công khai; các kiểm thử khác dùng video kiểm thử tự sinh. Xem **TEST-REPORT.md** để phân biệt kiểm thử thật, test giả lập giao thức và phần chưa kiểm chứng trên AMD.

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
