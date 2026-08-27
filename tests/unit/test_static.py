"""대시보드 정적 서빙. 경계(패키지 밖 읽기)와 끝 슬래시 정규화만 본다."""

from asyncscope.web import static_files
from asyncscope.web.static_files import UI_PREFIX, handle_static


async def call(path, method="GET"):
    messages = []

    async def send(message):
        messages.append(message)

    assert await handle_static(path, method, send) is True
    start, body = messages
    return start["status"], dict(start["headers"]), body["body"]


async def test_index_is_served_at_trailing_slash(tmp_path, monkeypatch):
    monkeypatch.setattr(static_files, "STATIC_DIR", tmp_path)
    (tmp_path / "index.html").write_text("<html>ok</html>")

    status, headers, body = await call(f"{UI_PREFIX}/")
    assert status == 200
    assert body == b"<html>ok</html>"
    assert headers[b"content-type"] == b"text/html"


async def test_bare_prefix_redirects(tmp_path, monkeypatch):
    monkeypatch.setattr(static_files, "STATIC_DIR", tmp_path)

    status, headers, _ = await call(UI_PREFIX)
    assert status == 307
    assert headers[b"location"] == f"{UI_PREFIX}/".encode()


async def test_traversal_stays_inside_static_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(static_files, "STATIC_DIR", tmp_path / "static")
    (tmp_path / "static").mkdir()
    (tmp_path / "secret.txt").write_text("nope")

    status, _, body = await call(f"{UI_PREFIX}/../secret.txt")
    assert status == 404
    assert b"nope" not in body


async def test_missing_file_is_404(tmp_path, monkeypatch):
    monkeypatch.setattr(static_files, "STATIC_DIR", tmp_path)
    (tmp_path / "index.html").write_text("<html>ok</html>")

    status, _, _ = await call(f"{UI_PREFIX}/assets/nope.js")
    assert status == 404


async def test_unbuilt_static_dir_explains_itself(tmp_path, monkeypatch):
    monkeypatch.setattr(static_files, "STATIC_DIR", tmp_path)

    status, _, body = await call(f"{UI_PREFIX}/")
    assert status == 404
    assert b"not built" in body
