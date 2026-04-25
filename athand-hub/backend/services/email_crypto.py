"""
邮箱密码加密/解密工具。
使用 Fernet 对称加密，密钥从 jwt_secret 派生。
"""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet

from config import settings


def _derive_key() -> bytes:
    """从 jwt_secret 派生 32 字节 Fernet 密钥。"""
    digest = hashlib.sha256(settings.jwt_secret.encode()).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_password(plaintext: str) -> str:
    """加密密码，返回 base64 编码的密文。"""
    f = Fernet(_derive_key())
    return f.encrypt(plaintext.encode()).decode()


def decrypt_password(ciphertext: str) -> str:
    """解密密码，返回明文。"""
    f = Fernet(_derive_key())
    return f.decrypt(ciphertext.encode()).decode()
