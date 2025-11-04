import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  try {
    const { path } = await req.json();

    if (!path || typeof path !== 'string') {
      return NextResponse.json(
        { error: 'Pfad ist erforderlich' },
        { status: 400 }
      );
    }

    // Windows: Öffne Ordner im Explorer
    // PowerShell-Befehl: explorer.exe /select,"path" oder einfach explorer.exe "path"
    const command = `explorer.exe "${path}"`;

    try {
      await execAsync(command);
      return NextResponse.json({ success: true });
    } catch (error: any) {
      return NextResponse.json(
        { error: `Fehler beim Öffnen des Ordners: ${error.message}` },
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
