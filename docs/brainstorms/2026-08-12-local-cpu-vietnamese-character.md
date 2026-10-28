# AIRI: LLM local CPU-only + tiếng Việt + character riêng

> Ngày: 2026-08-12
> Mục tiêu: biến AIRI thành AI character chạy LLM local, không cần GPU, RAM thấp, tiếng Việt tốt,
> thay được Live2D / ảnh PNG, có tính cách riêng, sau này thêm TTS/STT local.
>
> Phạm vi: khảo sát code hiện có + lựa chọn model bên ngoài. Không sửa code, không đề xuất refactor.

## 0. Kết luận nhanh

| Mục tiêu | Trạng thái trong AIRI hôm nay |
| --- | --- |
| LLM local, CPU-only | **Sẵn sàng.** Ollama / LM Studio / OpenAI-compatible là provider hạng nhất. AIRI *không* nhúng runtime LLM — bạn chạy server riêng, AIRI chỉ là client. |
| Tiếng Việt | **Phụ thuộc hoàn toàn vào model bạn chọn.** Code không có gì chặn; UI đã có locale `vi`. |
| RAM thấp | **Khả thi ~4–6 GB tổng.** Điểm tốn nhất là LLM, không phải AIRI. |
| Thay Live2D | **Sẵn sàng.** Upload `.zip` + validator + lưu IndexedDB/OPFS. |
| Thay ảnh PNG | **Sẵn sàng.** Định dạng `.tachie.zip` (1 ảnh / 1 cảm xúc). |
| Character riêng | **Sẵn sàng.** Character Card v3 (CCv3), import/export cả bộ kèm model. |
| TTS local tiếng Việt | **Cần server ngoài.** TTS local nhúng sẵn (Kokoro) *không có tiếng Việt*. |
| STT local tiếng Việt | **Cần server ngoài.** Provider "local" trong app còn là `<WIP />`. |

---

## 1. LLM local

### 1.1 AIRI nối provider như thế nào

Đang có **hai hệ provider song song**, và hệ mới thắng:

- Hệ mới (khai báo bằng `defineProvider`): `packages/stage-ui/src/libs/providers/providers/` — mỗi provider một thư mục,
  đăng ký qua `import` trong `packages/stage-ui/src/libs/providers/providers/index.ts:1`.
- Hệ cũ (metadata viết tay): `packages/stage-ui/src/stores/providers.ts:352` (`providerMetadata`).
- Cầu nối: `packages/stage-ui/src/stores/providers.ts:2332` — provider của hệ mới được dịch sang metadata cũ và
  **luôn ghi đè** entry cũ cùng id. Hệ cũ chỉ còn là fallback cho provider chưa di trú (chủ yếu speech/transcription).

Tất cả provider `chat` cuối cùng đều gọi qua `xsai`; store `useLLM` bọc lại ở
`packages/stage-ui/src/stores/llm.ts:19`.

### 1.2 Provider dùng được cho local

| Provider | id | Base URL mặc định | File |
| --- | --- | --- | --- |
| Ollama | `ollama` | `http://localhost:11434/v1/` | `packages/stage-ui/src/libs/providers/providers/ollama/index.ts:12` |
| LM Studio | `lm-studio` | `http://localhost:1234/v1/` | `packages/stage-ui/src/libs/providers/providers/lm-studio/index.ts:15` |
| OpenAI Compatible | `openai-compatible` | (tự nhập) | `packages/stage-ui/src/libs/providers/providers/openai-compatible/index.ts:21` |

`openai-compatible` là cửa cho **llama.cpp `llama-server`**, vLLM, hay bất cứ thứ gì nói OpenAI API.

Ollama còn được xếp vào nhóm provider "thiết yếu" của onboarding và **không thuộc nhóm cần API key**
(`packages/stage-ui/src/stores/onboarding.ts:8`) → hiện ngay ở bước cài đặt đầu tiên, không cần nhập gì.

### 1.3 Cấu hình cần làm & chỗ dễ mắc

1. **CORS là cái bẫy số 1.** AIRI là web app (kể cả bản Electron), nên Ollama phải cho phép origin của nó.
   Chính validator của Ollama đã ghi rõ cách xử lý — đặt `OLLAMA_ORIGINS=*` hoặc
   `OLLAMA_ORIGINS=https://airi.moeru.ai,http://localhost` **trước khi** khởi động Ollama
   (`packages/stage-ui/src/libs/providers/providers/ollama/index.ts:176`).
   LM Studio thì bật "Enable CORS" trong tab Local Server (`.../lm-studio/index.ts:64`).
2. **Base URL phải có `/v1/`** và là URL tuyệt đối; validator từ chối nếu thiếu host
   (`.../ollama/index.ts:138-156`).
3. **Model chọn ở đâu:** provider + model của "consciousness" (não chat) lưu trong localStorage
   `settings/consciousness/active-provider` và `settings/consciousness/active-model`
   (`packages/stage-ui/src/stores/modules/consciousness.ts:12`).
4. **`thinkingMode`** của Ollama: mặc định `auto` (không gửi field `think`). Với model nhỏ CPU nên để `auto`
   hoặc `disable` cho nhanh; `disable` với model gpt-oss sẽ tự hạ thành `low` vì gpt-oss không nhận boolean
   (`.../ollama/index.ts:44-56`).

### 1.4 Không có chỗ nào chặn — nhưng cũng không có runtime nhúng

Đã grep toàn repo: **không** có `webllm`, `web-llm`, `transformers.js` cho text-gen, `wllama`, `llama.cpp`,
`node-llama`. `crates/` (Tauri cũ) đã rỗng. Nghĩa là AIRI **không tự chạy LLM**; nó luôn là client HTTP.
→ Đây thực ra là điểm tốt cho mục tiêu CPU-only: bạn toàn quyền chọn runtime (llama.cpp/Ollama) và tinh chỉnh
số thread, context, quantize — không bị AIRI ràng buộc.

Hai điểm giúp model nhỏ sống được:

- **Tool calling tự tắt khi model không hỗ trợ.** Nếu provider trả lỗi liên quan tool, AIRI ghi nhớ và bỏ tool
  cho cặp (model, provider) đó: `packages/stage-ui/src/stores/llm.ts:39-43`. Tương tự có auto-degrade
  content-part array về string thuần (`llm.ts:46-56`).
- **Tool mặc định rất ít.** Web search chỉ bật khi có Tavily API key, MCP/debug/spark tool cũng có cổng riêng
  (`packages/stage-ui/src/stores/llm-tool-resolver.ts:20-50`). System prompt gốc nhỏ, phần dài nhất là danh sách
  cảm xúc (`packages/stage-ui/src/constants/prompts/system-v2.ts:9-13`).
  → Cấu hình tối giản có prompt ngắn, rất quan trọng với tốc độ CPU (prefill là phần chậm nhất).

### 1.5 Lựa chọn model CPU + tiếng Việt

> ⚠️ Bảng dưới tổng hợp từ tra cứu web tháng 8/2026, **chưa tự benchmark trên máy bạn**. Con số tok/s là ước lượng
> cho CPU desktop/laptop hiện đại (AVX2/AVX-512), llama.cpp/Ollama, Q4_K_M.
> Đặc biệt: **không tìm thấy benchmark tiếng Việt riêng cho lớp 4B** — chất lượng tiếng Việt cần bạn tự thử.

| Model | Quantize | Dung lượng ~ | RAM khi chạy (ctx 4k) | tok/s ước lượng | Tiếng Việt | Ghi chú |
| --- | --- | --- | --- | --- | --- | --- |
| **Qwen3.5 4B** | Q4_K_M | ~2.5 GB | ~3.0–3.5 GB | ~8–14 | Tốt (dòng Qwen công bố phủ 201 ngôn ngữ) | Cân bằng tốt nhất; có tool calling |
| Qwen3.5 ~1.7–2B | Q4_K_M | ~1.2–1.4 GB | ~1.8–2.2 GB | ~18–30 | Khá, hay sai chính tả/ngữ pháp dài | Chọn khi RAM < 4 GB hoặc cần phản hồi tức thì |
| Gemma 4 E4B | Q4_K_M | ~3 GB | ~3.5–4 GB | ~7–12 | Khá | Đa ngôn ngữ ổn, nhưng nặng hơn Qwen cùng lớp |
| PhoGPT-4B-Chat | Q4_K_M | ~2.4 GB | ~3 GB | ~8–13 | Bản ngữ Việt (VinAI, 3.7B tham số) | Model 2023: khả năng theo chỉ thị và tool calling yếu hơn hẳn thế hệ 2026 → **không nên làm não chính cho AIRI** |

**Khuyến nghị: Qwen3.5 4B, Q4_K_M, chạy bằng Ollama.**

Lý do: (1) đa ngôn ngữ mạnh nhất trong lớp ~4B nên tiếng Việt tự nhiên hơn model 1–2B rõ rệt; (2) hỗ trợ tool
calling — AIRI dùng tool cho widget/tìm kiếm/mod; (3) ~3 GB RAM và ~10 tok/s là mức "không quá chậm" cho hội thoại
character (câu trả lời 60–100 token → 6–10 giây); (4) Ollama cắm vào AIRI không cần API key, chỉ cần set
`OLLAMA_ORIGINS`.

Mẹo giảm RAM/tăng tốc, không cần đổi model:
- Giới hạn context `num_ctx` 2048–4096 (KV cache là phần RAM đội lên khi chat dài).
- Tắt thinking (`thinkingMode: disable`) — với character chat, chuỗi suy luận chỉ làm tăng độ trễ.
- Nếu RAM rất chật, hạ xuống Q4_K_S hoặc IQ4_XS thay vì nhảy xuống model 1.7B: mất chất lượng ít hơn.

---

## 2. Nhân vật / tính cách riêng

### 2.1 Chuẩn dùng: Character Card v3

AIRI dùng CCv3 (chuẩn card của cộng đồng, họ SillyTavern) qua package `@proj-airi/ccc`
(`packages/ccc/README.md`), rồi bọc thêm một extension riêng:

`packages/stage-ui/src/types/airiCard.ts:10` — `AiriExtension` gắn trong `card.extensions.airi`, chứa:

- `modules.consciousness` `{ provider, model }` — **card ghim luôn provider/model** → mỗi nhân vật có thể dùng một
  LLM khác nhau.
- `modules.speech` `{ provider, model, voice_id, pitch?, rate?, language? }`.
- `modules.displayModelId` — trỏ tới model hiển thị trong store display-models (`airiCard.ts:50`).
- `modules.live2d` / `modules.vrm` — nguồn `file` hoặc `url`.
- `agents: Record<string, { prompt, enabled? }>` — prompt phụ theo agent.

### 2.2 System prompt được ghép từ đâu

`packages/stage-ui/src/stores/modules/airi-card.ts:23-38` — nối theo thứ tự:

```
card.systemPrompt → card.description → card.personality → card.scenario
  → extensions.airi.modules.artistry.widgetInstruction
```

Các phần rỗng bị lọc bỏ, nối bằng dòng trống. Comment tại `airi-card.ts:26` nói rõ: các field CCv3 phụ thuộc vị trí
(ví dụ `post_history_instructions`) **bị cố ý loại** cho tới khi tầng ghép message quản lý được thứ tự/role.
→ Nếu bạn viết tính cách vào `post_history_instructions` thì nó **sẽ không có tác dụng**.

**Với model nhỏ CPU:** viết gọn. Toàn bộ 4 field trên nằm trong mỗi request, nên prompt 2000 token sẽ ăn thẳng vào
thời gian prefill mỗi lượt. Nhắm ~200–400 token cho tính cách.

### 2.3 Lưu ở đâu

localStorage, không phải file:
- `airi-cards` — `Map<string, AiriCard>` (`airi-card.ts:43`)
- `airi-card-active-id` — mặc định `'default'` (`airi-card.ts:44`)

→ Xóa dữ liệu site / đổi máy là mất. **Hãy export ra file để backup.**

### 2.4 Đóng gói & chia sẻ: `airi-character-card`

`packages/stage-ui/src/services/airi-card-import-export.ts` định nghĩa một zip mang cả nhân vật lẫn ngoại hình:

```
<name>.zip
├── manifest.json      # format: "airi-character-card", version: 1
├── card.json          # CCv3 (chara_card_v3 / 3.0)
└── models/body-model.{zip|tachie.zip|vrm}
```

- Format hỗ trợ đóng kèm: Live2D zip, Spine zip, Tachie zip, VRM (`airi-card-import-export.ts:18-23`).
- Export: `exportAiriCardPackage()` (`:80`). Import: `importAiriCardPackage()` (`:107`).
- **Giới hạn có chủ ý** (JSDoc tại `:72-79`): đây *không* phải backup lossless. Chỉ các field người gửi xem được
  trong editor + một tập module AIRI đã lọc + display model được đưa vào. Extension lạ, `agents` prompt, và tham
  chiếu cục bộ theo máy **bị bỏ**. Import cũng đi qua đúng whitelist đó (`:101-105`) nên card tải về từ người khác
  không thể nhét prompt ẩn vào state của bạn.

Trang UI: `packages/stage-pages/src/pages/settings/airi-card/index.vue:283` (nhận `.zip`).

---

## 3. Đổi ngoại hình

Cả hai đi qua **cùng một dialog**: `packages/stage-ui/src/components/scenarios/dialogs/model-selector/model-selector.vue`
→ validate → hiện report → mới ghi vào store.

Store: `packages/stage-ui/src/stores/display-models.ts:8` (enum format) — lưu file vào **IndexedDB**
(`display-models.ts:117` `addDisplayModel`), Live2D còn đăng ký thêm loader OPFS (`display-models.ts:210`).

### 3.1 Live2D (zip cộng đồng)

Thao tác: Settings → chọn model → upload `.zip`. Validate trước bằng `validateLive2DZip()`
(`model-selector.vue:63`), rồi `addDisplayModel(DisplayModelFormat.Live2dZip, file)` (`model-selector.vue:85`).

Validator (`packages/stage-ui-live2d/src/utils/live2d-validator.ts:21`) trả `VALID | WARNING | INVALID` kèm
`entryPoint`, `structureType`, `errors`, `warnings`, `mocInfo` → biết ngay zip có dùng được không.

Điểm dễ chịu với zip cộng đồng:
- **Tự sửa mojibake tên file.** Zip từ VTube Studio hay lưu tên không cờ UTF-8; loader và validator dùng chung
  `decodeZipFileName` để tên tiếng Trung/Nhật không thành rác (`live2d-zip-loader.ts:9-13`).
- **Bỏ rác macOS** `__MACOSX`, `._*` (`live2d-zip-loader.ts:19-22`).
- **Thiếu `.model3.json` vẫn cứu được**: nếu zip có đúng 1 file `.moc3`, validator/loader tự dựng settings giả
  (`live2d-validator.ts:45-47`, `live2d-zip-loader.ts:30-35`).
- Tự rút `.cdi3.json` và các `.exp3.json` để làm expression (`live2d-zip-loader.ts:51-59`).

**Giới hạn quan trọng:** toàn bộ đường dẫn dùng `pixi-live2d-display/cubism4` (`live2d-zip-loader.ts:5`) và chỉ tìm
`.moc3` (`live2d-zip-loader.ts:128`) → **chỉ Cubism 3/4/5**. Model Cubism 2.1 (`.moc` + `model.json`) không load
được. Khi đi săn zip, lọc bỏ ngay loại này.

Sau khi nạp, panel Live2D cho chỉnh tỉ lệ/vị trí, hoạt ảnh (eye-tracking, chớp mắt, idle motion) và **biểu cảm**
(`packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue:709`). Nhưng phần **chỉnh motion
map + export lại zip đã sửa hiện bị comment lại** trong source (`live2d.vue:290-328`) → chưa dùng được trong UI.
Chi tiết thao tác: xem [2026-08-12-huong-dan-thay-ngoai-hinh.md](./2026-08-12-huong-dan-thay-ngoai-hinh.md).

### 3.2 Ảnh PNG (tachie) — phương án nhẹ nhất

`packages/stage-ui-tachie/README.md`. Đây đúng là "thay ảnh PNG":

```
character.tachie.zip
├── neutral.png     ← bắt buộc
├── happy.webp
└── surprised.jpg
```

- Đuôi file **phải** là `.tachie.zip` (`packages/stage-ui-tachie/src/utils/tachie-archive.ts:10`, kiểm tra tại `:297`).
- Tên cảm xúc hợp lệ: `neutral, happy, sad, angry, think, surprised, awkward, question, curious`
  (`packages/stage-ui-tachie/src/constants/emotions.ts:7`), không phân biệt hoa/thường; thiếu cái nào thì fallback
  về `neutral`.
- **Mọi ảnh phải cùng kích thước pixel.**
- Cho phép bọc trong 1 thư mục con.
- Render bằng PixiJS trên canvas trong suốt; lưu scale/position/shadow.
- Không có lip-sync, không eye-tracking, không rig — cần những thứ đó thì phải dùng Live2D.

Thao tác: cùng dialog, `validateTachieZip()` (`model-selector.vue:98`) →
`addDisplayModel(DisplayModelFormat.TachieZip, file)` (`model-selector.vue:114`).

---

## 4. TTS / STT local

### 4.1 Repo đang có gì

| Provider (id) | Loại | Thực trạng |
| --- | --- | --- |
| `kokoro-local` | TTS chạy trong trình duyệt | **Chạy được thật.** `kokoro-js` + WebGPU/WASM, có UI 216 dòng (`packages/stage-pages/src/pages/settings/providers/speech/kokoro-local.vue`), khai báo tại `packages/stage-ui/src/stores/providers.ts:2105` |
| `browser-web-speech-api` | STT | Có UI thật (`.../transcription/browser-web-speech-api.vue`); khai báo `providers.ts:929` |
| `openai-compatible-audio-speech` | TTS qua HTTP | Có UI thật; `providers.ts:684` |
| `openai-compatible-audio-transcription` | STT qua HTTP | Có UI thật; `providers.ts:820`. Không list được model (`providers.ts:831`) → phải tự gõ tên model |
| `app-local-audio-speech` / `-transcription` | TTS/STT trong app Electron | **`<WIP />`** — trang chỉ có placeholder. Chỉ hiện với stage-tamagotchi (`providers.ts:384`, `:415`) |
| `browser-local-audio-speech` / `-transcription` | TTS/STT trong browser | **`<WIP />`**. Gate `isBrowserAndMemoryEnough` (`providers.ts:330`) |

Ngoài ra có **hạ tầng đã viết nhưng chưa nối**: adapter Whisper
(`packages/stage-ui/src/libs/inference/adapters/whisper.ts`) và composable `useWhisper`
(`packages/stage-ui/src/composables/whisper.ts:20`). Grep toàn repo: **không page/store nào gọi `useWhisper`** →
chưa có provider `whisper-local`. Comment tại `packages/stage-ui/src/composables/use-inference-preload.ts:63-68`
xác nhận: model Whisper mặc định `onnx-community/whisper-large-v3-turbo`
(`packages/stage-ui/src/libs/inference/constants.ts:15`) nặng ~800 MB, cố ý **không** preload.

Đường ống STT thật đang chạy qua `generateTranscription` của xsai
(`packages/stage-ui/src/stores/modules/hearing.ts:10`, gọi tại `:498`) → tức là endpoint
`/v1/audio/transcriptions`. VAD dùng worklet riêng (`hearing.ts:14`, silero-vad).

### 4.2 Chặn lớn nhất cho tiếng Việt: Kokoro không có tiếng Việt

Bảng ngôn ngữ của `kokoro-local` tại `packages/stage-ui/src/stores/providers.ts:2253-2263` chỉ có:
`en-US, en-GB, ja, zh-CN, es, fr, hi, it, pt-BR`. **Không có `vi`.**

→ TTS local nhúng sẵn dùng được cho tiếng Anh/Nhật, **không dùng được cho tiếng Việt**.

### 4.3 Đường đi khả thi cho tiếng Việt: server ngoài, OpenAI-compatible

Đây là điểm nối rẻ nhất vì AIRI đã có sẵn hai provider "OpenAI Compatible" cho cả speech và transcription.

**TTS** (`openai-compatible-audio-speech`, base URL trỏ về máy bạn):

| Giải pháp | CPU? | Ghi chú |
| --- | --- | --- |
| **VietTTS** (`dangvansam/viet-tts`) | Có | **Tự nhận tương thích OpenAI TTS API** → gần như cắm là chạy. Cài bằng pip (Linux) hoặc Docker. Có voice cloning |
| **VieNeu-TTS** (`pnnbao97/VieNeu-TTS`) | Có, realtime | 24 kHz, voice cloning tức thì, thiết kế cho on-device. **Chưa xác minh có sẵn endpoint OpenAI-compatible hay phải tự bọc** |
| Piper + voice `vi_VN` | Có, nhẹ nhất | Piper là lựa chọn nhẹ nhất cho CPU/Raspberry Pi; cần tự bọc HTTP theo dạng OpenAI |
| F5-TTS-Vietnamese (`hynt/F5-TTS-Vietnamese-ViVoice`) | Chậm trên CPU | Chất lượng cao nhưng weight F5-TTS là **CC-BY-NC** — chỉ dùng cá nhân, không thương mại |

**STT** (`openai-compatible-audio-transcription`, tự gõ tên model vì không list được):

- **PhoWhisper** (VinAI, `vinai/PhoWhisper-{tiny,base,small,medium,large}`): fine-tune Whisper trên 844 giờ tiếng
  Việt nhiều vùng miền → chính xác hơn Whisper gốc cho tiếng Việt. Dùng `PhoWhisper-base`/`small` cho CPU.
- Cách phục vụ: bọc bằng một server nói `/v1/audio/transcriptions` (faster-whisper / whisper.cpp server).
  **Chưa xác minh** đã có bản ggml/CTranslate2 chuyển sẵn của PhoWhisper hay bạn phải tự convert — đây là việc cần
  kiểm tra trước khi chốt.
- Phương án 0 công: `browser-web-speech-api` nhận tiếng Việt sẵn. Nhưng **lưu ý**: trên Chrome nó gửi audio lên
  server Google → *không phải* local. (Chưa xác minh hành vi trong Electron.)

---

## 5. Ngân sách RAM cho cấu hình đề xuất

Cấu hình: Qwen3.5 4B Q4_K_M trên Ollama + AIRI (Electron) + Live2D hoặc tachie + VietTTS + PhoWhisper-base.

| Thành phần | RAM ước lượng | Ghi chú |
| --- | --- | --- |
| LLM Qwen3.5 4B Q4_K_M, ctx 4k | **~3.0–3.5 GB** | Weight ~2.5 GB + KV cache. Hạ ctx 2k tiết kiệm vài trăm MB |
| AIRI renderer (Chromium + Pixi/Live2D) | ~0.5–1.0 GB | **Chưa đo trên máy thật.** Tachie nhẹ hơn Live2D rõ rệt |
| TTS VietTTS (server ngoài) | ~1.0–2.0 GB | Model neural + runtime Python; Piper thì chỉ ~50–150 MB |
| STT PhoWhisper-base (server ngoài) | ~0.2–0.4 GB | `large` thì ~2–3 GB → tránh |
| **Tổng** | **~4.5–6.5 GB** | Vừa máy 8 GB nếu không mở nhiều thứ khác |

Đánh đổi nếu cần xuống dưới 4 GB:
- Đổi TTS sang **Piper** (mất tự nhiên, được ~1.5 GB và tốc độ).
- Dùng **tachie PNG** thay Live2D (bớt WebGL + texture).
- Hạ LLM về lớp 1.7–2B (tiếng Việt kém rõ rệt — nên coi là lựa chọn cuối).
- Bật TTS/STT **theo yêu cầu** thay vì chạy thường trú; AIRI đã cố ý không preload model nặng
  (`use-inference-preload.ts:63-68`).

Thứ tự làm cho ít rủi ro nhất: (1) Ollama + Qwen3.5 4B + CORS → (2) viết card CCv3 cho nhân vật →
(3) nạp Live2D zip hoặc tachie → (4) VietTTS → (5) PhoWhisper.

---

## 6. Đã kiểm chứng vs. chưa kiểm chứng

**Đọc code trực tiếp (chắc chắn):** toàn bộ mục 1.1–1.4, 2, 3, 4.1, 4.2 — mọi trích dẫn `file:line`.
Bao gồm: không có runtime LLM nhúng; 4 provider local audio là `<WIP />`; `useWhisper` chưa được dùng ở đâu;
Kokoro không có `vi`; Live2D chỉ Cubism 3/4/5.

**Từ tra cứu web 8/2026, chưa chạy thử:** tên và dung lượng model ở mục 1.5; số tok/s; RAM ở mục 5;
sự tồn tại/đặc tính của VietTTS, VieNeu-TTS, PhoWhisper.

**Chưa xác minh, cần kiểm tra trước khi chốt:** benchmark tiếng Việt cho lớp 4B (không tìm thấy số liệu);
PhoWhisper có bản ggml/CTranslate2 sẵn hay không; VieNeu-TTS có endpoint OpenAI-compatible hay không;
Web Speech API trong Electron gửi audio đi đâu; RAM thật của renderer AIRI.

---

## 7. Câu hỏi mở / chỗ cần đi sâu

1. **Chốt model tiếng Việt bằng thử nghiệm thật.** Chưa có benchmark tiếng Việt cho lớp 4B. Nên dựng một bộ prompt
   tiếng Việt (hội thoại nhân vật, giữ giọng điệu, không chêm tiếng Anh) và chạy so Qwen3.5 4B vs Gemma 4 E4B vs
   bản 1.7B để biết mức nhỏ nhất còn chấp nhận được.
2. **Viết card CCv3 cụ thể cho nhân vật của bạn.** Cần biết phân bổ chữ giữa `systemPrompt` / `description` /
   `personality` / `scenario` — vì cả 4 đều nối vào mỗi request, ngân sách token là ràng buộc thật trên CPU.
3. **`agents` prompt và `post_history_instructions`.** Card có `agents: Record<string, {prompt}>` nhưng
   `resolveSystemPrompt` không dùng, còn field CCv3 phụ thuộc vị trí thì bị loại có chủ ý. Cần đào xem prompt phụ
   thực sự chảy vào đâu nếu bạn muốn kiểm soát giọng điệu sâu hơn.
4. **Nối STT local tử tế.** Adapter Whisper + `useWhisper` đã có nhưng chưa có provider. Chọn giữa: bọc PhoWhisper
   sau một server OpenAI-compatible (ít việc, ngoài app) vs. nối `useWhisper` thành provider `whisper-local` trong
   app (nhiều việc, gọn cho người dùng cuối).
5. **Voice tiếng Việt cho `kokoro-local`.** Cần xem có thêm được `vi` vào bảng ngôn ngữ + voice hay giới hạn nằm ở
   chính model Kokoro (khả năng cao là ở model → phải đi đường server ngoài).
6. **Đo RAM/độ trễ thật end-to-end.** Từ lúc nói xong đến lúc nhân vật mở miệng gồm STT + prefill + decode + TTS.
   Cần đo để biết nút thắt ở đâu trước khi tối ưu.
7. **Backup card.** Card chỉ nằm trong localStorage. Nếu định làm nhiều nhân vật, nên dựng thói quen/tool export
   `airi-character-card` zip định kỳ.
8. **Lip-sync với tachie.** Tachie không có lip-sync. Nếu bạn muốn nhân vật "mở miệng" mà vẫn dùng PNG, cần xem
   `packages/model-driver-lipsync` hỗ trợ tới đâu (hiện chỉ thấy nhánh `live2d`).

---

## 8. Nguồn tra cứu ngoài (8/2026)

LLM chạy CPU & quantize:
- [Best CPU-only local LLMs in 2026](https://www.popularai.org/p/best-cpu-only-local-llm)
- [CPU-Only LLM 2026: Phi-4 Mini Runs 12 tok/s, No GPU](https://www.promptquorum.com/local-llms/best-cpu-only-llm)
- [LLM Quantization Guide: GGUF vs AWQ vs GPTQ (2026)](https://www.premai.io/blog/llm-quantization-guide-gguf-vs-awq-vs-gptq-vs-bitsandbytes-compared-2026/)
- [Gemma 4 vs Qwen 3.5 vs Llama 4: Updated Benchmarks](https://ai.rs/ai-developer/gemma-4-vs-qwen-3-5-vs-llama-4-compared)
- [Best Open Source LLM For Vietnamese In 2026](https://www.siliconflow.com/articles/en/best-open-source-LLM-for-Vietnamese)

Model tiếng Việt:
- [PhoGPT: Generative Pre-training for Vietnamese (arXiv)](https://arxiv.org/pdf/2311.02945)
- [awsome-vietnamese-nlp](https://github.com/vndee/awsome-vietnamese-nlp)

TTS tiếng Việt:
- [VietTTS — dangvansam/viet-tts (tương thích OpenAI TTS API)](https://github.com/dangvansam/viet-tts)
- [VieNeu-TTS — realtime CPU, voice cloning](https://github.com/pnnbao97/VieNeu-TTS)
- [hynt/F5-TTS-Vietnamese-ViVoice](https://huggingface.co/hynt/F5-TTS-Vietnamese-ViVoice)
- [Best Local TTS Models 2026](https://localaimaster.com/blog/best-local-tts-models)

STT tiếng Việt:
- [PhoWhisper: ASR for Vietnamese (arXiv)](https://arxiv.org/abs/2406.02555)
- [VinAIResearch/PhoWhisper](https://github.com/VinAIResearch/PhoWhisper)
- [vinai/PhoWhisper-base](https://huggingface.co/vinai/PhoWhisper-base)
