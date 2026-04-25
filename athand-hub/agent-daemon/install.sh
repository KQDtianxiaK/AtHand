#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"

echo "📦 安装 Agent Daemon..."
echo "   目录: $SCRIPT_DIR"

# 创建虚拟环境
if [ ! -d "$VENV_DIR" ]; then
    echo "🔧 创建 Python 虚拟环境..."
    python3 -m venv "$VENV_DIR"
fi

echo "📥 安装依赖..."
"$VENV_DIR/bin/pip" install -r "$SCRIPT_DIR/requirements.txt" -q

# 复制配置文件
if [ ! -f "$SCRIPT_DIR/config.yaml" ]; then
    cp "$SCRIPT_DIR/config.example.yaml" "$SCRIPT_DIR/config.yaml"
    echo "⚠️  请编辑 $SCRIPT_DIR/config.yaml 配置连接信息"
fi

# 创建 systemd 服务（Linux 非 WSL）
if command -v systemctl &>/dev/null && [ ! -f /proc/sys/fs/binfmt_misc/WSLInterp ]; then
    SERVICE_FILE="/etc/systemd/system/athand-agent.service"
    echo "🔧 创建 systemd 服务..."
    sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=AtHand Agent Daemon
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=$VENV_DIR/bin/python $SCRIPT_DIR/daemon.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    sudo systemctl daemon-reload
    sudo systemctl enable athand-agent
    echo "✅ systemd 服务已创建。启动: sudo systemctl start athand-agent"
else
    echo ""
    echo "💡 WSL 或无 systemd 环境，请手动启动:"
    echo "   cd $SCRIPT_DIR && $VENV_DIR/bin/python daemon.py"
    echo ""
    echo "   或添加到 ~/.bashrc 自动启动:"
    echo "   echo 'nohup $VENV_DIR/bin/python $SCRIPT_DIR/daemon.py &>/dev/null &' >> ~/.bashrc"
fi

echo ""
echo "✅ 安装完成！"
