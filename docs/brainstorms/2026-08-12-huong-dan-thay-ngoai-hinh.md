# Hướng dẫn thay ngoại hình AIRI: Live2D và ảnh PNG (Tachie)

> Ngày: 2026-08-12
> Áp dụng cho: stage-web và stage-tamagotchi (desktop). Cùng một màn hình, cùng một luồng.
> Bổ sung cho [2026-08-12-local-cpu-vietnamese-character.md](./2026-08-12-local-cpu-vietnamese-character.md).

## 0. Đường đi chung — chỉ có một cửa

Mọi định dạng (Live2D, Tachie, VRM, Spine, MMD) đều đi qua **một dialog duy nhất**:

```
Settings → Models  ( /settings/models )
  → nút "Chọn mô hình"            (settings.model-select.select-model.button)
    → dialog "Chọn Mô Hình"
      → dropdown "Nhập"           (settings.model-select.select-model.import)
        → chọn Live2D / Tachie / VRM / Spine / MMD
```

Code: `packages/stage-ui/src/components/scenarios/settings/model-settings/panel.vue:100`
→ `packages/stage-ui/src/components/scenarios/dialogs/model-selector/model-selector.vue`.
Trang: `packages/stage-pages/src/pages/settings/models/index.vue`,
bản desktop `apps/stage-tamagotchi/src/renderer/pages/settings/models/index.vue`.

Ba điều cần nhớ trước khi bắt đầu:

1. **Nhập ≠ đang dùng.** Nhập xong model chỉ vào danh sách. Phải bấm **"Chọn"** trên thẻ model đó
   (desktop, `model-selector.vue:433`) hoặc **"Xác nhận"** ở cuối dialog (mobile, `:440`) thì stage mới đổi.
2. **Sai đuôi file = im lặng.** Nếu file không đúng đuôi, hàm xử lý `return` sớm và **không báo gì cả**
   (`model-selector.vue:60-61` cho `.zip`, `:95-96` cho `.tachie.zip`). Thấy bấm xong không có gì xảy ra thì
   kiểm tra tên file trước tiên.
3. **Renderer tự đổi theo định dạng.** Nạp `.tachie.zip` thì stage tự chuyển sang renderer `tachie`, nạp Live2D
   thì sang `live2d` (`packages/stage-ui/src/stores/settings/stage-model.ts:46-67`). Không phải chỉnh tay.

Có sẵn 2 model Live2D mẫu để thử ngay không cần tải gì: **Hiyori (Pro)** và **Hiyori (Free)**
(`packages/stage-ui/src/stores/display-models.ts:51-52`).

---

## A. Thay model Live2D (tải zip cộng đồng về dùng)

### A.1 Chuẩn bị: zip nào dùng được

| Yêu cầu | Chi tiết |
| --- | --- |
| Đuôi file | `.zip` |
| Phiên bản Cubism | **Chỉ Cubism 3 / 4 / 5** — zip phải có file `.moc3`. Cubism 2.1 (`.moc` + `model.json`) **không dùng được** |
| Điểm vào | Nên có `.model3.json`. Nếu không có mà zip chỉ chứa **đúng 1** file `.moc3` thì AIRI vẫn tự dựng được |
| Kích thước `.moc3` | > 30 MB → cảnh báo hiệu năng; > 100 MB → **từ chối** (vượt giới hạn bộ nhớ WASM của trình duyệt) |
| Tên file trùng | **Không được trùng basename ở bất kỳ đâu trong zip** (xem A.4) |

Giới hạn Cubism đến từ `pixi-live2d-display/cubism4`
(`packages/stage-ui-live2d/src/utils/live2d-zip-loader.ts:5`, chỉ tìm `.moc3` tại `:128`).

Tin tốt cho zip cộng đồng: loader **tự xử lý** hai thứ hay hỏng:
- Tên file mojibake (zip VTube Studio lưu tên tiếng Trung/Nhật không có cờ UTF-8) — decode lại bằng
  `decodeZipFileName` (`live2d-zip-loader.ts:9-13`).
- Rác macOS `__MACOSX/` và `._*` — bỏ qua (`live2d-zip-loader.ts:19-22`).

### A.2 Các bước

1. Settings → **Models**.
2. Bấm **"Chọn mô hình"**.
3. Trong dialog, mở dropdown **"Nhập"** → chọn **Live2D**.
4. Chọn file `.zip`.
5. AIRI chạy `validateLive2DZip()` (`model-selector.vue:63`):
   - **VALID và không lỗi** → nhập luôn, không hỏi gì.
   - **WARNING / INVALID** → hiện bảng báo cáo (`Live2DReportModal`) để bạn đọc rồi tự quyết.
6. Bấm **"Chọn"** trên thẻ model vừa nhập để đưa lên stage.

### A.3 Đọc bảng báo cáo

Báo cáo (`packages/stage-ui-live2d/src/utils/live2d-validator.ts:21`) gồm:

- `status`: `VALID` (không lỗi, không cảnh báo) / `WARNING` (chỉ có cảnh báo) / `INVALID` (có lỗi) — xác định tại `:149-153`.
- `entryPoint`: file `.model3.json` được chọn.
- `structureType`: `Standard (model3.json)` hoặc `Heuristic (Loose Files)`.
- `mocInfo`: header, sub-version, dung lượng của `.moc3`.
- `errors` / `warnings` / `checks`.

**`WARNING` vẫn nhập được** — bạn bấm xác nhận trong modal. **`INVALID` thì nên sửa zip trước**, vì lỗi ở đây là
lỗi thật (thiếu file, trùng tên, sai header), không phải cảnh báo hình thức.

### A.4 Lỗi hay gặp và cách sửa

| Thông báo | Nghĩa là gì | Sửa thế nào |
| --- | --- | --- |
| `BASENAME COLLISION: Filename "x.png" exists in multiple locations` | Hai file **cùng tên** ở hai thư mục khác nhau. Loader của AIRI đánh phẳng theo basename nên sẽ **mất dữ liệu** (`live2d-validator.ts:92`) | Giải nén, đổi tên cho không trùng (hoặc bỏ thư mục thừa/bản sao), nén lại. Hay gặp ở zip gộp nhiều bản model |
| `CASE SENSITIVITY MISMATCH: "a.png" expects ... but ZIP contains "A.png"` | `model3.json` trỏ sai hoa/thường. Windows bỏ qua, trình duyệt thì không (`:124`) | Sửa tên file trong zip cho khớp đúng chữ hoa/thường mà `model3.json` ghi (hoặc sửa `model3.json`) |
| `MISSING REFERENCE: Texture "..." not found in ZIP` | `model3.json` trỏ tới file không tồn tại (`:127`). Kiểm tra cả `Moc`, `Textures`, `Physics`, `Expressions` | Bổ sung file thiếu, hoặc xóa mục đó khỏi `FileReferences` trong `model3.json` |
| `Invalid MOC Header: "..." (Expected MOC3)` | File `.moc3` hỏng hoặc thực ra không phải MOC3 (`:65`) | Tải lại zip từ nguồn khác |
| `CRITICAL WEIGHT: MOC file is ... MB` (>100 MB) | Model quá nặng cho WASM trình duyệt (`:72`) | Không dùng được; tìm bản nhẹ hơn |
| `HEAVY RESOURCE: MOC file is ... MB` (>30 MB) | Cảnh báo hiệu năng (`:75`) | Vẫn chạy được, nhưng nên cân nhắc nếu máy yếu |
| `Invalid Structure: No .model3.json found and N .moc3 files` | Không có điểm vào, và có 0 hoặc ≥2 file `.moc3` (`:50`) | Tách zip sao cho mỗi zip chỉ 1 model, hoặc bổ sung `model3.json` |
| `JSON PARSE ERROR` | `model3.json` sai cú pháp (`:145`) | Mở bằng editor, sửa JSON |
| Bấm chọn file mà không có gì xảy ra | File không kết thúc bằng `.zip` (`model-selector.vue:60-61`) | Đổi tên đúng đuôi `.zip` |

### A.5 Tinh chỉnh sau khi nạp

Panel **"Cài đặt Live2D"** (`packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue`):

- **Tỉ lệ và vị trí** (`:227`): `scale` 0.1–3.0, `X`/`Y` từ −3000 đến 3000. Mỗi thanh có nút reset về mặc định.
- **Hoạt ảnh** (`:330`): bật theo dõi chuột (eye tracking) + độ lệch mắt, chuyển động mắt idle, chớp mắt
  (tự động / ép bằng timer), chọn hoạt ảnh idle, giới hạn FPS.
- **Biểu cảm** (`:709`): bật/tắt override biểu cảm, bật/tắt từng nhóm expression để xem trước, chọn mức
  **expose cho LLM** (`none` / `all` / `custom` — chọn từng cái), **Lưu mặc định** và **Đặt lại**.
  Lưu ý: chuỗi `llm-integration-wip` cho thấy phần tích hợp expression vào LLM **vẫn đang hoàn thiện**.
- **Trích xuất màu từ mô hình** (`:269`): lấy màu chủ đạo từ canvas để áp lên theme AIRI. Thử nhiều lần với
  các tư thế khác nhau nếu màu chưa ưng.

**Chưa có trong UI:** phần **"Chỉnh bản đồ chuyển động"** (map motion → emotion) và nút **Export zip đã sửa**
hiện đang **bị comment lại** trong source (`live2d.vue:290-328`). Nghĩa là hôm nay bạn **không** sửa được motion
map trong app; muốn đổi thì phải sửa `model3.json` bên ngoài rồi nén lại và nhập lại.

Tương tự, các chuỗi i18n `settings.live2d.change-model.from-file` / `from-url` còn trong file dịch nhưng
**không component nào dùng** — không có đường "nạp model từ URL" trong UI hiện tại. Chỉ có nhập file.

---

## B. Thay bằng ảnh PNG (Tachie)

Đây là cách nhẹ nhất: mỗi cảm xúc một ảnh tĩnh hoàn chỉnh. Không rig, không lip-sync, không eye-tracking.

### B.1 Cấu trúc file `.tachie.zip`

Đặt ảnh ở gốc:

```
mynhanvat.tachie.zip
├── neutral.png      ← BẮT BUỘC
├── happy.png
├── sad.webp
└── surprised.jpg
```

Hoặc bọc trong **đúng một** thư mục:

```
mynhanvat.tachie.zip
└── mynhanvat/
    ├── neutral.png
    └── happy.png
```

**9 tên cảm xúc hợp lệ** (`packages/stage-ui-tachie/src/constants/emotions.ts:7`), không phân biệt hoa/thường:

```
neutral  happy  sad  angry  think  surprised  awkward  question  curious
```

Chỉ `neutral` là bắt buộc; thiếu cảm xúc nào thì AIRI tự dùng lại `neutral`.
Phần mở rộng ảnh không quan trọng — miễn trình duyệt giải mã được (PNG, WebP, JPG…).

### B.2 Luật bắt buộc (đây là những thứ validator sẽ chặn)

| Luật | Giới hạn | Nguồn |
| --- | --- | --- |
| Đuôi file | **phải** là `.tachie.zip` | `tachie-archive.ts:10`, kiểm tra `:298` |
| Ảnh `neutral` | bắt buộc có | `:223` |
| Kích thước ảnh | **mọi ảnh phải cùng width × height** | `:416` |
| Vị trí ảnh | ở gốc zip, **hoặc** trong đúng 1 thư mục bọc — không được trộn lẫn, không được lồng sâu hơn | `:187`, `:190`, `:194` |
| Trùng cảm xúc | mỗi cảm xúc chỉ 1 ảnh (không được vừa `happy.png` vừa `happy.webp`) | `:215` |
| Dung lượng zip | ≤ **100 MiB** (nén) | `:12`, `:299` |
| Bộ nhớ texture | ≤ **300 MiB** sau giải mã (tính `w × h × 4` byte mỗi ảnh) | `:14`, `:404` |
| Kích thước 1 ảnh | ≤ `MAX_TEXTURE_SIZE` của WebGL trên máy đó (thường 4096–16384 px) | `:396` |

> Mẹo tính nhanh bộ nhớ: ảnh 2048×2048 = ~16 MB texture. 9 cảm xúc ở kích thước đó ≈ 151 MB — vẫn dưới ngưỡng.
> Ảnh 4096×4096 thì 9 cảm xúc ≈ 604 MB → **vượt giới hạn**, phải giảm kích thước.

### B.3 Tạo file zip

Linux/macOS — nén ảnh ở gốc, đồng thời loại rác macOS:

```bash
cd thu-muc-anh
zip -r ../mynhanvat.tachie.zip . -x '__MACOSX/*' '.*' '*/.*'
```

Windows (PowerShell):

```powershell
Compress-Archive -Path .\*.png -DestinationPath .\mynhanvat.zip
Rename-Item .\mynhanvat.zip .\mynhanvat.tachie.zip
```

> Windows Explorer luôn tạo đuôi `.zip`, nên bước đổi tên thành `.tachie.zip` là bắt buộc.
> File thừa (`.DS_Store`, `thumbs.db`, ảnh tên lạ) không làm hỏng zip — chúng chỉ bị **bỏ qua** và sinh cảnh báo
> "Ignored N unrecognized archive entries" (`tachie-archive.ts:322`).

### B.4 Các bước nạp

1. Settings → **Models** → **"Chọn mô hình"**.
2. Dropdown **"Nhập"** → chọn **Tachie**.
3. Chọn file `.tachie.zip`.
4. `validateTachieZip()` chạy (`model-selector.vue:98`):
   - `VALID` → nhập luôn.
   - `WARNING` → hiện modal, bạn xác nhận là nhập được.
   - `INVALID` → hiện modal và **chặn nhập** (`model-selector.vue:111-112` từ chối khi status là `INVALID`).
5. Bấm **"Chọn"** trên thẻ model.

Báo cáo còn cho biết `canvas` (width × height thực tế) và `decodedImageBytes` — dùng để biết bạn đang tốn bao
nhiêu bộ nhớ texture (`tachie-archive.ts:490-504`).

### B.5 Lỗi hay gặp và cách sửa

| Thông báo | Sửa thế nào |
| --- | --- |
| `Tachie archives must use the .tachie.zip file extension` | Đổi tên file |
| `Tachie archive must contain a neutral image` | Thêm `neutral.png` |
| `Image "x.png" is 1024×2048; every Tachie image must match 1024×1536` | Cắt/canvas lại cho mọi ảnh cùng kích thước. Giữ nhân vật ở đúng vị trí trong khung để không bị "nhảy" khi đổi cảm xúc |
| `Emotion images must be stored at the archive root or inside one wrapping directory` | Bỏ thư mục lồng nhiều tầng |
| `Emotion images cannot be mixed between the archive root and a wrapping directory` | Chọn một trong hai kiểu, đừng trộn |
| `Emotion "happy" is provided more than once` | Xóa bớt, mỗi cảm xúc giữ 1 file |
| `Tachie archive exceeds the 100 MiB compressed size limit` | Nén ảnh (WebP thay PNG), giảm kích thước |
| `Tachie images exceed the 300 MiB ... limit` | Giảm độ phân giải ảnh (nhớ: bộ nhớ tính theo pixel, không theo dung lượng file) |
| `Image "x.png" is 8192×8192, exceeding this device's 4096px texture limit` | Giảm kích thước ảnh xuống dưới ngưỡng của máy |
| `WebGL is unavailable` | Máy/trình duyệt không bật WebGL — không render tachie được |
| Bấm chọn file mà không có gì xảy ra | Tên file không kết thúc bằng `.tachie.zip` |

### B.6 Tinh chỉnh sau khi nạp

Panel **Tachie Settings** (`packages/stage-ui/src/components/scenarios/settings/model-settings/tachie.vue`):

- **Scale and Position** (`:33`): tỉ lệ, X, Y.
- **Rendering** (`:91`): **Render Scale** (giảm để nhẹ máy) và **Theme-colored drop shadow** (đổ bóng theo màu theme).
- **Extract colors from model** (`:74`): lấy màu chủ đạo áp lên theme.

---

## C. Đổi qua lại, xóa, và gắn model vào nhân vật

- **Đổi model:** mở lại dialog, bấm **"Chọn"** trên thẻ khác. Renderer tự đổi theo định dạng.
- **Xóa model:** menu trên mỗi thẻ → **"Xóa"** (`model-selector.vue:367`). Nếu xóa đúng model đang dùng, AIRI tự
  chuyển sang model còn lại đầu tiên (`model-selector.vue:34-42`) — không để stage kẹt ở mesh đã load.
- **Gắn vào nhân vật:** khi bạn chọn model, AIRI ghi luôn id đó vào card đang active
  (`panel.vue:62-66` → `airiCardStore.updateActiveCardDisplayModel()`), tức là **mỗi nhân vật nhớ ngoại hình riêng**.
- **Đóng gói chia sẻ:** Settings → AIRI Card → export ra zip `airi-character-card`, trong đó có `card.json` +
  `models/body-model.{zip|tachie.zip|vrm}`. Cả tính cách lẫn ngoại hình đi cùng nhau
  (`packages/stage-ui/src/services/airi-card-import-export.ts:80`).

## D. Lưu ở đâu / mất khi nào

- File model lưu trong **IndexedDB** của trình duyệt/app (`packages/stage-ui/src/stores/display-models.ts:117`);
  Live2D còn đăng ký thêm loader OPFS (`:210`).
- **Xóa dữ liệu site, đổi trình duyệt, hoặc reset app là mất.** Giữ lại file zip gốc, hoặc export gói
  `airi-character-card` để backup.

---

## E. Chọn cái nào?

| | Live2D | Tachie (PNG) |
| --- | --- | --- |
| Nguồn model | Tải zip cộng đồng, hoặc tự rig | Tự vẽ / thuê vẽ, hoặc xuất từ ảnh có sẵn |
| Công chuẩn bị | Thấp nếu zip sạch; có thể phải sửa tên file | Thấp — chỉ cần ảnh cùng kích thước |
| Cử động | Chớp mắt, theo dõi chuột, idle motion, expression | Không có; đổi ảnh theo cảm xúc |
| Lip-sync | Có | **Không** |
| Tài nguyên | Nặng hơn (WASM + WebGL + mesh) | Nhẹ hơn, nhưng ảnh lớn thì tốn texture memory |
| Hợp với mục tiêu RAM thấp | Được | Tốt hơn |

Nếu ưu tiên RAM thấp và muốn chạy được ngay: **bắt đầu bằng Tachie**, sau này muốn sinh động hơn thì chuyển sang
Live2D — cả hai dùng chung một dialog nên đổi qua lại chỉ mất vài giây.
