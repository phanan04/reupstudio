# Dịch có ngữ cảnh và luồng CapCut

## Sử dụng

1. Tạo phụ đề Trung trong CapCut và xuất SRT. Trong Việt Studio chọn dự án rồi **Nhập phụ đề CapCut**; có thể chọn nhiều SRT. Không cần video.
2. Mở **Tri thức**: nhập cốt truyện, thuật ngữ Trung–Việt, nhân vật với ID ổn định, và quan hệ có chiều người nói → người nghe. Ví dụ em_gai → chi_gai: tự xưng `em`, gọi `chị`; chiều ngược lại phải có quy tắc riêng.
3. Ghi chú sự kiện theo số tập. Số 0 là quy ước chung. Ghi chú tập N chỉ được truy xuất khi dịch tập sau N. Đặt lại thứ tự tập trong **Duyệt dịch → Xử lý nhiều tập** nếu thứ tự nhập khác thứ tự truyện.
4. Chọn câu → **Nhân vật & duyệt câu** để gán người nói/người nghe/cảnh. Chưa gán thì giữ trạng thái chưa xác định; hệ thống không có diarization tự động.
5. Bấm **Dịch SRT**. Hàng đợi xử lý tuần tự, bỏ qua câu đã có lời Việt. Mở **Duyệt dịch** xem cảnh báo quy tắc và kết quả AI. Bấm một cảnh báo để đến câu; áp dụng đề xuất là thao tác riêng của người dùng.
6. Sửa lời Việt rồi **Duyệt câu & ghi nhớ**, hoặc xác nhận đã duyệt tất cả. Chỉ các câu được duyệt mới vào Translation Memory. Có thể bỏ duyệt. Sửa nội dung hoặc nhân vật sẽ làm bản ghi cũ không còn hợp lệ.
7. Tải **SRT tiếng Việt**, nhập lại CapCut. Cần dịch đủ câu trước khi tải. Thời gian gốc không bị bộ dịch, bộ nhớ hay kiểm tra AI thay đổi; chỉ thao tác chỉnh thời gian thủ công thay đổi timestamp.

## Bộ dịch và phần cứng

- Ollama native `/api/chat`, JSON schema, Qwen3 4B Instruct Q4; context 4096, batch dịch 4 câu, QA tối đa 3 câu, một mô hình/một tác vụ. Đây là cấu hình khởi đầu cho 6 GB VRAM, chưa có benchmark RX 5600 XT thực.
- Laptop hiện chọn CPU. Trên máy AMD bỏ chọn **Chạy LLM bằng CPU**, giữ **thử CPU khi lỗi GPU**. Ollama thử lại với `num_gpu:0` khi nhận lỗi server 500/503/507. Không tự đổi sang OPUS khi chất lượng LLM chưa đạt.
- RX 5600 XT không trong danh sách ROCm Windows chính thức; thử Vulkan với driver phù hợp. CPU là đường chạy được kiểm chứng. [Ollama hardware support](https://docs.ollama.com/gpu).
- llama.cpp cũ vẫn được hỗ trợ. Thư viện bị Windows chặn vẫn được giữ dấu chặn; không thay đổi bảo mật để chạy lại.
- OPUS có checkpoint và có thể dùng lại TM chính xác, nhưng không suy luận ngữ cảnh hay kiểm tra ngữ nghĩa AI. UI phân biệt `rules_only` rõ ràng.
- API tương thích Chat Completions là lựa chọn riêng, mặc định tắt. Nhập HTTPS URL, model, tên biến môi trường khóa (mặc định `VIETSTUDIO_AI_KEY`), rồi bật cho phép gửi dữ liệu. Khi chọn API, phụ đề và ngữ cảnh liên quan rời máy tới endpoint đó. Không dùng phiên đăng nhập ChatGPT trong trình duyệt. Khóa không ghi SQLite hoặc trả qua API settings; không tự chuyển sang API khi local lỗi.

## Cài Ollama

Có thể dùng Ollama chính thức đã cài hoặc runtime portable trong `tools/ollama-local`. Bộ cài `scripts/install-ollama-lite.py` lấy CPU/Vulkan từ ZIP chính thức qua HTTPS, kiểm CRC từng thành viên và chữ ký Windows; tránh tải thư viện CUDA không dùng. Bản đầy đủ `install-ollama.py` kiểm SHA256 toàn ZIP.

Trên bản đã chuẩn bị, `Start.cmd` tự mở runtime portable khi chọn Ollama localhost:11434 và chưa có Ollama đang chạy; mô hình lưu trong `models/ollama`, cloud tắt. Nếu đổi bộ dịch từ OPUS sang Ollama khi server đã mở, khởi động lại Start.cmd hoặc mở Ollama trước.

Khi cài máy mới: chạy Ollama với `OLLAMA_MODELS` trỏ thư mục `models/ollama` của dự án rồi `ollama pull qwen3:4b-instruct`. Không cần tải lại nếu đã chuyển mô hình. Không mang khóa `.ollama` của người dùng sang máy khác.

## Cơ chế và giới hạn

SQLite được mở rộng thêm knowledge, approvals, translation_memory; không xây lại pipeline video. Tri thức có version và chống ghi đè bản cũ. Trước nâng cấp đã sao lưu DB tại `data/backups/before-context-v2.sqlite`.

Context bao gồm câu trước/sau, quy ước dự án, người nói/người nghe, thuật ngữ khớp nguồn và bằng chứng RAG có nguồn. RAG hiện dùng BM25 từ khóa/từ kép tiếng Trung trên CPU, không cần embedding/GPU. Truy xuất từ ghi chú đã xác nhận và các bản dịch đã duyệt trong cùng dự án, không dùng tập tương lai. Đây là retrieval lexical, chưa có semantic embedding hay tóm tắt truyện tự động.

TM tự điền chỉ khi nguồn, người nói/nghe, cảnh, câu lân cận và phiên bản quy ước khớp, và không có nhiều bản dịch mâu thuẫn. Khớp gần chỉ làm ví dụ RAG. Cache máy khác TM đã duyệt: cache tránh gọi lại cùng yêu cầu, không có nghĩa là bản dịch đúng.

Mỗi batch dịch được lưu ngay vào SQLite với revision/checkpoint. QA cache từng batch theo model, nội dung, tri thức. Chạy lại sau lỗi không dịch lại câu đã có. Khi thay quy ước, bản dịch cũ được giữ; chủ động dùng **Dịch lại các câu chưa duyệt**. Câu được duyệt được bảo vệ; muốn dịch lại phải bỏ duyệt.

AI kiểm tra là một lượt đánh giá độc lập về prompt, mặc định dùng cùng mô hình. Có thể bỏ sót và báo nhầm; không phải chứng nhận chất lượng. Mô hình 4B có thể sai thành ngữ, mốc thời gian và xưng hô. Nếu ASR/OCR sai nguyên văn, cần nghe/xem lại hoặc dùng SRT CapCut tốt hơn; AI chỉ cảnh báo giả thuyết.

Input được giới hạn ngữ cảnh; bỏ bớt bằng chứng phụ trước khi vượt budget. Không cắt nội dung câu. Câu quá dài yêu cầu giảm batch/tăng context. Gọi API có timeout, retry có giới hạn và từ chối thiếu/trùng ID. Đề xuất AI không thay timestamps và không tự được duyệt.

## Kiểm thử

`node --test tests/*.test.mjs` kiểm tra API, SRT milliseconds, TM, RAG, scope tập/dự án, stale approval, checkpoint, schema, CPU fallback và cơ chế opt-in API.

`node scripts/evaluate-context.mjs` chạy OPUS/Qwen thật trên corpus kiểm thử có ngữ cảnh; `EVAL_MODEL=qwen3:4b-instruct` chọn model. `node scripts/evaluate-review.mjs` thử QA trên bản dịch có 3 lỗi cố ý. Kết quả thô trong `data/context-evaluation/latest.json`; xem báo cáo chất lượng đi kèm, không suy rộng corpus nhỏ thành độ chính xác chung.

## Ghi chú đa nền tảng

Hướng dẫn laptop Windows ở trên là lịch sử, không phải cấu hình bắt buộc cho máy hiện tại. Launcher chung hiện là `npm start`; Mac dùng Ollama native/PATH, Windows có thể dùng portable. Model store do launcher tạo mặc định `./models/ollama`; Ollama đã chạy giữ model store của nó. Trên Mac Intel, chọn OPUS sẽ chạy worker CPU trong Docker; cần Docker Desktop và image build lần đầu. Các máy khác mặc định OPUS native. Xem README trước khi setup/chuyển máy.

## Nhận diện/dịch tăng dần

Whisper CPU chuyển các đoạn đã nhận diện sang dịch theo thứ tự, có giới hạn một đoạn chờ và giữ hai câu cuối để bổ sung ngữ cảnh. Có thể sửa từng câu khi dịch; checkpoint chỉ điền câu trống chưa thay đổi. Pause/resume và thử lại câu lỗi giữ các câu đã sửa/duyệt. Xem [pipeline tăng dần](docs/STREAMING-PIPELINE.md) cho cách dùng, phép đo và các giới hạn ASR/timestamp.
