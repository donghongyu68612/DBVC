# DBVC

DBVC 是一个本地部署的个人声音克隆 Web 工作台，已整合本地 Index-TTS-V3。

## 功能

- 本地网页录音或上传声音样本
- 声音样本库：保存、命名、改名、删除、试听、下载
- 下次直接选择已保存声音样本生成语音，无需重复录制
- 调用本地 Index-TTS-V3 推理
- 生成历史：本地保存、反复试听、下载 MP3/WAV
- 不依赖云端 TTS API

## 默认本地依赖路径

当前配置默认使用：

```text
D:\Index-TTS-V3\Index-TTS-V3
D:\Index-TTS-V3\Index-TTS-V3\deepface\python.exe
D:\Index-TTS-V3\Index-TTS-V3\deepface\ffmpeg\ffmpeg.exe
```

如果你的 Index-TTS-V3 目录不同，请修改：

```text
config.local.json
```

## 启动

```bat
node server.js
```

然后打开：

```text
http://127.0.0.1:3010
```

也可以双击：

```text
启动网页.bat
```

## 数据目录

运行后会自动生成：

```text
data/         样本库和生成历史数据库
samples/      保存的声音样本 MP3/WAV
uploads/      临时上传文件
generated/    生成的语音文件 MP3/WAV
```

这些目录已加入 `.gitignore`，不会提交到 GitHub。

## 合规声明

仅用于你本人的声音，或你已获得明确授权的声音。请勿用于冒充他人、诈骗、伪造证据、骚扰或绕过身份验证。
