// Netlify Function: 방명록 저장 + 조회
// - POST /api/guestbook  { nickname, message }  → 글 1건 저장 (서버가 검사)
// - GET  /api/guestbook                          → 최근 글 목록 반환
//
// 저장은 서버(service_role)만 수행. 브라우저 직접 쓰기는 RLS로 차단.
// 별명 2~12자, 메시지 1~100자. 서버에서도 길이/빈 값을 다시 검사한다.
//
// 필요한 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE (노출 금지)

const NICK_MIN = 2, NICK_MAX = 12;
const MSG_MIN = 1, MSG_MAX = 100;
const LIST_LIMIT = 50;

exports.handler = async (event) => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json(500, { error: "Server not configured" });
  }

  if (event.httpMethod === "GET") {
    return listEntries(SUPABASE_URL, SERVICE_ROLE);
  }
  if (event.httpMethod === "POST") {
    return addEntry(event, SUPABASE_URL, SERVICE_ROLE);
  }
  return json(405, { error: "Method Not Allowed" });
};

async function addEntry(event, SUPABASE_URL, SERVICE_ROLE) {
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "요청 형식이 올바르지 않습니다." });
  }

  const nickname = (typeof body.nickname === "string" ? body.nickname : "").trim();
  const message = (typeof body.message === "string" ? body.message : "").trim();

  if (!nickname) return json(400, { error: "별명을 입력하세요." });
  if (nickname.length < NICK_MIN || nickname.length > NICK_MAX) {
    return json(400, { error: `별명은 ${NICK_MIN}~${NICK_MAX}자여야 합니다.` });
  }
  if (!message) return json(400, { error: "메시지를 입력하세요." });
  if (message.length < MSG_MIN || message.length > MSG_MAX) {
    return json(400, { error: `메시지는 ${MSG_MIN}~${MSG_MAX}자여야 합니다.` });
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/guestbook`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify([{ nickname, message }]),
    });
    if (!res.ok) {
      const detail = await res.text();
      return json(500, { error: "저장 실패", detail });
    }
    return listEntries(SUPABASE_URL, SERVICE_ROLE); // 저장 후 최신 목록 반환
  } catch {
    return json(502, { error: "데이터베이스에 연결할 수 없습니다." });
  }
}

async function listEntries(SUPABASE_URL, SERVICE_ROLE) {
  try {
    const url =
      `${SUPABASE_URL}/rest/v1/guestbook` +
      `?select=nickname,message,created_at&order=created_at.desc`;
    const res = await fetch(url, {
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        Range: `0-${LIST_LIMIT - 1}`,
        "Range-Unit": "items",
      },
    });
    if (!res.ok) {
      const detail = await res.text();
      return json(500, { error: "조회 실패", detail });
    }
    const rows = await res.json();
    return json(200, { ok: true, count: rows.length, entries: rows });
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
