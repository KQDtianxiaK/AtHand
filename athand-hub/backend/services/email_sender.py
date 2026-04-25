"""
SMTP 邮件发送引擎。
- 发送邮件（纯文本 / HTML）
- 回复、转发
- 保存到 IMAP Sent 文件夹
"""
from __future__ import annotations

import email.utils
import imaplib
import logging
import smtplib
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from sqlalchemy.orm import Session

from models import Email, EmailAccount, EmailFolder
from services.email_crypto import decrypt_password

logger = logging.getLogger("email_sender")


def _build_message(
    from_addr: str,
    from_name: str,
    to_addrs: list[str],
    cc_addrs: list[str] | None,
    bcc_addrs: list[str] | None,
    subject: str,
    body_text: str,
    body_html: str | None = None,
    in_reply_to: str | None = None,
    references: str | None = None,
) -> MIMEMultipart:
    """构建 MIME 邮件。"""
    msg = MIMEMultipart("alternative")
    msg["From"] = email.utils.formataddr((from_name, from_addr))
    msg["To"] = ", ".join(to_addrs)
    if cc_addrs:
        msg["Cc"] = ", ".join(cc_addrs)
    msg["Subject"] = subject
    msg["Date"] = email.utils.formatdate(localtime=True)
    msg["Message-ID"] = email.utils.make_msgid()

    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
    if references:
        msg["References"] = references

    # 纯文本部分
    msg.attach(MIMEText(body_text, "plain", "utf-8"))
    # HTML 部分（可选）
    if body_html:
        msg.attach(MIMEText(body_html, "html", "utf-8"))

    return msg


def _send_smtp(account: EmailAccount, msg: MIMEMultipart, all_recipients: list[str]):
    """通过 SMTP 发送邮件。"""
    password = decrypt_password(account.encrypted_password)

    if account.use_ssl:
        server = smtplib.SMTP_SSL(account.smtp_host, account.smtp_port, timeout=30)
    else:
        server = smtplib.SMTP(account.smtp_host, account.smtp_port, timeout=30)
        server.starttls()

    try:
        server.login(account.username, password)
        server.sendmail(account.email, all_recipients, msg.as_string())
    finally:
        server.quit()


def _append_to_sent(account: EmailAccount, msg: MIMEMultipart, db: Session):
    """将发送的邮件追加到 IMAP Sent 文件夹。"""
    sent_folder = db.query(EmailFolder).filter_by(
        account_id=account.id, folder_type="sent"
    ).first()
    if not sent_folder:
        logger.warning("No sent folder found for account %s (id=%s), skip append",
                       account.email, account.id)
        return

    password = decrypt_password(account.encrypted_password)
    remote_name = sent_folder.remote_name
    logger.info("Appending to sent folder %r for account %s", remote_name, account.email)
    try:
        if account.use_ssl:
            conn = imaplib.IMAP4_SSL(account.imap_host, account.imap_port)
        else:
            conn = imaplib.IMAP4(account.imap_host, account.imap_port)

        conn.login(account.username, password)
        try:
            # 某些服务器需要带引号，某些不需要；先尝试带引号，失败则不带引号
            try:
                conn.append(
                    f'"{remote_name}"',
                    "\\Seen",
                    imaplib.Time2Internaldate(time.time()),
                    msg.as_bytes(),
                )
            except imaplib.IMAP4.error:
                conn.append(
                    remote_name,
                    "\\Seen",
                    imaplib.Time2Internaldate(time.time()),
                    msg.as_bytes(),
                )
        finally:
            conn.logout()
    except Exception:
        logger.exception("Failed to append to Sent folder %r", remote_name)


def send_email(
    account: EmailAccount,
    to_addrs: list[str],
    subject: str,
    body_text: str,
    body_html: str | None = None,
    cc_addrs: list[str] | None = None,
    bcc_addrs: list[str] | None = None,
    in_reply_to: str | None = None,
    references: str | None = None,
    db: Session | None = None,
) -> str:
    """
    发送邮件，返回 Message-ID。
    如果提供 db，还会尝试将邮件追加到已发送文件夹。
    """
    from_name = account.email
    msg = _build_message(
        from_addr=account.email,
        from_name=from_name,
        to_addrs=to_addrs,
        cc_addrs=cc_addrs,
        bcc_addrs=bcc_addrs,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
        in_reply_to=in_reply_to,
        references=references,
    )

    all_recipients = list(to_addrs)
    if cc_addrs:
        all_recipients.extend(cc_addrs)
    if bcc_addrs:
        all_recipients.extend(bcc_addrs)

    _send_smtp(account, msg, all_recipients)

    # 追加到已发送
    if db:
        _append_to_sent(account, msg, db)

    return msg["Message-ID"]


def test_smtp_connection(host: str, port: int, username: str, password: str, use_ssl: bool) -> str:
    """测试 SMTP 连接，返回 'ok' 或错误信息。"""
    import socket
    try:
        if use_ssl:
            server = smtplib.SMTP_SSL(host, port, timeout=15)
        else:
            server = smtplib.SMTP(host, port, timeout=15)
            try:
                server.starttls()
            except smtplib.SMTPException:
                pass  # 部分服务器不支持 STARTTLS
        try:
            server.login(username, password)
        except smtplib.SMTPAuthenticationError as e:
            return f"登录失败（用户名或密码错误）。若使用QQ/163等，请使用授权码：{e.smtp_error!r}"
        except smtplib.SMTPException as e:
            return f"SMTP 验证失败：{e}"
        server.quit()
        return "ok"
    except socket.timeout:
        return f"连接超时：请检查 {host}:{port} 是否可访问"
    except ConnectionRefusedError:
        return f"连接被止：{host}:{port} 端口不可访问"
    except OSError as e:
        return f"网络错误：{e}"
    except Exception as e:
        return str(e) or type(e).__name__
