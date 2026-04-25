from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

from config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def _verify_password(plain: str) -> bool:
    return plain == settings.admin_password


def _create_token(data: dict) -> str:
    expire = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode({**data, "exp": expire}, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def get_current_user(token: str = Depends(oauth2_scheme)) -> str:
    """解析 JWT，返回 username。"""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        username: str | None = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="无效凭证")
        return username
    except JWTError:
        raise HTTPException(status_code=401, detail="无效凭证")


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/login", response_model=TokenResponse)
def login(form: OAuth2PasswordRequestForm = Depends()):
    if form.username != "admin" or not _verify_password(form.password):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    token = _create_token({"sub": "admin"})
    return TokenResponse(access_token=token)


class LoginBody(BaseModel):
    password: str


@router.post("/login/json", response_model=TokenResponse)
def login_json(body: LoginBody):
    """JSON 格式登录（方便前端调用）。"""
    if not _verify_password(body.password):
        raise HTTPException(status_code=401, detail="密码错误")
    token = _create_token({"sub": "admin"})
    return TokenResponse(access_token=token)
