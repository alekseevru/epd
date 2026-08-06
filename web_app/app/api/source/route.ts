import { NextRequest, NextResponse } from "next/server";

function directGoogleDriveUrl(value: string) {
  const url = new URL(value);
  if (!["drive.google.com", "docs.google.com"].includes(url.hostname)) {
    throw new Error("Разрешены только ссылки Google Drive и Google Таблиц");
  }

  const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
  if (fileMatch) return `https://drive.google.com/uc?export=download&id=${fileMatch[1]}`;

  const sheetMatch = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (sheetMatch) return `https://docs.google.com/spreadsheets/d/${sheetMatch[1]}/export?format=xlsx`;

  if (url.hostname === "drive.google.com" && url.searchParams.get("id")) {
    return `https://drive.google.com/uc?export=download&id=${url.searchParams.get("id")}`;
  }

  throw new Error("Не удалось распознать ссылку Google Drive");
}

export async function GET(request: NextRequest) {
  try {
    const source = request.nextUrl.searchParams.get("url");
    if (!source) return NextResponse.json({ error: "Ссылка не указана" }, { status: 400 });

    const response = await fetch(directGoogleDriveUrl(source), { redirect: "follow" });
    if (!response.ok) throw new Error(`Google Drive вернул ошибку ${response.status}`);

    const bytes = await response.arrayBuffer();
    const type = response.headers.get("content-type") ?? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return new NextResponse(bytes, { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить источник" }, { status: 400 });
  }
}
