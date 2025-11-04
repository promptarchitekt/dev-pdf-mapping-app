import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { generateMappingFileName } from '../../../lib/filename-helper';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { formularId, mapping, version = 'auto-generated' } = body;

    if (!formularId || !mapping) {
      return NextResponse.json(
        { error: 'formularId und mapping sind erforderlich' },
        { status: 400 }
      );
    }

    // Neue Struktur: formulare/{kategorie}/{formularId}/mappings/{version}/v1_YYYYMMDD_HHMM.json
    // formularId kann sein: "034122-spendenbescheinigung-geld" oder "steuern/spenden/034122-spendenbescheinigung-geld"
    const { kategorie } = body;

    // Bestimme Pfad: Falls kategorie vorhanden, nutze sie, sonst extrahiere aus formularId
    let formularPfad: string;
    if (kategorie && formularId.includes(kategorie)) {
      // formularId enthält bereits Kategorie
      formularPfad = formularId;
    } else if (kategorie) {
      // Kategorie separat übergeben
      formularPfad = `${kategorie}/${formularId}`;
    } else {
      // Fallback: versuche Kategorie aus formularId zu extrahieren oder nutze Standard
      formularPfad = formularId.includes('/') ? formularId : `steuern/spenden/${formularId}`;
    }

    const baseDir = join(process.cwd(), '..', 'formulare');
    const formularDir = join(baseDir, formularPfad);
    const mappingsDir = join(formularDir, 'mappings');
    const versionDir = join(mappingsDir, version);

    // Erstelle Verzeichnisse
    await mkdir(versionDir, { recursive: true });

    // Dateiname nach Schema: {id}-{kurz}-{artefakt}[-vN].{ext}
    // Extrahiere id und kurz aus formularId
    const [id, ...kurzParts] = formularId.split('-');
    const kurz = kurzParts.join('-');

    // Version bestimmen (v1, v2, etc.)
    const versionNumber = version === 'auto-generated' ? 'v1' : `v${Date.now() % 1000}`;

    // Generiere Dateinamen
    const filename = generateMappingFileName(
      formularId,
      version === 'auto-generated' ? 'auto' : 'manual',
      versionNumber
    );
    const filePath = join(versionDir, filename);

    // Speichere Mapping
    await writeFile(filePath, JSON.stringify(mapping, null, 2), 'utf-8');

    // Speichere auch als current.json (mit Schema-Namen)
    const currentFileName = generateMappingFileName(formularId, 'current');
    const currentPath = join(mappingsDir, currentFileName);
    await writeFile(currentPath, JSON.stringify(mapping, null, 2), 'utf-8');

    return NextResponse.json({
      success: true,
      path: filePath,
      currentPath: currentPath,
      message: `Mapping gespeichert: ${filename}`
    });

  } catch (error: any) {
    return NextResponse.json(
      { error: `Fehler beim Speichern: ${error.message}` },
      { status: 500 }
    );
  }
}
