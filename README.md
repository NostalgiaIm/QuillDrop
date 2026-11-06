# QuillDrop

QuillDrop 是一个悬浮在桌面右上角的轻量协作便签。任务、短消息和在线状态全部写入同一条事件流；客户端按事件类型归约出任务、展示板和交流站三个视图。

## 当前能力

- 任务投放、`@成员` 指派、开放领取和完成
- 团队在线状态与正在处理任务的派生展示板
- 短消息、引用回复，以及任务流转生成的系统消息
- Go SSE 服务、单调递增事件 ID、`Last-Event-ID` 补发与 15 秒心跳
- 写盘后广播的 append-only 本地事件日志，服务重启后可完整重放
- Tauri v2 无边框透明窗口、置顶、拖动和八向缩放

## 开发运行

需要 Node.js、Go 和 Rust/Tauri 环境。

```powershell
npm install
npm run dev:all
```

浏览器打开 `http://localhost:1420`。也可以分开运行：

```powershell
npm run server
npm run dev -- --port 1420
npm run tauri dev
```

Windows 下 `npm run tauri` 会自动选择 MSVC Rust 工具链，避免 GNU `windres` 处理 Tauri 资源文件时的兼容问题。

服务默认监听 `127.0.0.1:8787`，事件保存在 `server/data/events.jsonl`。可通过环境变量覆盖：

```powershell
$env:QUILLDROP_ADDR = "0.0.0.0:8787"
$env:QUILLDROP_DATA_DIR = "D:\QuillDropData"
$env:VITE_EVENT_API = "http://192.168.1.20:8787"
$env:VITE_QUILLDROP_USER = "N"
```

## 验证

```powershell
npm run build
npm run test:server
```

## 目录

- `src/`：Web/Tauri 前端及事件归约逻辑
- `server/`：Go 事件服务和持久化日志
- `src-tauri/`：Tauri v2 桌面外壳

## 下一步

当前版本优先完成“事件流 → 三个视图”的闭环。正式分发前，建议继续加入身份配置界面、系统通知、sidecar 构建脚本和 Windows Job Object/macOS 进程组生命周期管理。
