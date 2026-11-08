// Netlify Function: 점수 저장 (서버 사이드)
// - 공개 폴더와 분리되어 정적으로 노출되지 않음
// - Supabase 비밀 키는 환경변수에서만 읽음 (코드/깃에 하드코딩 금지)
//
// 필요한 Netlify 환경변수 (Site settings > Environment variables):
//   SUPABASE_URL           = https://<project-ref>.supabase.co
//   SUPABASE_SERVICE_ROLE  = <service_role key>  ← 절대 클라이언트에 노출 금지
//
// 클라이언트는 사용자 access token(JWT)을 Authorization 헤더로 전달.
// 서버는 그 토큰으로 사용자를 확인한 뒤, 본인(user_id) 기록만 저장한다.
// service_role 키는 RLS를 우회하므로, 서버가 직접 모든 입력을 검사한다.

const NICK_MAX = 20;
const SCORE_MAX = 10_000_000;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method Not Allowed" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json(500, { error: "Server not configured" });
  }

  // 1) 인증: access token 으로 실제 사용자 확인
  const authHeader = event.headers.authorization || event.headers.Authorization;
  const accessToken = authHeader && authHeader.replace(/^Bearer\s+/i, "");
  if (!accessToken) return json(401, { error: "로그인이 필요합니다." });

  let userId;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) return json(401, { error: "세션이 유효하지 않습니다." });
    const user = await userRes.json();
    userId = user && user.id;
    if (!userId) return json(401, { error: "세션이 유효하지 않습니다." });
  } catch {
    return json(502, { error: "인증 확인에 실패했습니다." });
  }

  // 2) 입력 파싱 + 서버측 검증 (빈 값 / 범위 / 길이)
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "요청 형식이 올바르지 않습니다." });
  }

  // 닉네임: 공백 제거 후 빈 값 금지, 길이 제한
  const nicknameRaw = typeof body.nickname === "string" ? body.nickname : "";
  const nickname = nicknameRaw.trim();
  if (!nickname) return json(400, { error: "닉네임을 입력하세요." });
  if (nickname.length > NICK_MAX) {
    return json(400, { error: `닉네임은 ${NICK_MAX}자 이하여야 합니다.` });
  }

  // 점수: 정수, 범위 검사
  const score = Number(body.score);
  if (!Number.isFinite(score) || !Number.isInteger(score) || score < 0 || score > SCORE_MAX) {
    return json(400, { error: "점수 값이 올바르지 않습니다." });
  }

  // 스테이지: 기본 1, 정수, 양수
  const stage = Number.isInteger(Number(body.stage)) ? Number(body.stage) : 1;
  if (stage < 1 || stage > 100000) {
    return json(400, { error: "스테이지 값이 올바르지 않습니다." });
  }

  // 3) 프로필 upsert (본인 id 로 강제) — 닉네임 저장/갱신
  try {
    const upsertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?on_conflict=id`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify([{ id: userId, nickname }]),
      }
    );
    if (!upsertRes.ok) {
      const detail = await upsertRes.text();
      return json(500, { error: "프로필 저장 실패", detail });
    }
  } catch {
    return json(502, { error: "데이터베이스에 연결할 수 없습니다." });
  }

  // 4) 점수 저장 (user_id 는 검증된 본인으로 강제)
  try {
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/scores`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify([{ user_id: userId, score, stage }]),
    });
    if (!insertRes.ok) {
      const detail = await insertRes.text();
      return json(500, { error: "점수 저장 실패", detail });
    }
    const rows = await insertRes.json();
    return json(200, { ok: true, saved: rows[0] });
  } catch {
    return json(502, { error: "데이터베이스에 연결할 수 없습니다." });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}
