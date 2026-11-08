// Netlify Function: 리더보드 조회 (서버 사이드)
// - scores 를 점수 내림차순으로 읽어 상위 N개를 반환
// - Supabase REST 는 한 번에 최대 1000행만 주므로,
//   range 헤더로 페이지네이션하여 누락 없이 집계한다.
// - 읽기 전용. anon 키는 공개라도 되지만, 집계 로직을 서버에 두어
//   조회 건수 제한으로 결과가 잘리지 않게 한다.
//
// 필요한 환경변수:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE  (읽기에도 사용; 노출 금지)

const PAGE = 1000;       // Supabase 1회 최대 행수
const TOP_DEFAULT = 20;  // 반환할 상위 개수
const SCAN_CAP = 10000;  // 과도한 스캔 방지 상한

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method Not Allowed" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json(500, { error: "Server not configured" });
  }

  const topParam = Number(event.queryStringParameters?.top);
  const top = Number.isInteger(topParam) && topParam > 0 && topParam <= 100
    ? topParam
    : TOP_DEFAULT;

  try {
    // 1) scores 를 점수 내림차순으로 페이지네이션하여 상위 N개를 모은다.
    //    (scores↔profiles 직접 외래키가 없어 조인 대신 2단계로 조회한다.)
    const select = "user_id,score,stage,played_at";
    const collected = [];
    let from = 0;

    while (from < SCAN_CAP) {
      const to = from + PAGE - 1;
      const url =
        `${SUPABASE_URL}/rest/v1/scores` +
        `?select=${encodeURIComponent(select)}` +
        `&order=score.desc,played_at.asc`;
      const res = await fetch(url, {
        headers: {
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
          Range: `${from}-${to}`,
          "Range-Unit": "items",
        },
      });
      if (!res.ok) {
        const detail = await res.text();
        return json(500, { error: "조회 실패", detail });
      }
      const rows = await res.json();
      collected.push(...rows);
      if (rows.length < PAGE) break; // 마지막 페이지
      from += PAGE;
      if (collected.length >= top) break; // 상위 확보 (정렬돼 있음)
    }

    const topRows = collected.slice(0, top);

    // 2) 상위 행들의 user_id 로 profiles 의 닉네임을 한 번에 조회한다.
    const nickById = {};
    const ids = [...new Set(topRows.map((r) => r.user_id).filter(Boolean))];
    if (ids.length > 0) {
      const inList = ids.map((id) => `"${id}"`).join(",");
      const purl =
        `${SUPABASE_URL}/rest/v1/profiles` +
        `?select=id,nickname&id=in.(${encodeURIComponent(inList)})`;
      const pres = await fetch(purl, {
        headers: {
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
        },
      });
      if (pres.ok) {
        const profs = await pres.json();
        profs.forEach((p) => { nickById[p.id] = p.nickname; });
      }
      // 닉네임 조회 실패해도 리더보드는 점수만으로 반환 (실패를 성공처럼 숨기지 않되,
      // 치명적이지 않은 부가정보라 '(알 수 없음)'으로 대체)
    }

    const leaderboard = topRows.map((r) => ({
      nickname: nickById[r.user_id] || "(알 수 없음)",
      score: r.score,
      stage: r.stage,
      played_at: r.played_at,
    }));

    return json(200, { ok: true, count: leaderboard.length, leaderboard });
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
