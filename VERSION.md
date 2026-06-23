# DBVC Version Log

## v0.3.0-dual-model-stable - 2026-06-23 12:13:01 +08:00

稳定版：双模型运行（CosyVoice2 + Index-TTS），GPT-SoVITS 已移除。

### Changes
- 移除 GPT-SoVITS（效果差，已清理模型目录约 13GB）。
- CosyVoice2 中文情感模型为默认选项，ONNX GPU 加速。
- Index-TTS 通过 Python bridge 直接生成，标记为可用。
- 页面标题：DBVC语音生成。
- 去除三模型对比按钮。
- 生成历史只保留播放和删除，去掉下载 MP3。
- 声音样本库和模型下拉框统一深色风格。
- CosyVoice2 参考音频自动裁剪至 30s。
- CosyVoice2 API 拼接全部文本片段（修复只读第一段 bug）。
- Index-TTS 在线检测改为文件完整性检测。
- 生成历史支持删除：DELETE /api/generations/:id。

### Runtime
- DBVC Web: http://127.0.0.1:3010
- CosyVoice2: http://127.0.0.1:50000（GPU ONNX, fp16）
- Index-TTS: D:\Index-TTS-V3\Index-TTS-V3（Python bridge）
