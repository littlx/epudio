# EPUB 有声解读

把 EPUB 电子书转成**有声解读**：不是朗读原文，而是用 DeepSeek 对每一章做深度解读，再以两位主持人对谈的形式合成中文音频，每章一个 MP3。

## 特性

- **深度解读**（非朗读）：主题立意、叙事手法、人物心理、象征隐喻、历史语境、现实关联
- **四种解读风格**：对谈式 / 深度解读 / 通俗讲解 / 评书式，可在设置页切换
- **两位主持人双音色**：Edge TTS 中文神经网络语音，甲乙各一，可在设置页选择并试听
- **实时进度**：SSE 推送，章节状态与合成进度（"合成 3/12 句"）实时更新
- **自动重试**：解读/合成失败自动重试，429 与网络错误指数退避
- **服务重启自动恢复**：中间态章节回退为待生成，不卡死
- **整书导出**：一键打包所有章节 mp3 + 解读脚本为 zip
- **全局播放器**：返回书架或切换书籍时持续播放，播完自动续下一章
- **限流控制**：DeepSeek RPM + Edge TTS 并发上限，可调
- **主题切换**：浅色 / 深色 / 跟随系统
- **响应式**：适配手机端

## 工作流程

1. **解析 EPUB** → 按 TOC/spine 切分章节，提取纯文本，过滤封面版权页
2. **深度解读** → DeepSeek 以指定风格生成两位主持人的对谈脚本（非原文复述）
3. **语音合成** → Edge TTS 用两个音色分别合成甲/乙发言
4. **拼接** → ffmpeg 无损拼接为单一章节 MP3
5. **收听** → 浏览器实时查看进度、播放、查看对谈文稿

## 前置依赖

- Python 3.10+
- Node.js 18+（仅构建前端需要）
- ffmpeg（macOS：`brew install ffmpeg`）
- DeepSeek API Key（申请：https://platform.deepseek.com/）

## 安装

```bash
# 后端
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 前端
cd web && npm install && cd ..
```

## 配置

```bash
cp .env.example .env
```

编辑 `.env`，至少填入 `DEEPSEEK_API_KEY`。其余项（风格、音色、限流等）可在应用的设置页调整并持久化，覆盖 .env 默认值。

## 运行

### 开发模式（热重载）

两个终端分别跑前后端，前端 5173 端口代理后端 8000：

```bash
# 终端 1：后端
source .venv/bin/activate
python -m app.main          # http://127.0.0.1:8000

# 终端 2：前端（带热重载）
cd web && npm run dev        # http://127.0.0.1:5173
```

开发时访问 http://127.0.0.1:5173

### 生产模式（单服务）

构建前端到 static/，由 FastAPI 托管：

```bash
cd web && npm run build && cd ..
source .venv/bin/activate
python -m app.main          # http://127.0.0.1:8000
```

访问 http://127.0.0.1:8000

## 使用

1. 上传 `.epub` 文件，自动解析章节
2. 「生成缺失」补齐未完成章节，或勾选指定章节「生成选中」
3. 完成的章节可在线播放、查看对谈文稿、重做
4. 「导出」一键打包整书为 zip

## 目录结构

```
app/                     Python 后端
  config.py              配置（.env + settings.json 覆盖）
  schemas.py             数据模型（Chapter/Stage/Settings 等）
  epub_parser.py         EPUB → 章节文本
  interpreter.py         DeepSeek 解读（风格切换/限流/重试/分段摘要）
  tts.py                 Edge TTS 合成 + ffmpeg 拼接（全局限流/重试）
  jobs.py                后台编排（分阶段进度/SSE/重试）
  sse.py                 SSE 事件总线
  ratelimit.py           令牌桶限流器
  export.py              整书 zip 导出
  store.py               数据持久化 + 启动恢复
  main.py                FastAPI 路由
web/                     Vite + Preact + TS 前端
  src/
    store.ts             单一全局状态（signals）
    api.ts               API 封装 + SSE 订阅
    theme.ts             主题切换
    components/          组件
    styles/              设计 token + 全局样式
static/                  前端构建产物（生产模式）
data/                    运行时数据（gitignore）
  books/{id}/            每本书：原文/脚本/音频/meta.json
  settings.json          全局设置
```

## 技术栈

- **后端**：FastAPI + sse-starlette + ebooklib + edge-tts + openai + ffmpeg
- **前端**：Preact + @preact/signals + TypeScript + Vite
- **LLM**：DeepSeek（OpenAI 兼容协议）
- **TTS**：edge-tts（免费、中文神经网络语音）
- **音频**：ffmpeg（concat 无损拼接 + ffprobe 时长探测）

## 说明

- 解读质量与长度由设置页的"对谈长度"控制；每轮约对应 20–40 秒音频。
- 生成时会注入前几章的解读要点作为上下文，使整本书的解读保持连贯。
- 长章节（>1.8 万字）自动先摘要再解读，避免截断丢内容。
- Edge TTS 为免费服务，已内置令牌桶限流避免被限流。
