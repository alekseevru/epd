import type { Metadata } from "next";
import { headers } from "next/headers";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  return {
    title: "AGR Документы перевозки",
    description: "Подготовка ЭЗЗ и электронных транспортных накладных",
    openGraph: { title: "AGR Документы перевозки", description: "ЭЗЗ · ЭТрН · Контур", images: [image] },
    twitter: { card: "summary_large_image", title: "AGR Документы перевозки", description: "ЭЗЗ · ЭТрН · Контур", images: [image] },
  };
}

export default function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
