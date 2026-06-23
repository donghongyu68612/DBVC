# DBVC Version Log

## v0.2.0-index-tts-stable - 2026-06-23 09:58:39 +08:00

稳定版：收敛为 Index-TTS 可用版本。

### Changes
- 默认模型切换为 Index-TTS。
- GPT-SoVITS 与 CosyVoice2 标记为实验中/暂不可用。
- 页面标题改为 DBVC语音生成。
- 移除右上角本地 TTS 状态提示和原版 Index-TTS WebUI 启动按钮。
- 隐藏详细模型检测长提示。
- 生成历史只显示文件名、时间、播放、下载 MP3、删除。
- 新增生成记录删除接口：DELETE /api/generations/:id。
- 修复 escapeHtml 未定义导致生成历史加载失败的问题。

### Runtime
- DBVC Web: http://127.0.0.1:3010
- Stable model: Index-TTS
- Index-TTS root: D:\Index-TTS-V3\Index-TTS-V3
- Python: D:\Index-TTS-V3\Index-TTS-V3\deepface\python.exe
