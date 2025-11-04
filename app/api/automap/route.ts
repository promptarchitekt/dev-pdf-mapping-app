import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { writeFile, readFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const useExisting = formData.get('useExisting') === 'true';
    const formularId = formData.get('formularId') as string;
    const kategorie = formData.get('kategorie') as string;

    let blankPdf: File | null = formData.get('blankPdf') as File | null;
    let filledPdf: File | null = formData.get('filledPdf') as File | null;
    let xmlFile: File | null = formData.get('xmlFile') as File | null;

    // Wenn vorhandene Dateien verwendet werden sollen, lade sie vom Server
    if (useExisting && formularId && kategorie) {
      const baseDir = join(process.cwd(), '..', 'formulare');
      const grundlagenDir = join(baseDir, kategorie, formularId, 'grundlagen');

      try {
        const files = await readdir(grundlagenDir);
        const { parseFileName } = await import('../../../lib/filename-helper');

        // Finde die Dateien
        const tplFile = files.find(f => {
          const parsed = parseFileName(f);
          return parsed?.artefakt === 'tpl' && parsed.ext === 'pdf';
        });
        const demoFile = files.find(f => {
          const parsed = parseFileName(f);
          return parsed?.artefakt === 'demo' && parsed.ext === 'pdf';
        });
        const demoXmlFile = files.find(f => {
          const parsed = parseFileName(f);
          return parsed?.artefakt === 'demo-xml' && parsed.ext === 'xml';
        });

        // Lade Dateien nur wenn sie nicht bereits hochgeladen wurden
        if (tplFile && !blankPdf) {
          const content = await readFile(join(grundlagenDir, tplFile));
          blankPdf = new File([content], tplFile, { type: 'application/pdf' });
        }
        if (demoFile && !filledPdf) {
          const content = await readFile(join(grundlagenDir, demoFile));
          filledPdf = new File([content], demoFile, { type: 'application/pdf' });
        }
        if (demoXmlFile && !xmlFile) {
          const content = await readFile(join(grundlagenDir, demoXmlFile));
          xmlFile = new File([content], demoXmlFile, { type: 'application/xml' });
        }
      } catch (error: any) {
        return NextResponse.json(
          { error: `Fehler beim Laden vorhandener Dateien: ${error.message}` },
          { status: 500 }
        );
      }
    }

    if (!blankPdf || !filledPdf || !xmlFile) {
      return NextResponse.json(
        { error: 'Alle drei Dateien müssen verfügbar sein: blankPdf, filledPdf, xmlFile' },
        { status: 400 }
      );
    }

    // Temporäres Verzeichnis erstellen
    const tempDir = join(tmpdir(), `automap-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const blankPath = join(tempDir, 'blank.pdf');
    const filledPath = join(tempDir, 'filled.pdf');
    const xmlPath = join(tempDir, 'data.xml');
    const outputPath = join(tempDir, 'mapping.json');

    // Dateien speichern
    await writeFile(blankPath, Buffer.from(await blankPdf.arrayBuffer()));
    await writeFile(filledPath, Buffer.from(await filledPdf.arrayBuffer()));
    await writeFile(xmlPath, Buffer.from(await xmlFile.arrayBuffer()));

    // Python-Script ausführen
    const scriptPath = join(process.cwd(), 'scripts', 'automapper.py');

    return new Promise<NextResponse>((resolve) => {
      const python = spawn('python', [
        scriptPath,
        blankPath,
        filledPath,
        xmlPath,
        outputPath
      ]);

      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      python.on('close', async (code) => {
        try {
          if (code !== 0) {
            // Versuche JSON-Fehler aus stderr zu parsen
            let errorMsg = stderr || 'Python-Script fehlgeschlagen';
            try {
              const errorJson = JSON.parse(stderr);
              errorMsg = errorJson.error || errorMsg;
            } catch {
              // Nicht JSON, verwende rohen Text
            }

            resolve(NextResponse.json(
              { error: errorMsg },
              { status: 500 }
            ));
            return;
          }

          // Mapping-JSON lesen
          const mappingJson = await readFile(outputPath, 'utf-8');
          const mapping = JSON.parse(mappingJson);

          console.log("✅ Python-Script erfolgreich:", {
            fieldsCount: mapping.fields?.length || 0,
            hasTemplateSha256: !!mapping.template_sha256
          });

          // Mapping mit Output-Info zurückgeben
          resolve(NextResponse.json({
            success: true,
            mapping,
            fieldsCount: mapping.fields?.length || 0,
            message: `Mapping erfolgreich erstellt: ${mapping.fields?.length || 0} Felder gefunden`
          }));

        } catch (error: any) {
          resolve(NextResponse.json(
            { error: `Fehler beim Lesen des Mappings: ${error.message}` },
            { status: 500 }
          ));
        }
      });

      python.on('error', (error) => {
        resolve(NextResponse.json(
          { error: `Python nicht gefunden oder Fehler beim Starten: ${error.message}. Bitte Python installieren.` },
          { status: 500 }
        ));
      });
    });

  } catch (error: any) {
    return NextResponse.json(
      { error: `Fehler: ${error.message}` },
      { status: 500 }
    );
  }
}
