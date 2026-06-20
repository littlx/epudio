# 部署文档

本文档涵盖 EPUB 有声解读的各类部署方式。按场景选择：

- [本地运行](#1-本地运行最简单)
- [Docker 部署](#2-docker-部署推荐)
- [systemd 服务（Linux 长驻）](#3-systemd-服务linux-长驻)
- [Nginx 反向代理](#4-nginx-反向代理局域网https)
- [环境变量与配置](#5-环境变量与配置)
- [运维与排错](#6-运维与排错)

---

## 前置依赖

| 依赖 | 版本 | 说明 |
|------|------|------|
| Python | ≥ 3.10 | 后端运行时 |
| Node.js | ≥ 18 | 仅构建前端需要 |
| ffmpeg | 任意 | 音频拼接，需在 PATH 中 |
| DeepSeek API Key | — | 申请：https://platform.deepseek.com/ |

检查 ffmpeg：
```bash
ffmpeg -version        # macOS: brew install ffmpeg
ffprobe -version       # Ubuntu: sudo apt install ffmpeg
```

---

## 1. 本地运行（最简单）

适合个人使用、开发调试。

### 1.1 获取代码与安装依赖

```bash
# 后端
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 前端依赖
cd web && npm install && cd ..
```

### 1.2 配置

```bash
cp .env.example .env
# 编辑 .env，至少填入 DEEPSEEK_API_KEY
```

### 1.3 构建前端（生产模式）

```bash
cd web && npm run build && cd ..
# 产物输出到 static/，由 FastAPI 托管
```

### 1.4 启动

```bash
source .venv/bin/activate
python -m app.main
# 访问 http://127.0.0.1:8000
```

如需开发热重载（前后端分离）：
```bash
# 终端 1
python -m app.main
# 终端 2
cd web && npm run dev
# 访问 http://127.0.0.1:5173（自动代理 /api 到 8000）
```

---

## 2. Docker 部署（推荐）

一键打包前后端 + ffmpeg，适合服务器/局域网共享。

### 2.1 Dockerfile

在项目根目录创建 `Dockerfile`：

```dockerfile
FROM node:20-slim AS builder
WORKDIR /build
COPY web/package.json web/package-lock.json* ./web/
RUN cd web && npm install
COPY web ./web
RUN cd web && npm run build

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY --from=builder /build/static ./static
ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8000
CMD ["python", "-m", "app.main"]
```

### 2.2 构建与运行

```bash
docker build -t epubmp3 .

# 运行（数据持久化到 ./data，端口 8000）
docker run -d \
  --name epubmp3 \
  -p 8000:8000 \
  -v $(pwd)/data:/data \
  -e DEEPSEEK_API_KEY=sk-你的key \
  --restart unless-stopped \
  epubmp3
```

访问 http://服务器IP:8000

### 2.3 docker-compose.yml

```yaml
services:
  epubmp3:
    build: .
    ports:
      - "8000:8000"
    volumes:
      - ./data:/data
    environment:
      - DEEPSEEK_API_KEY=sk-你的key
      # 其余配置可在应用设置页调整，或在此覆盖
      - DEEPSEEK_MODEL=deepseek-chat
      - CONCURRENCY=2
    restart: unless-stopped
```

```bash
docker compose up -d
```

### 2.4 更新镜像

```bash
git pull
docker compose build && docker compose up -d
```

> **注意**：容器内 `DATA_DIR=/data`，settings.json 与所有书籍数据都落在挂载卷里，重建容器不丢失。

---

## 3. systemd 服务（Linux 长驻）

适合 Linux 服务器裸机部署，开机自启。

### 3.1 一次性准备

```bash
# 假设部署到 /opt/epubmp3
cd /opt/epubmp3
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd web && npm install && npm run build && cd ..
cp .env.example .env  # 编辑填入 API key
```

### 3.2 创建服务单元

`/etc/systemd/system/epubmp3.service`：

```ini
[Unit]
Description=EPUB 有声解读
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/epubmp3
EnvironmentFile=/opt/epubmp3/.env
ExecStart=/opt/epubmp3/.venv/bin/python -m app.main
Restart=on-failure
RestartSec=5
# 可选：限制资源
MemoryMax=2G

[Install]
WantedBy=multi-user.target
```

### 3.3 启用

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now epubmp3
sudo systemctl status epubmp3        # 查看状态
journalctl -u epubmp3 -f              # 实时日志
```

---

## 4. Nginx 反向代理（局域网/HTTPS）

用 Nginx 前置，统一端口、加 HTTPS、处理 SSE 长连接。

### 4.1 Nginx 配置

```nginx
server {
    listen 80;
    server_name your.domain.or.ip;

    # 可选：HTTPS
    # listen 443 ssl;
    # ssl_certificate     /path/to/cert.pem;
    # ssl_certificate_key /path/to/key.pem;

    client_max_body_size 200m;        # EPUB 上传上限

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # SSE 端点：禁用缓冲，长连接保活
    location ~ ^/api/books/.*/stream$ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        chunked_transfer_encoding on;
    }

    # 静态资源缓存
    location /static/assets/ {
        proxy_pass http://127.0.0.1:8000;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

### 4.2 关键点

- **`proxy_buffering off`**：SSE 必须关闭缓冲，否则进度事件会积压不发。
- **`proxy_read_timeout 86400s`**：SSE 是长连接，默认 60s 超时会断开。
- **`client_max_body_size`**：EPUB 文件可能较大，按需调高。

---

## 5. 环境变量与配置

### 5.1 `.env` 配置项

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DEEPSEEK_API_KEY` | （必填） | DeepSeek API 密钥 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | API 地址 |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 模型名 |
| `VOICE_A` | `zh-CN-XiaoxiaoNeural` | 主持人甲音色 |
| `VOICE_B` | `zh-CN-YunxiNeural` | 主持人乙音色 |
| `STYLE` | `dialogue` | 解读风格：dialogue/deep/casual/storytelling |
| `TURNS_MIN` | `8` | 对谈最少轮数 |
| `TURNS_MAX` | `16` | 对谈最多轮数 |
| `CONCURRENCY` | `2` | 章节并发数 |
| `DEEPSEEK_RPM` | `30` | DeepSeek 每分钟请求上限 |
| `EDGE_CONCURRENCY` | `8` | Edge TTS 全局并发上限 |
| `DATA_DIR` | `./data` | 数据目录（书籍/音频/设置） |
| `PORT` | `8000` | 服务端口 |

### 5.2 运行时设置覆盖

`.env` 提供默认值；应用内的**设置页**修改会持久化到 `data/settings.json`，并覆盖 `.env`。所以：

- 初始部署：在 `.env` 配好 API key 和基本默认
- 日常调整（风格/音色/限流）：在浏览器设置页改，无需重启

### 5.3 数据目录结构

```
data/
  settings.json              全局设置（设置页产生）
  books/{book_id}/
    original.epub            原始电子书
    meta.json                书信息与各章状态
    chapters/{n}.txt         原文章节文本
    scripts/{n}.json         对谈解读脚本
    audio/{n}.mp3            最终章节音频
```

> `DATA_DIR` 必须可写且有足够空间（一本几十章的书音频可达数百 MB）。

---

## 6. 运维与排错

### 6.1 日志

```bash
# 直接运行：输出到终端
# systemd：
journalctl -u epubmp3 -f
# Docker：
docker logs -f epubmp3
```

### 6.2 常见问题

**Q: 启动报 `未配置 DEEPSEEK_API_KEY`**
A: 检查 `.env` 或环境变量是否设置；Docker 用 `-e DEEPSEEK_API_KEY=...`。

**Q: 生成卡在"解读中"不动**
A: 看日志，多为 API 限流或网络问题。应用已内置重试（3 次，指数退避）。可在设置页调低 `CONCURRENCY` 和 `DEEPSEEK_RPM`。

**Q: 合成失败 / 音频为空**
A: 通常是 Edge TTS 被限流。调低 `EDGE_CONCURRENCY`（设置页可调）。确认服务器能访问 `speech.platform.bing.com`。

**Q: SSE 进度不更新（状态卡住）**
A: 若经 Nginx，确认 SSE 路径 `proxy_buffering off`（见 §4）。直连无此问题。

**Q: 服务重启后章节显示"解读中/合成中"卡住**
A: 应用已内置启动恢复，会自动回退为"待恢复"。如未生效，检查 `data/books/*/meta.json` 是否可写。

**Q: 上传大 EPUB 失败**
A: 应用限制 200MB。经 Nginx 需配 `client_max_body_size`。

**Q: ffmpeg 找不到**
A: 确认 `ffmpeg` 和 `ffprobe` 在 PATH。Docker 镜像已内置。

### 6.3 数据备份

```bash
# 备份所有书籍与设置
tar czf epubmp3-backup-$(date +%F).tar.gz data/

# Docker
docker run --rm -v $(pwd)/data:/data -v $(pwd):/backup alpine \
  tar czf /backup/epubmp3-backup.tar.gz /data
```

### 6.4 清理

```bash
# 删除某本书（也可在界面操作）
rm -rf data/books/{book_id}

# 清空全部（慎用）
rm -rf data/books/*
```

### 6.5 安全提示

- 应用默认 `host=0.0.0.0`，监听所有网卡。**仅限可信局域网**暴露，无鉴权机制。
- 如需公网访问，务必加 Nginx + Basic Auth 或置于 VPN/内网之后。
- `DELETE /api/books/{id}` 无二次校验，公网暴露有数据丢失风险。

---

## 快速参考

| 场景 | 命令 |
|------|------|
| 本地开发 | `python -m app.main` + `cd web && npm run dev` → :5173 |
| 本地生产 | `cd web && npm run build` + `python -m app.main` → :8000 |
| Docker | `docker compose up -d` → :8000 |
| 查日志 | `journalctl -u epubmp3 -f` / `docker logs -f epubmp3` |
| 更新 | `git pull && (cd web && npm run build) && systemctl restart epubmp3` |
