#!/bin/bash
# Cloudflare Tunnel 快速安装脚本
# 使用 Quick Tunnel（无需注册 Cloudflare 账号的临时版本）
# 或使用 Named Tunnel（需要注册，但稳定域名）

set -e

echo "📡 安装 Cloudflare Tunnel..."

# 安装 cloudflared
if ! command -v cloudflared &>/dev/null; then
    echo "下载 cloudflared..."
    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
    chmod +x /usr/local/bin/cloudflared
fi

echo ""
echo "===== 方案 1: Quick Tunnel（临时，无需注册）====="
echo "运行: cloudflared tunnel --url http://localhost:8000"
echo "会自动分配一个 trycloudflare.com 子域名"
echo ""
echo "===== 方案 2: Named Tunnel（永久，需注册 Cloudflare 账号）====="
echo "1. cloudflared tunnel login"
echo "2. cloudflared tunnel create athand"
echo "3. cloudflared tunnel route dns athand your-subdomain.your-domain.com"
echo "4. 创建配置文件 ~/.cloudflared/config.yml:"
echo "   tunnel: <TUNNEL_ID>"
echo "   credentials-file: ~/.cloudflared/<TUNNEL_ID>.json"
echo "   ingress:"
echo "     - hostname: your-subdomain.your-domain.com"
echo "       service: http://localhost:8000"
echo "     - service: http_status:404"
echo "5. cloudflared tunnel run athand"
echo ""
echo "✅ cloudflared 已安装"
