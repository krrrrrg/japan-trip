import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url) {
      return NextResponse.json({ error: "URL 필요" }, { status: 400 });
    }

    // URL을 따라가서 최종 페이지 가져오기 (한국어 우선)
    const res = await fetch(url, {
      headers: {
        "Accept-Language": "ko-KR,ko;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
      },
      redirect: "follow",
    });

    const html = await res.text();
    const finalUrl = res.url;

    // 1. <title> 태그에서 이름 추출 (보통 "장소이름 - Google Maps")
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      let title = titleMatch[1].trim();
      // "장소이름 - Google Maps" 또는 "장소이름 · Google 지도" 패턴
      title = title
        .replace(/\s*[-·]\s*Google\s*(Maps|지도).*$/i, "")
        .trim();
      if (title && title !== "Google Maps" && title !== "Google 지도") {
        return NextResponse.json({ name: title, finalUrl });
      }
    }

    // 2. og:title 메타태그에서 추출
    const ogMatch = html.match(
      /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i
    );
    if (ogMatch) {
      let name = ogMatch[1].trim();
      name = name
        .replace(/\s*[-·]\s*Google\s*(Maps|지도).*$/i, "")
        .trim();
      if (name) {
        return NextResponse.json({ name, finalUrl });
      }
    }

    // 3. 최종 URL에서 /place/ 파싱 시도
    const placeMatch = finalUrl.match(/\/place\/([^/@]+)/);
    if (placeMatch) {
      const name = decodeURIComponent(placeMatch[1].replace(/\+/g, " "));
      return NextResponse.json({ name, finalUrl });
    }

    return NextResponse.json({ name: null, finalUrl });
  } catch (e) {
    return NextResponse.json(
      { error: String(e) },
      { status: 500 }
    );
  }
}
