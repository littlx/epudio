# EPUB 有声解读

把 EPUB 电子书转成**有声解读**：不是朗读原文，而是用 DeepSeek 对每一章做深度解读，再以两位主持人对谈的形式合成中文音频，每章一个 MP3。

## 工作流程

1. **解析 EPUB** → 按 TOC/spine 切分章节，提取纯文本，过滤封面版权页
2. **深度解读** → DeepSeek 以两位读书播客主持人聊天的形式，对每章做主题立意、叙事手法、人物心理、象征隐喻、历史语境、现实关联的解读，输出结构化对谈脚本（非原文复述）
3. **语音合成** → Edge TTS 用两个不同音色分别合成甲/乙的发言
4. **拼接** → ffmpeg 无损拼接为单一章节 MP3
5. **收听** → 浏览器里查看进度、播放、查看对谈文稿

## 前置依赖

- Python 3.10+
- ffmpeg（macOS：`brew install ffmpeg`）
- DeepSeek API Key（申请：https://platform.deepseek.com/）

## 安装

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## 配置

复制环境变量模板并填入你的 DeepSeek API Key：

```bash
cp .env.example .env
```

编辑 `.env`：

```
DEEPSEEK_API_KEY=sk-你的真实key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

# 两位主持人音色（Edge TTS 中文神经网络语音，可改）
VOICE_A=zh-CN-XiaoxiaoNeural   # 甲（女声）
VOICE_B=zh-CN-YunxiNeural      # 乙（男声）

# 对谈长度（轮数，一甲一乙为一轮）
TURNS_MIN=8
TURNS_MAX=16

# 章节并发生成数
CONCURRENCY=2

PORT=8000
```

> 更多中文音色见 Edge TTS 文档，例如 `zh-CN-YunjianNeural`（男，沉稳）、`zh-CN-XiaoyiNeural`（女，活泼）等。

## 运行

```bash
source .venv/bin/activate
python -m app.main
# 或：uvicorn app.main:app --host 127.0.0.1 --port 8000
```

浏览器打开 http://127.0.0.1:8000

## 使用

1. 上传 `.epub` 文件，自动解析章节
2. 点击「生成全部」开始解读与合成（也可对单章「重做」）
3. 完成的章节可在线播放、查看对谈文稿

## 目录结构

```
data/books/{book_id}/
  original.epub        原始电子书
  meta.json            书信息与各章状态
  chapters/{n}.txt     原文章节文本
  scripts/{n}.json     对谈解读脚本
  audio/{n}.mp3        最终章节音频
```

## 技术栈

- **后端**：FastAPI + Uvicorn
- **EPUB 解析**：ebooklib + BeautifulSoup
- **深度解读**：DeepSeek（OpenAI 兼容协议）
- **语音合成**：edge-tts（免费、中文神经网络语音）
- **音频拼接**：ffmpeg（concat 无损拼接 + ffprobe 时长探测）
- **前端**：原生 HTML/CSS/JS 单页，无构建步骤

## 说明

- 解读质量与长度由 `TURNS_MIN` / `TURNS_MAX` 控制；每轮约对应 20–40 秒音频。
- 生成时会注入前几章的解读要点作为上下文，使整本书的解读保持连贯而不重复。
- 中文音色为默认；如需解读输出为其他语言，需相应调整 `interpreter.py` 的 prompt 与 Edge TTS 音色。
- Edge TTS 为免费服务，大量章节并发可能被限流，已内置信号量限流（默认每章内 4 并发）。
