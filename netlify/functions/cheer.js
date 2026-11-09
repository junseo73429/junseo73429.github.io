// Netlify Function: 작품 응원 저장 + 집계 조회
// - POST /api/cheer  { item_id }       → 반응 1건 저장 (로그인 불필요, 서버가 검사)
// - GET  /api/cheer                     → 작품별 누적 집계 반환
//
// 저장은 서버(service_role)만 수행. 브라우저가 테이블에 직접 쓰지 못함(RLS).
// 허용된 작품 번호만 저장(없는 번호 거절). 집계는 누적 반응 "횟수"다(중복 참여 허용).
//
// 필요한 환경변수:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE  (노출 금지)

// 허용된 작품 번호(화이트리스트). 화면의 작품과 일치해야 함.
const ALLOWED_ITEMS = ["photo-night", "animation-short", "poster"];
const PAGE = 1000;
const SCAN_CAP = 100000;

exports.handler = async (event) => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json(500, { error: "Server not configured" });
  }

  if (event.httpMethod === "GET") {
    return getCounts(SUPABASE_URL, SERVICE_ROLE);
  }
  if (event.httpMethod === "POST") {
    return addCheer(event, SUPABASE_URL, SERVICE_ROLE);
  }
  return json(405, { error: "Method Not Allowed" });
};

// 응원 1건 저장
async function addCheer(event, SUPABASE_URL, SERVICE_ROLE) {
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "요청 형식이 올바르지 않습니다." });
  }

  const itemId = typeof body.item_id === "string" ? body.item_id.trim() : "";
  if (!itemId) return json(400, { error: "작품 번호가 없습니다." });
  if (!ALLOWED_ITEMS.includes(itemId)) {
    return json(400, { error: "존재하지 않는 작품입니다." });
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/reactions`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify([{ item_id: itemId }]),
    });
    if (!res.ok) {
      const detail = await res.text();
      return json(500, { error: "저장 실패", detail });
    }
    // 저장 성공 후 최신 집계를 함께 반환
    return getCounts(SUPABASE_URL, SERVICE_ROLE);
  } catch {
    return json(502, { error: "데이터베이스에 연결할 수 없습니다." });
  }
}

// 작품별 누적 횟수 집계 (페이지네이션으로 누락 방지)
async function getCounts(SUPABASE_URL, SERVICE_ROLE) {
  try {
    const counts = {};
    ALLOWED_ITEMS.forEach((id) => { counts[id] = 0; });

    let from = 0;
    while (from < SCAN_CAP) {
      const to = from + PAGE - 1;
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/reactions?select=item_id`,
        {
          headers: {
            apikey: SERVICE_ROLE,
            Authorization: `Bearer ${SERVICE_ROLE}`,
            Range: `${from}-${to}`,
            "Range-Unit": "items",
          },
        }
      );
      if (!res.ok) {
        const detail = await res.text();
        return json(500, { error: "집계 조회 실패", detail });
      }
      const rows = await res.json();
      rows.forEach((r) => {
        if (counts[r.item_id] !== undefined) counts[r.item_id] += 1;
      });
      if (rows.length < PAGE) break;
      from += PAGE;
    }

    return json(200, { ok: true, counts });
  } catch {
    return json(502, { error: "데이터베이스에 연결할 수 없습니다." });
  }
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}
