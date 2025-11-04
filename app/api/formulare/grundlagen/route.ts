import { NextRequest, NextResponse } from 'next/server';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { parseFileName } from '../../../../lib/filename-helper';

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const formularId = searchParams.get('formularId');
    const kategorie = searchParams.get('kategorie');

    if (!formularId || !kategorie) {
      return NextResponse.json(
        { error: 'formularId und kategorie sind erforderlich' },
        { status: 400 }
      );
    }

    // Pfad: formulare/{kategorie}/{formularId}/grundlagen/
    const baseDir = join(process.cwd(), '..', 'formulare');
    const grundlagenDir = join(baseDir, kategorie, formularId, 'grundlagen');

    try {
      const files = await readdir(grundlagenDir);

      // Finde die Grundlagen-Dateien
      // Zuerst nach Schema suchen, dann Fallback zu Namensmustern
      let tplFile = files.find(f => {
        const parsed = parseFileName(f);
        return parsed?.artefakt === 'tpl' && parsed.ext === 'pdf';
      });

      // Fallback: Suche nach typischen Mustern für leeres PDF
      if (!tplFile) {
        tplFile = files.find(f =>
          f.toLowerCase().includes('leer') && f.endsWith('.pdf')
        ) || files.find(f =>
          f.toLowerCase().includes('ohne') && f.endsWith('.pdf') && !f.toLowerCase().includes('voll')
        ) || null;
      }

      let demoFile = files.find(f => {
        const parsed = parseFileName(f);
        return parsed?.artefakt === 'demo' && parsed.ext === 'pdf';
      });

      // Fallback: Suche nach typischen Mustern für gefülltes PDF
      if (!demoFile) {
        demoFile = files.find(f =>
          f.toLowerCase().includes('voll') && f.endsWith('.pdf')
        ) || files.find(f =>
          f.toLowerCase().includes('mit') && f.endsWith('.pdf')
        ) || null;
      }

      let demoXmlFile = files.find(f => {
        const parsed = parseFileName(f);
        return parsed?.artefakt === 'demo-xml' && parsed.ext === 'xml';
      });

      // Fallback: Suche nach XML-Dateien
      if (!demoXmlFile) {
        demoXmlFile = files.find(f => f.endsWith('.xml')) || null;
      }

      return NextResponse.json({
        success: true,
        files: {
          tpl: tplFile ? {
            name: tplFile,
            path: join(grundlagenDir, tplFile),
            exists: true
          } : { exists: false },
          demo: demoFile ? {
            name: demoFile,
            path: join(grundlagenDir, demoFile),
            exists: true
          } : { exists: false },
          demoXml: demoXmlFile ? {
            name: demoXmlFile,
            path: join(grundlagenDir, demoXmlFile),
            exists: true
          } : { exists: false }
        }
      });

    } catch (error: any) {
      // Ordner existiert nicht oder ist leer
      return NextResponse.json({
        success: true,
        files: {
          tpl: { exists: false },
          demo: { exists: false },
          demoXml: { exists: false }
        }
      });
    }

  } catch (error: any) {
    return NextResponse.json(
      { error: `Fehler beim Laden: ${error.message}` },
      { status: 500 }
    );
  }
}
