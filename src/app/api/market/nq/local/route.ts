import { readFile, stat } from "node:fs/promises";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOCAL_DATASET_PATH =
  process.env.NQ_LOCAL_CSV_PATH ?? "/Users/vincentla/Downloads/Dataset_NQ_1min_2022_2025.csv";

let cached:
  | {
      mtimeMs: number;
      rawCsv: string;
    }
  | undefined;

export async function GET() {
  try {
    const fileStat = await stat(LOCAL_DATASET_PATH);

    if (!cached || cached.mtimeMs !== fileStat.mtimeMs) {
      const rawCsv = await readFile(LOCAL_DATASET_PATH, "utf8");

      cached = {
        mtimeMs: fileStat.mtimeMs,
        rawCsv,
      };
    }

    return new NextResponse(cached.rawCsv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'inline; filename="Dataset_NQ_1min_2022_2025.csv"',
        "X-Local-Source": LOCAL_DATASET_PATH,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Local NQ dataset could not be loaded.",
        source: LOCAL_DATASET_PATH,
      },
      { status: 404 },
    );
  }
}
