import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const formularId = searchParams.get('formularId');
    const kategorie = searchParams.get('kategorie');
    const fileType = searchParams.get('type'); // 'tpl', 'demo', 'demo-xml'

    if (!formularId || !kategorie || !fileType) {
      return NextResponse.json(
        { error: 'formularId, kategorie und type sind erforderlich' },
        { status: 400 }
      );
    }

    // Pfad: formulare/{kategorie}/{formularId}/grundlagen/
    const baseDir = join(process.cwd(), '..', 'formulare');
    const grundlagenDir = join(baseDir, kategorie, formularId, 'grundlagen');

    try {
      const { readdir } = await import('fs/promises');
      const { parseFileName } = await import('../../../../../lib/filename-helper');

      const files = await readdir(grundlagenDir);

      // Finde die Datei basierend auf type
      let targetFile: string | null = null;

      if (fileType === 'tpl') {
        // Zuerst nach Schema suchen
        targetFile = files.find(f => {
          const parsed = parseFileName(f);
          return parsed?.artefakt === 'tpl' && parsed.ext === 'pdf';
        }) || null;

        // Fallback: Suche nach typischen Mustern
        if (!targetFile) {
          targetFile = files.find(f =>
            f.toLowerCase().includes('leer') && f.endsWith('.pdf')
          ) || files.find(f =>
            f.toLowerCase().includes('ohne') && f.endsWith('.pdf') && !f.toLowerCase().includes('voll')
          ) || null;
        }
      } else if (fileType === 'demo') {
        // Zuerst nach Schema suchen
        targetFile = files.find(f => {
          const parsed = parseFileName(f);
          return parsed?.artefakt === 'demo' && parsed.ext === 'pdf';
        }) || null;

        // Fallback: Suche nach typischen Mustern
        if (!targetFile) {
          targetFile = files.find(f =>
            f.toLowerCase().includes('voll') && f.endsWith('.pdf')
          ) || files.find(f =>
            f.toLowerCase().includes('mit') && f.endsWith('.pdf')
          ) || null;
        }
      } else if (fileType === 'demo-xml') {
        // Zuerst nach Schema suchen
        targetFile = files.find(f => {
          const parsed = parseFileName(f);
          return parsed?.artefakt === 'demo-xml' && parsed.ext === 'xml';
        }) || null;

        // Fallback: Suche nach XML-Dateien
        if (!targetFile) {
          targetFile = files.find(f => f.endsWith('.xml')) || null;
        }
      }

      if (!targetFile) {
        return NextResponse.json(
          { error: `Datei nicht gefunden für type: ${fileType}` },
          { status: 404 }
        );
      }

      const filePath = join(grundlagenDir, targetFile);
      const fileContent = await readFile(filePath);

      // Bestimme Content-Type
      const contentType = filePath.endsWith('.pdf')
        ? 'application/pdf'
        : filePath.endsWith('.xml')
        ? 'application/xml'
        : 'application/octet-stream';

      // Setze Content-Disposition Header für Download
      return new NextResponse(fileContent, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${targetFile}"`,
        },
      });

    } catch (error: any) {
      return NextResponse.json(
        { error: `Fehler beim Laden: ${error.message}` },
        { status: 500 }
      );
    }

  } catch (error: any) {
    return NextResponse.json(
      { error: `Fehler: ${error.message}` },
      { status: 500 }
    );
  }
}
