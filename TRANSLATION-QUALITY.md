# Kiểm thử chất lượng thực tế — 27/09/2026

## Phạm vi và cấu hình

Chạy suy luận thật trên laptop Intel Iris Xe, 16 GB RAM, CPU 4 luồng; Ollama 0.34.4, `qwen3:4b-instruct` Q4, context 4096. Không dùng API trả phí. RX 5600 XT chưa có máy để benchmark.

Corpus 8 câu có ngữ cảnh: chị–em, chức danh, thành ngữ, lịch nghỉ của nhân viên phục vụ và phủ định. Đây là corpus chẩn đoán nhỏ, có thuật ngữ và bối cảnh soạn thủ công, không đại diện mọi thể loại/phim. Hai câu về lịch nghỉ/người phục vụ lấy nguyên văn từ phụ đề hiện có, các câu còn lại dùng tình huống kiểm thử. Không sửa phụ đề của người dùng trong quá trình đánh giá.

Kết quả thô: `data/context-evaluation/latest.json`. Bản thử Qwen3 gốc: `data/context-evaluation/qwen3-original.json`. Script tái chạy: `scripts/evaluate-context.mjs`, `scripts/evaluate-review.mjs`.

## Quan sát trực tiếp

| Nguồn | Qwen3 Instruct trả về | Đánh giá |
|---|---|---|
| 姐姐，我不是故意的。 | Chị ơi, em không cố ý đâu. | Đúng quan hệ chị–em đã cung cấp |
| 你别怕，姐姐会保护你。 | Em đừng lo, chị sẽ bảo vệ em. | Giữ chủ thể và chiều xưng hô |
| 他是她心中的白月光。 | Anh ấy là người yêu lý tưởng trong lòng cô. | Hiểu ẩn dụ, nhưng chưa dùng đúng chuỗi glossary “mối tình lý tưởng”; quy tắc phát hiện |
| 一月休两天太坑了。 | Nghỉ hai ngày tháng một quá tệ rồi. | Sai “mỗi tháng” thành “tháng một”; lượt QA đã chỉ ra và đề xuất sửa |
| 沈总，请您过目。 | Tổng giám đốc Thẩm, xin phép được trình bày. | Đúng tên chức danh, nhưng “过目” phải là xem qua tài liệu. QA có cảnh báo nhưng đề xuất vẫn chưa giải quyết nghĩa chính |
| 我没有说她偷了钱。 | Tôi không nói cô ấy lấy tiền. | Giữ phủ định |

8 câu dịch mất khoảng **58 giây** CPU trong lần chạy đo. Không dùng con số này để dự đoán trực tiếp cả tập phim vì tải mô hình, độ dài câu và lượng ngữ cảnh khác nhau. Timestamp của cả 8 câu giữ nguyên.

## Kiểm tra AI

Đưa vào ba lỗi cố ý: đảo chị–em (câu 1), dịch ẩn dụ thành ánh trăng vật lý (câu 4), đảo phủ định (câu 8). Lượt QA cuối dùng schema ràng buộc số phần tử và ID, 3 câu/batch, hoàn tất 8/8 câu trong khoảng **143 giây** CPU.

- Phát hiện đủ 3/3 lỗi cố ý trên corpus này.
- Phát hiện thêm lỗi “tháng một/mỗi tháng”.
- Cảnh báo câu 7 là đảo nghĩa dù thay đổi đề xuất chủ yếu là diễn đạt; đây là một cảnh báo thừa rõ ràng.
- Đề xuất cho câu 3 chưa sửa đúng “xin ông xem qua”. Mô hình kiểm tra dùng cùng Qwen, nên có thể cùng mắc lỗi với bộ dịch.

Bản QA ban đầu trả thiếu ID; hệ thống từ chối thay vì coi là đạt. Đã bổ sung JSON schema với đúng số câu và danh sách ID cho mỗi batch. Câu gốc/bản dịch được giữ ở checkpoint trong quá trình thử lại. Schema kiểm tra cấu trúc, không chứng minh đúng nghĩa.

## Kiểm thử kỹ thuật

20 kiểm thử tự động đạt, gồm API và luồng SRT không cần video: timestamp `00:00:01,123 → 00:00:03,456` và `00:00:05,007 → 00:00:06,890` giữ nguyên khi xuất; chặn tải SRT khi còn thiếu lời Việt; duyệt/bỏ duyệt; bảo vệ câu đã duyệt khi dịch lại; checkpoint sau lỗi; TM không lẫn dự án/người nói; RAG không lấy tập tương lai; bản ghi đã sửa không còn được dùng; Ollama CPU fallback; API cần bật rõ ràng trước khi gửi dữ liệu.

Chưa kiểm chứng: AMD Vulkan/AMF thực, endpoint API từ xa thực (chưa cấu hình khóa), nhận diện người nói tự động (chưa triển khai), đánh giá mù trên corpus lớn hoặc đối chiếu bởi biên dịch viên độc lập. Khuyến nghị duyệt các cảnh báo và tên/xưng hô trước xuất; TM chỉ học từ phần người dùng xác nhận.


## Kiểm chứng giao diện CapCut SRT

Nhập `capcut-flow.srt` qua file chooser của giao diện, lưu glossary/ngữ cảnh qua hộp Tri thức, chạy Qwen và QA thật, sửa hai câu trong vùng song song, duyệt cả hai và kiểm tra chúng xuất hiện trong bộ nhớ. SRT xuất thực tại `data/verification/capcut-flow-vi.srt` giữ nguyên mốc 1.123–3.456 và 5.007–7.890 giây. Ảnh giao diện: `data/verification/capcut-context-editor.png`; viewport 1366×768, document scrollHeight 768. Start.cmd đã được thử tự mở Ollama portable khi runtime chưa chạy.
