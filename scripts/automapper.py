#!/usr/bin/env python3
"""
AutoMapper: Erzeugt mapping.json aus gefülltem PDF + XML + Blanko

CLI-Usage:
    python automapper.py <blank_pdf> <filled_pdf> <xml_file> <output_json>

WICHTIG: Koordinaten-Konvertierung PyMuPDF → pdf-lib
- PyMuPDF: Y=0 ist OBEN (Standard-Viewer-Koordinaten)
- pdf-lib: Y=0 ist UNTEN (PDF-Spezifikations-Koordinaten)
- Formel: y_pdflib = page_height - y_pymupdf
"""

import sys
import json
import hashlib
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import xml.etree.ElementTree as ET

try:
    import fitz  # PyMuPDF
except ImportError:
    print(json.dumps({"error": "PyMuPDF nicht installiert. Installiere mit: pip install PyMuPDF"}, indent=2), file=sys.stderr)
    sys.exit(1)

try:
    from rapidfuzz import fuzz
except ImportError:
    fuzz = None


def calculate_sha256(file_path: Path) -> str:
    """Berechnet SHA-256 Hash einer Datei"""
    sha256 = hashlib.sha256()
    with open(file_path, 'rb') as f:
        while chunk := f.read(8192):
            sha256.update(chunk)
    return sha256.hexdigest()


def read_xml_fields(xml_path: Path) -> Dict[str, str]:
    """Liest Feld-IDs und Werte aus XML"""
    tree = ET.parse(xml_path)
    root = tree.getroot()

    fields = {}

    # Namespace-aware Suche
    ns = {'': 'http://www.lucom.com/ffw/xml-data-1.0.xsd'}

    for elem in root.findall('.//{http://www.lucom.com/ffw/xml-data-1.0.xsd}element'):
        field_id = elem.get('id')
        value = elem.text or ''
        if field_id:
            fields[field_id] = value

    return fields


def create_anchor(value: str) -> str:
    """Erstellt Anker aus Feldwert (erste Zeile oder erste 50 Zeichen)"""
    if not value:
        return ''

    value = value.strip()
    value = ' '.join(value.split())
    value = value.replace('\xa0', ' ')
    value = value.replace('\u202f', ' ')

    lines = value.split('\n')
    anchor = lines[0] if lines else value

    if len(anchor) > 50:
        anchor = anchor[:50]

    return anchor


def find_text_in_pdf(pdf_path: Path, anchor: str, field_id: str) -> Optional[Tuple[int, float, float]]:
    """
    Findet Text im PDF und gibt (page, x, y_pdflib) zurück
    Y-Koordinate wird direkt für pdf-lib konvertiert!
    """
    doc = fitz.open(pdf_path)

    anchor_norm = anchor.lower().strip()
    anchor_variants = [
        anchor_norm,
        anchor_norm.replace(' ', ''),
        anchor_norm.replace(',', '.'),
    ]

    best_match = None
    best_score = 0

    for page_num in range(len(doc)):
        page = doc[page_num]
        page_height = page.rect.height

        text_dict = page.get_text("dict")

        for block in text_dict.get("blocks", []):
            if block.get("type") != 0:
                continue

            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span.get("text", "")
                    text_norm = text.lower().strip()

                    for variant in anchor_variants:
                        variant_short = variant[:15] if len(variant) > 15 else variant

                        if (variant in text_norm or
                            text_norm in variant or
                            text_norm.startswith(variant_short) or
                            variant_short in text_norm):

                            bbox = span["bbox"]
                            x_pymupdf = bbox[0]
                            y_pymupdf = bbox[3]

                            y_pdflib = page_height - y_pymupdf

                            if fuzz:
                                score = fuzz.ratio(variant, text_norm)
                            else:
                                if variant == text_norm:
                                    score = 100
                                elif text_norm in variant or variant in text_norm:
                                    score = 90
                                else:
                                    score = 70

                            if score > best_score:
                                best_score = score
                                best_match = (page_num + 1, x_pymupdf, y_pdflib)

    doc.close()
    return best_match


def detect_checkboxes_in_blank(blank_path: Path) -> List[Tuple[float, float]]:
    """
    Erkennt Checkbox-Positionen im Blanko-PDF
    Y-Koordinaten werden direkt für pdf-lib konvertiert!
    """
    doc = fitz.open(blank_path)
    page = doc[0]
    page_height = page.rect.height

    drawings = page.get_drawings()

    checkboxes = []
    for drawing in drawings:
        rect = drawing.get("rect")
        if rect:
            width = rect[2] - rect[0]
            height = rect[3] - rect[1]

            if 8 < width < 20 and 8 < height < 20:
                cx = (rect[0] + rect[2]) / 2
                cy_pymupdf = (rect[1] + rect[3]) / 2

                cy_pdflib = page_height - cy_pymupdf

                checkboxes.append((cx, cy_pdflib))

    doc.close()

    checkboxes.sort(key=lambda p: (-p[1], p[0]))

    return checkboxes


def create_mapping(
    blank_path: Path,
    filled_path: Path,
    xml_path: Path
) -> dict:
    """Erstellt das komplette Mapping"""

    template_hash = calculate_sha256(blank_path)
    fields = read_xml_fields(xml_path)
    checkboxes = detect_checkboxes_in_blank(blank_path)

    mapping_fields = []
    checkbox_idx = 0

    for field_id, value in fields.items():
        if field_id == 'ID_USER':
            continue

        if field_id.startswith('k') and field_id[1:].isdigit():
            if checkbox_idx < len(checkboxes):
                x, y_pdflib = checkboxes[checkbox_idx]
                mapping_fields.append({
                    "id": field_id,
                    "page": 1,
                    "type": "checkbox",
                    "x": round(x, 2),
                    "y": round(y_pdflib, 2),
                    "size": 12
                })
                checkbox_idx += 1
            continue

        anchor = create_anchor(value)
        if not anchor:
            continue

        result = find_text_in_pdf(filled_path, anchor, field_id)

        if result:
            page, x, y_pdflib = result

            width = 400 if '\n' in value else 250
            align = "right" if field_id in ['wert', 'wert2', 'datum', 'datum2', 'datum3'] else "left"

            mapping_fields.append({
                "id": field_id,
                "page": page,
                "x": round(x, 2),
                "y": round(y_pdflib, 2),
                "w": width,
                "size": 11,
                "lineHeight": 14,
                "align": align
            })

    mapping = {
        "template": "template.pdf",
        "template_sha256": template_hash,
        "template_source": blank_path.name,
        "font": "Helvetica",
        "size": 11,
        "lineHeight": 14,
        "status": "auto-generated",
        "fields": mapping_fields
    }

    return mapping


def main():
    """Hauptfunktion mit CLI-Args"""
    if len(sys.argv) != 5:
        error = {
            "error": "Usage: python automapper.py <blank_pdf> <filled_pdf> <xml_file> <output_json>"
        }
        print(json.dumps(error, indent=2), file=sys.stderr)
        sys.exit(1)

    blank_path = Path(sys.argv[1])
    filled_path = Path(sys.argv[2])
    xml_path = Path(sys.argv[3])
    output_path = Path(sys.argv[4])

    # Prüfe Dateien
    for path in [blank_path, filled_path, xml_path]:
        if not path.exists():
            error = {
                "error": f"Datei nicht gefunden: {path}",
                "file": str(path)
            }
            print(json.dumps(error, indent=2), file=sys.stderr)
            sys.exit(1)

    try:
        # Mapping erstellen
        mapping = create_mapping(blank_path, filled_path, xml_path)

        # Speichern
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(mapping, f, indent=2, ensure_ascii=False)

        # Erfolg als JSON ausgeben
        result = {
            "success": True,
            "fields_count": len(mapping['fields']),
            "output": str(output_path)
        }
        print(json.dumps(result, indent=2))

    except Exception as e:
        error = {
            "error": str(e),
            "type": type(e).__name__
        }
        print(json.dumps(error, indent=2), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
