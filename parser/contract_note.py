"""Best-effort trade extraction from broker contract notes (PDF).

Contract-note layouts differ by broker, so this works on table *headers*
rather than fixed positions: it finds tables that have a buy/sell column, a
quantity column and a price column, then reads every row that looks like a
trade. Statutory charges (STT, exchange, GST, SEBI, stamp duty) are summed
from the summary section so the app can spread them across the trades.
The app always shows a preview before anything is saved.
"""
import re
from typing import Any

import pdfplumber

DATE_RE = re.compile(r"(\d{2})[-/.](\d{2})[-/.](\d{4})")
TRADE_DATE_RE = re.compile(r"trade\s*date[^0-9]{0,20}(\d{2}[-/.]\d{2}[-/.]\d{4})", re.I)
ISIN_RE = re.compile(r"\bIN[A-Z0-9]{10}\b")
NUM_RE = re.compile(r"^-?\(?[\d,]+(\.\d+)?\)?$")

CHARGE_LABELS = {
    "stt": re.compile(r"securities\s*transaction\s*tax|\bstt\b", re.I),
    "exchange": re.compile(r"exchange\s*trans|transaction\s*charges", re.I),
    "gst": re.compile(r"\b(i|c|s)?gst\b|goods\s*and\s*services", re.I),
    "sebi": re.compile(r"sebi", re.I),
    "stamp": re.compile(r"stamp\s*duty", re.I),
    "brokerage": re.compile(r"^\s*(taxable\s*value\s*of\s*supply|brokerage)", re.I),
}


def _num(s: Any) -> float | None:
    if s is None:
        return None
    t = str(s).strip().replace(",", "").replace("₹", "")
    neg = t.startswith("(") and t.endswith(")")
    t = t.strip("()")
    try:
        v = float(t)
    except ValueError:
        return None
    return -v if neg else v


def _iso(s: str) -> str | None:
    m = DATE_RE.search(s or "")
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def _norm(h: Any) -> str:
    return re.sub(r"[^a-z]", "", str(h or "").lower())


def _find_cols(header: list[str]) -> dict[str, int] | None:
    cols: dict[str, int] = {}
    for i, h in enumerate(header):
        n = _norm(h)
        if not n:
            continue
        if "side" not in cols and (n in {"bs", "buysell", "buybsells", "buyorsell", "side", "transactiontype"} or ("buy" in n and "sell" in n)):
            cols["side"] = i
        elif "qty" not in cols and ("quantity" in n or n in {"qty", "noofshares"}):
            cols["qty"] = i
        elif "price" not in cols and ("grossrate" in n or "tradeprice" in n or n in {"rate", "price", "tradepriceperunit", "grossrateperunit", "marketrate"}):
            cols["price"] = i
        elif "net" not in cols and ("netrate" in n):
            cols["net"] = i
        elif "security" not in cols and ("security" in n or "scrip" in n or "contractdescription" in n or n in {"symbol", "instrument", "name"}):
            cols["security"] = i
        elif "isin" not in cols and "isin" in n:
            cols["isin"] = i
        elif "tradeno" not in cols and n in {"tradeno", "tradenumber", "tradeid"}:
            cols["tradeno"] = i
        elif "date" not in cols and n in {"tradedate", "date"}:
            cols["date"] = i
    return cols if {"side", "qty", "price"} <= cols.keys() else None


def parse_contract_note(buf, password: str = "") -> dict:
    trades: list[dict] = []
    charges: dict[str, float] = {}
    trade_date: str | None = None
    texts: list[str] = []

    with pdfplumber.open(buf, password=password or None) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            texts.append(text)
            if not trade_date:
                m = TRADE_DATE_RE.search(text)
                if m:
                    trade_date = _iso(m.group(1))
            for table in page.extract_tables() or []:
                if not table:
                    continue
                cols = None
                for r_i, row in enumerate(table[:4]):  # header may sit on row 0-3
                    cols = _find_cols([c or "" for c in row])
                    if cols:
                        body = table[r_i + 1:]
                        break
                if cols:
                    for row in body:
                        cells = [(c or "").replace("\n", " ").strip() for c in row]
                        side_raw = cells[cols["side"]].upper() if cols["side"] < len(cells) else ""
                        side = "buy" if side_raw.startswith("B") else "sell" if side_raw.startswith("S") else None
                        qty = _num(cells[cols["qty"]]) if cols["qty"] < len(cells) else None
                        price = _num(cells[cols["price"]]) if cols["price"] < len(cells) else None
                        if not side or not qty or not price:
                            continue
                        sec = cells[cols["security"]] if "security" in cols and cols["security"] < len(cells) else ""
                        isin = cells[cols["isin"]] if "isin" in cols and cols["isin"] < len(cells) else ""
                        m = ISIN_RE.search(isin or sec)
                        trades.append({
                            "side": side,
                            "quantity": abs(qty),
                            "price": price,
                            "net_rate": _num(cells[cols["net"]]) if "net" in cols and cols["net"] < len(cells) else None,
                            "security": re.sub(r"\s*-\s*(NSE|BSE)\b.*$", "", ISIN_RE.sub("", sec)).strip(" /-"),
                            "isin": m.group(0) if m else None,
                            "trade_no": cells[cols["tradeno"]] if "tradeno" in cols and cols["tradeno"] < len(cells) else None,
                            "date": _iso(cells[cols["date"]]) if "date" in cols and cols["date"] < len(cells) else None,
                        })
                else:
                    # summary / obligation tables: label in first cell; the last numeric cell is the
                    # net total (earlier cells are per-exchange splits, so summing them double counts)
                    for row in table:
                        cells = [(c or "").strip() for c in row]
                        if not cells or not cells[0]:
                            continue
                        for key, rx in CHARGE_LABELS.items():
                            if rx.search(cells[0]):
                                nums = [abs(v) for v in (_num(c) for c in cells[1:]) if v is not None]
                                if nums:
                                    charges[key] = charges.get(key, 0.0) + nums[-1]
                                break

    for t in trades:
        t["date"] = t["date"] or trade_date
    return {
        "trade_date": trade_date,
        "trades": trades,
        "charges": {k: round(v, 2) for k, v in charges.items()},
        "total_charges": round(sum(v for k, v in charges.items()), 2),
        "pages": len(texts),
    }
