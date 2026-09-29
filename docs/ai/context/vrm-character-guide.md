# Hướng dẫn: Nhân vật VRM miễn phí cho Stage

Mục tiêu: tạo một nhân vật VRM miễn phí (xuất từ **VRoid Studio**), nạp vào AIRI stage và
(có thể) đặt làm mô hình mặc định. VRM là lựa chọn phù hợp vì cung cấp sẵn **blink mắt**,
**lookAt** và **spring bone** (tóc, khuyên tai, … đu đưa theo vật lý) mà ảnh tĩnh không có.

Ghi chú khả năng hỗ trợ:

- Web (`stage-web`) và desktop (`stage-tamagotchi`, renderer Three.js `stage-ui-three`): hỗ trợ cả
  **VRM 0.x và VRM 1.0**.
- Engine Godot sidecar (`engines/stage-tamagotchi-godot`, experimental): hiện chỉ runtime-import
  **VRM 0.x** (xem `engines/stage-tamagotchi-godot/docs/vrm-runtime-import.md`).

## 1. Tạo & xuất VRM bằng VRoid Studio (miễn phí)

1. Tải **VRoid Studio** (Windows/macOS) tại <https://vroid.com/en/studio> và cài đặt.
2. Tạo nhân vật: các tab **Face / Hair / Body / Outfit**. Dùng preset rồi tinh chỉnh cho khớp
   ngoại hình mong muốn. Hair nên dùng kiểu có "tail/lông" để thấy rõ hiệu ứng spring bone.
3. Kiểm tra blink: xem phần mắt/blink trong VRoid.
4. Xuất file:
   - Menu **File → Export** (hoặc nút **Export avatar**), chọn định dạng **VRM**.
   - VRoid Studio bản mới xuất **VRM 1.0** mặc định; nếu cần VRM 0.x thì chọn setting tương ứng
     (tùy phiên bản VRoid có tuỳ chọn này trong hộp thoại export).
   - Lưu vào thư mục gọn, đặt tên tiếng Anh không dấu để tránh lỗi đường dẫn, ví dụ `huongly.vrm`
     (VRoid báo tên nhân vật qua metadata, nên tên file có thể khác tên hiển thị).

## 2. Nạp VRM vào AIRI (không cần sửa code)

- **Web (`stage-web`)**: Settings → **Display / Stage (Model)** → mở **Model Selector** → nút
  import VRM → chọn file `.vrm`. Model được lưu IndexedDB (key `display-model-*`) và trở thành
  stage model hiện tại; renderer tự chuyển sang `vrm`.
- **Desktop (`stage-tamagotchi`)**: Settings → **Models** → import tương tự.

Luồng code liên quan: `packages/stage-ui/src/components/scenarios/dialogs/model-selector/model-selector.vue`
`handleAddVRMModel` → `displayModelsStore.addDisplayModel(DisplayModelFormat.VRM, file)`
(`packages/stage-ui/src/stores/display-models.ts`). Với file import, preview tự sinh
(`generateVrmPreview`).

## 3. Biến thành preset (và default) trong repo — tuỳ chọn

Khi đã có file `.vrm`, có thể thêm làm preset để các máy khác cũng thấy:

1. Đặt file + ảnh preview:
   ```
   packages/stage-ui/src/assets/vrm/models/HuongLy/huongly.vrm
   packages/stage-ui/src/assets/vrm/models/HuongLy/preview.png
   ```
   (pattern giống `AvatarSample-A` / `AvatarSample-B`.)
2. Sửa `packages/stage-ui/src/stores/display-models.ts`:
   ```ts
   const presetVrmHuongLyUrl = new URL('../assets/vrm/models/HuongLy/huongly.vrm', import.meta.url).href
   const presetVrmHuongLyPreview = new URL('../assets/vrm/models/HuongLy/preview.png', import.meta.url).href
   ```
   rồi thêm entry vào cuối mảng `displayModelsPresets`:
   ```ts
   displayModelsPresets.push({
     id: 'preset-vrm-character',
     format: DisplayModelFormat.VRM,
     type: 'url',
     url: presetVrmHuongLyUrl,
     name: 'Hương Ly cover',
     previewImage: presetVrmHuongLyPreview,
     importedAt: Date.now(),
   })
   ```
3. Muốn mặc định luôn luôn (cho mọi user mới): sửa
   `packages/stage-ui/src/stores/settings/stage-model.ts`:
   ```ts
   const defaultStageModelId = 'preset-vrm-character'
   ```
   Lưu ý: key đã persist `settings/stage/model` giữ model cũ. User chưa từng đổi model sẽ có id
   preset cũ lưu sẵn; nếu muốn họ được dời sang preset mới, thêm id cũ vào
   `previousDefaultStageModelIds` (cơ chế migration 1 lần có sẵn) hoặc xoá key rồi reload.

## 4. Kiểm tra & hiệu chỉnh sau khi có VRM

- Khởi động app và xác nhận nhân vật hiện, tự **blink** và **tóc đu đưa** (spring bone).
- Idle animation mặc định: `idle_loop.vrma` — `packages/stage-ui-three/src/components/ThreeScene.vue`.
- Biểu cảm theo cảm xúc: `packages/stage-ui/src/components/scenes/Stage.vue` `emotionsQueue`
  map sang VRM expression.
- View controls (zoom/pan) hoạt động với renderer `vrm`.
- Nếu renderer không nhảy sang `vrm`: kiểm tra id trong `settings/stage/model` có tồn tại trong
  store display-models (model load chưa xong hoặc id sai).

## Ghi chú kích thước

- VRoid xuất thường ~10–40 MB tuỳ số lượng/độ phân giải texture. File lớn làm chậm runtime và
  build (vite/electron config có cảnh báo dung lượng cho `*.vrm`).
- Muốn tối ưu: giảm kích thước texture trong VRoid (hoặc chạy tool tối ưu VRM) trước khi commit.
- Muốn animation tuỳ biến: dùng thêm file `.vrma` (BOOTH/vroid có bộ animation miễn phí).
