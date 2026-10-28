"""Price schema helpers. A schema is "a-f:75,g-k:60,l-z:50" (row-letter ranges) or one number for hallless-seatplan halls."""
import re

MAX_PRICE = 32767
_PART = re.compile(r"^([a-z])(?:-([a-z]))?:(\d{1,5})$")


class PriceError(ValueError):
    pass


def hall_rows(hall):
    """Row letters in display order (front/back as stored), aisle markers '-' skipped."""
    rows = []
    for row_dict in hall.seats.get('all', []):
        rows.extend(r for r in row_dict if r != '-')
    return rows


def parse_schema(text):
    """'a-f:75, g:60' -> {'a': 75, ..., 'f': 75, 'g': 60}. Raises PriceError on junk."""
    prices = {}
    for part in (p.strip().lower() for p in (text or '').split(',') if p.strip()):
        m = _PART.match(part)
        if not m:
            raise PriceError(f'Anlaşılmayan parça: "{part}" (beklenen: a-f:75)')
        start, end, price = m.group(1), m.group(2) or m.group(1), int(m.group(3))
        if ord(end) < ord(start):
            raise PriceError(f'Aralık ters: "{part}"')
        if price > MAX_PRICE:
            raise PriceError(f'Fiyat çok büyük: {price}')
        for c in range(ord(start), ord(end) + 1):
            prices[chr(c)] = price
    return prices


def format_schema(row_prices):
    """{'a': 75, 'b': 75, 'g': 60} -> 'a-b:75,g:60' (merges letters that are adjacent in the alphabet)."""
    out, run = [], None
    for row in sorted(row_prices):
        price = row_prices[row]
        if run and run[2] == price and ord(row) == ord(run[1]) + 1:
            run[1] = row
        else:
            run = [row, row, price]
            out.append(run)
    return ','.join(f'{a}-{b}:{p}' if a != b else f'{a}:{p}' for a, b, p in out)


def row_prices_from_post(post, rows):
    """Reads price_<row> fields. Every seat row must have a price (an unpriced row used to crash the day page)."""
    prices = {}
    for row in rows:
        raw = (post.get(f'price_{row}') or '').strip()
        if not raw.isdigit() or not 0 <= int(raw) <= MAX_PRICE:
            raise PriceError(f'"{row.upper()}" sırası için geçerli bir fiyat girin')
        prices[row] = int(raw)
    return prices


def tiers(row_prices):
    """Distinct prices, highest first -> {price: (category 1..n, hue)}. Category 1 = most expensive."""
    distinct = sorted(set(row_prices.values()), reverse=True)
    n = len(distinct)
    return {p: (i + 1, 200 if n == 1 else 150 + round(210 * (n - 1 - i) / (n - 1))) for i, p in enumerate(distinct)}
