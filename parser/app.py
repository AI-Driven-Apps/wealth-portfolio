"""Stateless PDF parser for Wealth Portfolio.

The Next.js app posts a PDF and its password here and gets JSON back.
Nothing is written to disk or logged: the file lives in memory for the
duration of the request only. Only reachable on the internal Docker network.
"""
import io
import json
import os

import casparser
import pdfplumber
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile

from contract_note import parse_contract_note

MAX_BYTES = 15 * 1024 * 1024
SHARED_SECRET = os.environ.get("PARSER_SECRET", "")

app = FastAPI(title="wealth-portfolio-parser", docs_url=None, redoc_url=None)


def _is_password_error(e: BaseException) -> bool:
    """pdfminer wraps a bad password several layers deep (PdfminerException -> PDFPasswordIncorrect)."""
    seen = set()
    stack = [e]
    while stack:
        x = stack.pop()
        if x is None or id(x) in seen:
            continue
        seen.add(id(x))
        text = f"{x.__class__.__name__} {x}".lower()
        if "password" in text or "decrypt" in text or "encrypt" in text:
            return True
        stack.extend([x.__cause__, x.__context__])
        stack.extend(a for a in getattr(x, "args", ()) if isinstance(a, BaseException))
    return False


def _clean(msg: str) -> str:
    return msg.rstrip(". ")


def _check(secret: str | None):
    if SHARED_SECRET and secret != SHARED_SECRET:
        raise HTTPException(status_code=401, detail="bad parser secret")


async def _read(upload: UploadFile) -> io.BytesIO:
    data = await upload.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="PDF larger than 15 MB")
    if not data.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="not a PDF file")
    return io.BytesIO(data)


@app.get("/health")
def health():
    return {"ok": True, "casparser": casparser.__version__ if hasattr(casparser, "__version__") else "?"}


@app.post("/cas")
async def cas(file: UploadFile = File(...), password: str = Form(""), x_parser_secret: str | None = Header(None)):
    """CAMS/KFintech MF statements and NSDL/CDSL demat statements."""
    _check(x_parser_secret)
    buf = await _read(file)
    try:
        out = casparser.read_cas_pdf(buf, password, output="json")
    except Exception as e:  # wrong password, re-printed PDF, unsupported layout
        if _is_password_error(e):
            raise HTTPException(status_code=422, detail="Wrong PDF password (CAS PDFs usually use your PAN in capitals).")
        msg = _clean(str(e) or e.__class__.__name__)
        raise HTTPException(status_code=422, detail=f"Could not read this statement: {msg}. It must be the original emailed PDF, not a re-printed copy.")
    finally:
        buf.close()
    return json.loads(out)


@app.post("/contract-note")
async def contract_note(file: UploadFile = File(...), password: str = Form(""), x_parser_secret: str | None = Header(None)):
    """Broker contract notes: best-effort trade table extraction."""
    _check(x_parser_secret)
    buf = await _read(file)
    try:
        return parse_contract_note(buf, password)
    except Exception as e:
        if _is_password_error(e):
            raise HTTPException(status_code=422, detail="Wrong PDF password (contract notes usually use your PAN in capitals).")
        raise HTTPException(status_code=422, detail=f"Could not read this contract note: {_clean(str(e) or e.__class__.__name__)}")
    finally:
        buf.close()


MAX_TABLE_ROWS = 50_000


@app.post("/tables")
async def tables(file: UploadFile = File(...), password: str = Form(""), x_parser_secret: str | None = Header(None)):
    """Every table row on every page, in order, as text cells.

    Used for reference lists such as a broker's scrip-code -> ISIN list; the app
    finds the header row itself, so a table split across pages reads as one.
    """
    _check(x_parser_secret)
    buf = await _read(file)
    rows: list[list[str]] = []
    try:
        with pdfplumber.open(buf, password=password or None) as pdf:
            for page in pdf.pages:
                for table in page.extract_tables():
                    for row in table:
                        rows.append([" ".join((c or "").split()) for c in row])
                        if len(rows) >= MAX_TABLE_ROWS:
                            return {"rows": rows, "truncated": True}
    except Exception as e:
        if _is_password_error(e):
            raise HTTPException(status_code=422, detail="Wrong PDF password.")
        raise HTTPException(status_code=422, detail=f"Could not read tables from this PDF: {_clean(str(e) or e.__class__.__name__)}")
    finally:
        buf.close()
    return {"rows": rows, "truncated": False}
