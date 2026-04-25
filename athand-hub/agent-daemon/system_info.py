"""
系统信息采集。
"""
from __future__ import annotations

import platform


def get_system_info() -> dict:
    info = {
        "os": platform.system(),
        "os_version": platform.version(),
        "arch": platform.machine(),
        "hostname": platform.node(),
    }
    try:
        import psutil

        info["cpu_percent"] = psutil.cpu_percent(interval=0.5)
        mem = psutil.virtual_memory()
        info["memory_total_gb"] = round(mem.total / (1024**3), 1)
        info["memory_used_percent"] = mem.percent
        disk = psutil.disk_usage("/")
        info["disk_total_gb"] = round(disk.total / (1024**3), 1)
        info["disk_used_percent"] = round(disk.percent, 1)
    except ImportError:
        pass
    return info
