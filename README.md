# 我的声音克隆工作台：已整合本地 Index-TTS-V3

这个新网页程序已经整合你的本地 TTS：

```text
D:\Index-TTS-V3\Index-TTS-V3
D:\Index-TTS-V3\Index-TTS-V3\deepface\python.exe
```

现在生成语音时，网页后端会：

1. 接收你上传/录制的参考音频。
2. 保存到本项目 `uploads/`。
3. 调用本地 `deepface\python.exe`。
4. 运行 `index_tts_bridge.py`。
5. 加载 `D:\Index-TTS-V3\Index-TTS-V3\indextts` 和 `checkpoints`。
6. 执行 `IndexTTS.infer()` / `IndexTTS.infer_fast()`。
7. 把生成的 wav 存到 `generated/`。
8. 返回给页面直接播放。

也就是说：**不再依赖云端 API，也不再只是占位。**

## 一键运行新网页

双击：

```text
启动网页.bat
```

或者手动运行：

```bash
cd /d C:\Users\dongliang\Documents\Codex\2026-06-22\ni\outputs\voice-clone-page
npm install
npm start
```

然后打开：

```text
http://localhost:3010
```

## 文件说明

- `index.html`：网页页面
- `app.js`：前端录音、上传、提交、播放逻辑
- `server.js`：Node 后端，负责调用本地 Index-TTS
- `index_tts_bridge.py`：Python 桥接脚本，真正调用 IndexTTS
- `config.local.json`：本地路径配置
- `uploads/`：参考音频保存目录，运行后自动生成
- `generated/`：生成音频输出目录，运行后自动生成

## 配置

`config.local.json` 当前为：

```json
{
  "indexRoot": "D:\\Index-TTS-V3\\Index-TTS-V3",
  "pythonExe": "D:\\Index-TTS-V3\\Index-TTS-V3\\deepface\\python.exe",
  "localTtsExe": "D:\\Index-TTS-V3\\Index-TTS-V3\\一键启动.exe",
  "defaultMode": "normal"
}
```

如果你以后移动了 Index-TTS-V3 目录，只需要改这里。

## 页面里的“启动原版 Index-TTS WebUI”按钮

这个按钮只是帮你打开原版 `一键启动.exe`，方便你对照测试。

新网页自己的生成逻辑不依赖这个 WebUI 是否打开，因为它是直接调用 Python 模型推理。

## 合规提醒

请仅用于你本人的声音，或你已获得明确授权的声音。不要用于冒充他人、诈骗、伪造证据、骚扰或绕过身份验证。


## 本地模型启动脚本

- GPT-SoVITS API：`E:\DBVC\scripts\start-gpt-sovits-api.bat`
- CosyVoice2 WebUI：`E:\DBVC\scripts\start-cosyvoice2-webui.bat`
- DBVC 网页：`C:\Users\dongliang\Documents\Codex\2026-06-22\ni\outputs\voice-clone-page\启动网页.bat`

当前默认本地地址：

- GPT-SoVITS：`http://127.0.0.1:9880`
- CosyVoice2：`http://127.0.0.1:50000`
- DBVC：`http://127.0.0.1:3010`
