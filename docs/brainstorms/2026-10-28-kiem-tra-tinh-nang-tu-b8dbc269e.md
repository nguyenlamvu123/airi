# Kiểm tra các tính năng từ `b8dbc269e` đến `027abdce2`

> Ngày: 2026-10-28
> Nhánh: `opencode2show_huonglycover`. Gồm 14 commit, 7 tính năng, khoảng +3360/−275 dòng.
> Cách kiểm: đọc toàn bộ diff, chạy vitest, typecheck và eslint, rồi thử thật API DuckDuckGo
> và Claude Code CLI. **Chưa chạy app Electron có giao diện.** Máy này không cài `opencode`
> nên backend opencode chỉ được kiểm bằng đọc code và unit test.
> Báo cáo này không sửa dòng code nào.

## 0. Kết luận nhanh

| # | Tính năng (commit) | Đánh giá |
| --- | --- | --- |
| 1 | Panel "duyệt file" (`b8dbc269e`) | **Chạy được.** Còn vài lỗi giao diện nhỏ và chưa xử lý đường dẫn Windows. |
| 2 | Panel tìm web DuckDuckGo (`de2488ede`) | **Chạy về kỹ thuật nhưng gần như không có kết quả.** 3/5 truy vấn thử ra rỗng, trong đó có mọi truy vấn tiếng Việt. Lệnh này còn chặn việc gửi tin nhắn. |
| 3 | Từ khoá lệnh cấu hình trong `states.json` (`b81cf67ca`) | **Tốt.** Test đủ. Đổi từ khoá vẫn phải build lại, và chưa chuẩn hoá Unicode hay dấu câu. |
| 4 | Backend opencode (`ca7e48b17`) | **Chạy được trên lý thuyết, có rủi ro.** Stream có thể bị cụt, lỗi của model bị nuốt thành câu trả lời rỗng. |
| 5 | Chọn backend agent (opencode / Claude Code) (`573868927`) | **Có lỗ hổng bảo mật nghiêm trọng** (mục S1). Backend Claude có lỗi với tin nhắn bắt đầu bằng `-` (đã tái hiện). |
| 6 | Bỏ official chat provider (`a28cfcd36`) | **Sạch trong stage-ui.** Nhưng thay đổi này ảnh hưởng cả stage-web và stage-pocket (mục M11). |
| 7 | Nút chọn backend (`a094cd5e6`) | **Lỗi chức năng.** Đổi backend xong thì chat hỏng (H1). Session hiển thị sai id. Còn 3 lỗi lint. |

## 1. Kết quả kiểm tự động

| Kiểm | Kết quả |
| --- | --- |
| `vitest run` trên các file test liên quan (9 file) | 8 file **pass** (47 test). 1 file **skip** (4 test): `manager.test.ts` chỉ chạy khi có `AIRI_OPENCODE_TEST=1` và có `opencode`. |
| `pnpm -F @proj-airi/stage-tamagotchi typecheck` | **OK** |
| `pnpm -F @proj-airi/stage-ui typecheck` | **OK** |
| `eslint` trên các file đã đổi | **3 lỗi, 2 cảnh báo.** Lỗi là `perfectionist/sort-imports` ở `agent-backend-indicator/index.vue:11-12` và `pages/index.vue:40`. Cảnh báo là `unocss/order-attributify`. Sửa được bằng `pnpm lint:fix`. |
| Gọi thật DuckDuckGo Instant Answer | `kyoto` và `Hồ Chí Minh` có kết quả. `thời tiết hà nội`, `cách cài python trên ubuntu` và `vue 3 composition api` đều **0 kết quả**. |
| Chạy thật `claude -p --output-format stream-json --verbose --include-partial-messages` (Claude Code 2.1.312) | `parseClaudeStreamLine` **khớp** output thật: lấy được `session_id` và `model` từ `system/init`, delta từ `content_block_delta/text_delta`, và text từ `result`. |
| Gửi prompt `-v` và `--giai-thich-ma-nay` vào `claude -p` | **Lỗi đã tái hiện.** `-v` in ra số phiên bản rồi exit 0, nên AIRI nhận câu trả lời rỗng. `--giai-...` báo `unknown option` rồi exit 1. |

## 2. Vấn đề và đề xuất, theo mức độ

### Nghiêm trọng

**S1. Proxy agent không có xác thực, mở CORS `*`, mà agent lại chạy với toàn quyền.**
Nằm ở `main/libs/agent/proxy.ts:45`, `proxy.ts:81`, `backends/claude/transport.ts:34` và `backends/opencode/transport.ts:15`.

- Proxy nghe trên `127.0.0.1:<cổng ngẫu nhiên>` và không kiểm token nào. Nó trả
  `access-control-allow-origin: *`, và `readJsonBody` parse JSON bất kể `content-type`.
  Vì vậy cả "simple request" không cần preflight cũng lọt qua.
- Đằng sau proxy, Claude Code chạy `--dangerously-skip-permissions`, còn opencode thì
  `permission: '*' → allow`.
- Hệ quả: mọi tiến trình trên máy, kể cả một trang web đang mở trong trình duyệt nếu dò ra
  cổng, đều gửi được lệnh cho agent. Agent sẽ chạy shell và sửa file mà không hỏi ai.
  Việc trình duyệt có chặn request từ web vào localhost hay không còn tuỳ trình duyệt,
  nên không thể dựa vào đó.
- Đề xuất, làm theo thứ tự:
  1. Mỗi lần `startAgentProxy` sinh một token ngẫu nhiên, trả về trong `AgentBackendStatus`.
     Renderer truyền token đó làm `apiKey` cho `createOpenAI(apiKey, baseUrl)`; xsAI sẽ tự
     gửi header `Authorization: Bearer`. Proxy trả 401 nếu thiếu hoặc sai token.
  2. Bỏ `*`. Chỉ cho phép origin của renderer, hoặc từ chối request có `Origin` lạ. Bắt
     buộc `content-type: application/json`.
  3. Hạ quyền mặc định. Với Claude: `--permission-mode acceptEdits` hoặc `dontAsk` kèm
     `--allowedTools` liệt kê công cụ được dùng, thay cho bypass. Với opencode: `bash` để
     `deny` hoặc `ask`. Chỉ bật toàn quyền khi người dùng tự bật trong settings.
- Lý do cần hạ quyền ngay cả khi đã có token: đầu vào giọng nói (hearing) cũng đi thẳng
  vào agent. Nhận dạng giọng nói sai một câu là có thể chạy một lệnh phá huỷ.

### Cao

**H1. Đổi backend ở nút chọn thì chat hỏng.**
Nằm ở `renderer/composables/use-agent-backend.ts:104-110`, `main/libs/agent/manager.ts:145` và `agent-backend-indicator/index.vue:49-54, 76`.

- `setBackend` chỉ khởi động backend mới và cập nhật `baseUrl` của provider tương ứng. Nó
  **không đổi** `consciousnessStore.activeProvider`. Trong khi đó manager **dừng** backend
  cũ, vì mỗi lúc chỉ có một backend chạy. Kết quả là provider đang được chọn trỏ vào một
  proxy đã chết.
- Khi khởi động backend mới thất bại, `BACKEND_KEY` đã được ghi vào localStorage từ trước,
  và backend cũ đã bị dừng. UI vẫn hiện backend mới là "đang chọn" với chấm xanh, vì
  `statusDotClass` chỉ xét `available` chứ không xét `running`. Lỗi chỉ được `console.warn`.
- Đề xuất: gộp về **một nguồn sự thật**. Hoặc chọn backend thì đồng thời đặt
  `activeProvider` và `activeModel = AGENT_PROXY_MODEL_ID`, hoặc chọn provider
  `opencode`/`claude-code` trong settings thì tự gọi `ensure` backend tương ứng. Chỉ ghi
  localStorage sau khi `status.running` là true. Chấm trạng thái phải dựa vào `running` và
  `error`, và lỗi phải hiện bằng toast.

**H2. Lệnh "duyệt file" và "duyệt web" chặn việc gửi tin nhắn, và tin nhắn lệnh vẫn được gửi cho LLM.**
Nằm ở `renderer/pages/index.vue:670-679`, `packages/core-agent/src/runtime/chat-orchestrator-runtime.ts:504` và `main/libs/duckduckgo.ts:95`.

- Orchestrator `await` mọi hook `onBeforeMessageComposed` trước khi gọi LLM. Hook của
  index.vue lại `await webSearchStore.search()` (một `fetch` tới DuckDuckGo **không có
  timeout**) và `await openBrowser()`. Mạng chậm hay treo thì tin nhắn bị kẹt, không đi
  tới LLM.
- Hook không có cách huỷ lượt gửi, nên "duyệt file" vẫn được gửi cho LLM hoặc agent. Với
  Claude Code đang toàn quyền, agent có thể tự đi duyệt file hoặc tự tìm web, tức là làm
  trùng việc.
- Đề xuất: gọi lệnh theo kiểu `void` (fire-and-forget) và thêm
  `AbortSignal.timeout(10_000)` cho `fetch`. Nếu muốn lệnh **không** tới LLM thì chặn ở chỗ
  gửi (chat input hoặc chat-sync) trước khi gọi `ingest`, đừng dùng hook.

**H3. DuckDuckGo Instant Answer không phải API tìm kiếm web.**
Nằm ở `main/libs/duckduckgo.ts`.

- API này chỉ trả abstract hoặc định nghĩa cho thực thể nổi tiếng. Truy vấn tiếng Việt,
  câu hỏi "cách làm…" hay chủ đề kỹ thuật đều ra rỗng (xem mục 1). Panel khi đó chỉ báo
  "Không tìm thấy kết quả."
- Đề xuất, cái nào rẻ làm trước:
  1. Khi rỗng, luôn thêm một mục "Mở kết quả trên DuckDuckGo cho «query»". `resultsUrl`
     đã có sẵn trong `parseDuckDuckGoInstantAnswer`.
  2. Dùng một nguồn tìm kiếm thật: SearXNG tự host (miễn phí, có JSON) hoặc Brave Search
     API (cần key). Hai lựa chọn này cần bạn quyết định.
  3. Khi đang dùng agent backend, có thể để agent tự tìm web rồi tóm tắt.

**H4. Claude: tin nhắn bắt đầu bằng `-` bị hiểu thành cờ CLI. Đã tái hiện.**
Nằm ở `backends/claude/transport.ts:62`.

- Prompt được truyền thành tham số vị trí cuối cùng. Gửi `-v` thì AIRI nhận câu trả lời
  rỗng. Gửi `--xyz` thì báo lỗi. Những dòng gạch đầu dòng kiểu "- liệt kê file…" cũng có
  nguy cơ dính.
- Đề xuất: truyền prompt qua stdin (`stdio: ['pipe', …]`, ghi text rồi `end()`), hoặc
  chèn `'--'` trước text. Dùng stdin còn tránh được giới hạn độ dài dòng lệnh trên Windows.

**H5. Proxy chỉ chuyển tin nhắn user cuối cùng, nên nhân vật mất tính cách.**
Nằm ở `proxy.ts:130`.

- System prompt của AIRI bị bỏ: card nhân vật, hướng dẫn token cảm xúc và ACT,
  `systemPromptSupplement`. Tool của AIRI (MCP, widget) và ảnh đính kèm cũng bị bỏ.
  Agent trả lời theo kiểu coding assistant (markdown, code block), rồi TTS đọc nguyên văn.
  Biểu cảm Live2D/VRM lấy từ marker của LLM sẽ không còn chạy.
- `ClaudeTransportOptions` đã có sẵn `appendSystemPrompt` và `model` nhưng **không nơi nào
  truyền vào**, tức là đang là code chết.
- Đề xuất: lấy message `role: 'system'` trong request rồi chuyển vào
  `--append-system-prompt` (Claude) hoặc trường `system` khi prompt opencode. Nếu bạn cố ý
  muốn AIRI chỉ là giao diện cho coding agent thì ghi rõ điều đó trong README và bỏ hai
  option thừa.

### Trung bình

**M1. Claude: bắt `exit` thay vì `close`, nên có thể mất dòng `result` cuối.**
Nằm ở `claude/transport.ts:131`.
Lúc `exit` phát ra, stdout có thể chưa đọc xong (theo tài liệu Node). Ngoài ra phần dư
trong `stdoutBuffer` không kết thúc bằng `\n` cũng không được parse. Nếu dòng bị mất là
`result` có `is_error`, lượt đó resolve với text rỗng thay vì báo lỗi.
Đề xuất: dùng `child.on('close')` và parse phần buffer còn lại trước khi kết thúc.

**M2. Không huỷ được lượt agent.**
Nằm ở `proxy.ts` và `claude/index.ts:14`.
Người dùng bấm dừng trong AIRI, hay request bị đóng, thì `transport.prompt` vẫn chạy tiếp.
Tiến trình `claude` không bị kill, kể cả khi thoát app (`close: async () => {}`), và vẫn
đang có toàn quyền.
`server.close()` còn chờ các stream SSE đang mở kết thúc, nên đổi backend hoặc thoát app
có thể treo tới khi agent trả lời xong.
Đề xuất: nghe `request.on('close')` rồi truyền `AbortSignal` xuống `prompt`. Claude thì
`child.kill()`; opencode thì gọi `POST /session/{id}/abort`. Khi đóng thì gọi
`server.closeAllConnections()`.

**M3. opencode: stream có thể cụt, lỗi model bị nuốt.**
Nằm ở `opencode/transport.ts:52-83`.

- Kết nối `GET /event` được mở **song song** với `prompt`, nên các delta đầu có thể đến
  trước khi đăng ký xong. Bước bù chỉ chạy khi `fullText.startsWith(streamedText)`, mà
  thiếu phần đầu thì điều kiện này sai. Lúc đó client chỉ nhận phần cuối câu trả lời,
  và proxy không gửi bù vì `streamedAny` đã là true.
- `result.info.error` không được kiểm: lỗi provider hay hết quota trở thành câu trả lời
  rỗng, không báo gì.
- Đề xuất: chờ event `server.connected` đầu tiên rồi mới gửi prompt. Nếu thấy stream lệch
  với `fullText` thì gửi lại phần còn thiếu theo độ dài, đừng dựa vào `startsWith`. Gặp
  `info.error` thì ném lỗi.

**M4. `createSession` nằm ngoài `try` trong proxy.**
Nằm ở `proxy.ts:175`.
Header SSE đã gửi trước dòng này, nên nếu nó lỗi thì response không bao giờ `end`: client
treo, và main process bị unhandled rejection vì `void handleChatCompletion`.
Đề xuất: đưa dòng này vào khối `try` ngay bên dưới.

**M5. Session Claude không được lưu sau lượt đầu.**
Nằm ở `use-agent-backend.ts:66-67` và `agent-backend-indicator/index.vue:35`.

- Claude chỉ sinh id ở lượt đầu tiên, còn renderer chỉ lưu `sessionID` lúc `ensure`. Lúc
  đó id vẫn rỗng. Kết quả là mở lại app thì hội thoại bắt đầu lại từ đầu. Lần lưu duy nhất
  xảy ra tình cờ khi một cửa sổ khác (settings, chat) gọi `initialize` sau lượt đầu.
- Nút chọn backend hiện `activeSessionId` (id phiên chat của AIRI) **trước** id session
  của agent, nên nhãn "Session" đang sai.
- Phiên chat của AIRI và session agent không gắn với nhau: bấm "chat mới" trong AIRI thì
  agent vẫn nhớ ngữ cảnh cũ.
- Đề xuất: proxy trả session id mới (header hoặc event Eventa) để renderer lưu sau mỗi
  lượt. Lưu một bảng `AIRI sessionId → agent sessionID`. Indicator chỉ hiện id của agent.

**M6. Race trong manager.**
Nằm ở `manager.ts:141-145`.

- `if (starting) return starting` trả về kết quả của **backend khác** nếu người dùng đổi
  backend lúc backend kia đang khởi động.
- Trong lúc `await stop()`, biến `starting` vẫn rỗng. Một `ensure` thứ hai lọt vào sẽ khởi
  động song song, rồi `active` bị ghi đè và tiến trình đầu bị rò, không ai kill.
- Đề xuất: xếp hàng các `ensure` (một promise chain). Chỉ dùng lại `starting` khi cùng
  `backendId` và `directory`.

**M7. opencode chết sau khi đã khởi động thì không ai biết.**
Nằm ở `opencode/server.ts:76-84`.
Sau `finish`, listener `exit` không còn tác dụng nữa vì `settled` đã là true. Status vẫn báo
`running: true` và chat lỗi `fetch failed`.
Đề xuất: khi tiến trình con `exit` thì gỡ `active` trong manager và ghi `lastError` để UI
còn khởi động lại được.

**M8. Thư mục làm việc mặc định là `process.cwd()`.**
Nằm ở `manager.ts:134`.
Ở bản đóng gói, `cwd` thường là `$HOME` hoặc `/`, nên agent có toàn quyền trên cả thư mục
home. `directory` và `commandPath` có trong API nhưng chưa có UI nào truyền vào.
Đề xuất: cho người dùng chọn thư mục dự án. Mặc định dùng một thư mục riêng, ví dụ
`app.getPath('userData')/agent-workspace`.

**M9. Agent tự khởi động mỗi lần mở app.**
Nằm ở `App.vue:297` và `use-agent-backend.ts:20`.
Việc này xảy ra kể cả khi người dùng đang chat bằng provider khác. Mặc định là `opencode`
dù máy chỉ cài `claude`, như máy đang kiểm.
Đề xuất: chỉ `ensure` khi `activeProvider` là một agent backend. Fallback nên là backend
**có sẵn** đầu tiên trong `listAgentBackends()`.

**M10. IPC `openExternal` và `openPath` nhận URL hay đường dẫn tuỳ ý.**
Nằm ở `main/windows/shared/window.ts:278` và `window.ts:303`.
URL lấy thẳng từ payload DuckDuckGo hoặc renderer, mà không kiểm scheme. Ngay trong cùng
file đã có `openSafeExternalUrl` (`window.ts:86`), chỉ cho `http`, `https` và `mailto`,
nhưng handler mới không dùng.
Đề xuất: dùng lại `openSafeExternalUrl`. Với `openPath`, cân nhắc hỏi xác nhận trước khi
mở file thực thi.

**M11. Bỏ official chat provider ảnh hưởng ngoài desktop.**
Commit `a28cfcd36`.
Commit này sửa `packages/stage-ui`, nơi stage-web và stage-pocket cũng dùng. Hai app đó
không có agent backend, nên người dùng đăng nhập sẽ không còn chat provider mặc định.
Người dùng cũ đã lưu `activeProvider = 'official-provider'` sẽ trỏ vào một provider không
còn tồn tại.
Đề xuất: nếu nhánh này chỉ dùng cho desktop thì giới hạn việc bỏ provider trong
stage-tamagotchi. Nếu giữ nguyên thì cần migration xoá `activeProvider` không hợp lệ.

**M12. Nút chọn backend.**
Nằm ở `agent-backend-indicator/index.vue`.

- Khi bật fade-on-hover, nút nằm trên vùng trong suốt và không thuộc vùng giữ tương tác
  ở `pages/index.vue:238-256` (chỉ có controls island và status island), nên có thể không
  bấm được. Dropdown đang mở cũng không giữ cửa sổ ở trạng thái tương tác như panel duyệt
  file đang làm.
- Chuỗi tiếng Anh viết cứng ("Agent backend", "(unavailable)", "Click to switch backend"),
  không qua `packages/i18n`.
- `BACKEND_KEY`, `FALLBACK_BACKEND_ID` và `sessionKey` bị chép lại từ composable. Nên
  export từ một chỗ.

### Thấp

- **L1. Danh sách file cũ vẫn hiện dưới spinner và dưới thông báo lỗi.**
  `file-browser-panel/index.vue:118`: `v-for` không nằm trong chuỗi `v-if`/`v-else-if`,
  và `loadDirectory` không xoá `entries`. Đề xuất: bọc danh sách trong một `<template v-else>`.
- **L2. Thiếu nút "Quay lại".** Store đã có `goBack` và i18n đã có key `back`, nhưng không
  có nút. Key `error` không được dùng: lỗi hiện nguyên văn tiếng Anh của Node (`EACCES: …`).
  Nên map mã lỗi sang i18n.
- **L3. `isLoading` có thể kẹt.** Store không có `try/finally` quanh lời gọi IPC, nên IPC ném
  lỗi là `isLoading` kẹt ở true (`stores/file-browser.ts:80`, `stores/web-search.ts:188`).
  Bấm nhanh nhiều thư mục thì kết quả về sau ghi đè kết quả mới; nên bỏ qua kết quả của
  request cũ.
- **L4. Thư mục lớn chậm.** `stat` được gọi tuần tự từng file (`window.ts:236`). Nên chạy
  song song có giới hạn.
- **L5. Windows và macOS.**
  - `getParentPath('C:/Users')` trả về `'C:'`, tức thư mục hiện hành của ổ C chứ không phải
    gốc ổ. Nút Up chỉ bị khoá khi path là `/`.
  - `spawn('claude')` và `spawn('opencode')` không có `shell`, nên không chạy được bản
    `.cmd` cài qua npm trên Windows. Trong khi đó `isCommandAvailable` vẫn báo là có.
  - App GUI trên macOS không kế thừa PATH của shell, nên backend bị báo unavailable.
- **L6. So khớp lệnh còn cứng.**
  - Chưa `normalize('NFC')`, nên gõ dấu dạng tổ hợp (NFD) sẽ không khớp.
  - Giọng nói thường cho ra "Duyệt file." có dấu chấm, nên không khớp vì `matchFileBrowserCommand`
    so bằng tuyệt đối.
  - Đề xuất: chuẩn hoá NFC và bỏ dấu câu ở cuối, ở cả `file-browser-core.ts` và `web-search-core.ts`.
- **L7. Đổi từ khoá vẫn phải build lại.** "Cấu hình qua `states.json`" thực ra phải build lại,
  vì file được `import` lúc build. Tiêu đề commit `de2488ede` ghi "tìm kiếm:", nhưng từ khoá
  thật bây giờ là "duyệt web".
- **L8. Mỗi lượt Claude tốn thêm thời gian và token.** Mỗi lượt Claude spawn một tiến trình
  mới và nạp **hook của user** (bản chạy thử thấy `SessionStart` chèn cả khối context).
  Đề xuất: thêm `--setting-sources project,local` để bỏ setting cấp user. Không nên dùng
  `--bare`, vì nó bỏ cả đọc keychain và có thể mất đăng nhập. Cần thử lại sau khi thêm cờ.
- **L9. Vệ sinh code.**
  - 3 lỗi lint.
  - JSDoc của `claude/stream.ts` nhắc tới `stream.test.ts`, nhưng file này **không tồn tại**.
  - Ví dụ Before/After của `getParentPath` bị lặp.
  - Nhiều chuỗi class inline dài, trái với quy ước dùng mảng class trong AGENTS.md.

## 3. Lỗ hổng test

| Phần | Hiện có | Nên thêm |
| --- | --- | --- |
| `claude/stream.ts` và `claude/transport.ts` | **0 test** | Fixture NDJSON lấy từ output thật (đã chụp được một bản lúc kiểm), các ca `is_error`, dòng rác, prompt bắt đầu bằng `-`. |
| `proxy.ts` | Chỉ qua integration bị skip | Unit test với transport giả: stream, non-stream, `createSession` lỗi, client huỷ giữa chừng, thiếu token (sau khi sửa S1). |
| `manager.ts` | Integration bị skip | Test race đổi backend và lỗi khi start, dùng factory giả. Không cần opencode. |
| `use-agent-backend.ts`, indicator, store duyệt file và tìm web | 0 test | Ca đổi backend (H1), lưu session (M5), danh sách cũ còn hiện khi load (L1). |
| Parser lệnh, DuckDuckGo, tracker opencode | Có vitest | Theo quy ước của bạn thì nên thêm **golden-file** `tests/input/testcaseN` – `expect/` – `actual/` cạnh vitest. Dùng payload DuckDuckGo thật (cả ca rỗng), NDJSON Claude thật, và câu lệnh có NFD hoặc dấu chấm. |

## 4. Thứ tự sửa đề xuất

1. **S1** (token, CORS, hạ quyền). Nên làm trước khi dùng agent backend hằng ngày.
2. **H1, H4, H2.** Lỗi chức năng thấy ngay. Mỗi cái sửa nhỏ.
3. **M1, M3, M4, M5, M6.** Độ tin cậy của stream và session.
4. **H3, H5, M8, M11.** Cần bạn chọn hướng: nguồn tìm kiếm nào; có giữ persona AIRI khi
   chạy agent không; thư mục làm việc mặc định; việc bỏ official provider có áp cho web không.
5. Các mục Thấp và bổ sung test (mục 3).
