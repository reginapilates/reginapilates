// functions/api/auth.js

export async function onRequest(context) {
  const { request, env } = context;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  const body = await request.json();
  const { password, loginId, loginPassword } = body;

  // ── ID/PW 로그인 (admin + instructor 공통) ──
  if (loginId && loginPassword) {

    // 1순위: env 변수 비밀번호 fallback (LoginId 필드 미설정 시 또는 긴급 접근용)
    // admin ID/PW가 env와 일치하면 바로 통과
    if (loginId === 'admin' && loginPassword === env.ADMIN_PASSWORD_L1) {
      return new Response(JSON.stringify({ success: true, level: 1 }), { headers });
    }

    // 2순위: Notion Instructors DB에서 LoginId 조회
    try {
      const res = await fetch(
        `https://api.notion.com/v1/databases/${env.NOTION_INSTRUCTORS_DB_ID}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: {
              and: [
                { property: 'LoginId', rich_text: { equals: loginId } },
                { property: 'IsActive', checkbox: { equals: true } },
              ]
            }
          }),
        }
      );
      const data = await res.json();
      const page = (data.results || [])[0];

      if (page) {
        const storedPw = page.properties.LoginPassword?.rich_text?.[0]?.plain_text || '';
        if (storedPw && storedPw === loginPassword) {
          const levelStr = page.properties.Level?.select?.name || '2';
          const instructor = {
            id: page.id,
            name: page.properties.Name?.title?.[0]?.plain_text || '',
            level: levelStr,
            isDirector: levelStr === '1',
          };
          return new Response(JSON.stringify({
            success: true,
            level: parseInt(levelStr) || 2,
            instructor,
          }), { headers });
        }
      }

      return new Response(JSON.stringify({ success: false, error: 'invalid_credentials' }), { headers });

    } catch(e) {
      return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers });
    }
  }

  // ── 기존 비밀번호 단독 로그인 (하위 호환) ──
  if (password) {
    if (password === env.ADMIN_PASSWORD_L1) {
      return new Response(JSON.stringify({ success: true, level: 1 }), { headers });
    }
    if (password === env.ADMIN_PASSWORD_L2) {
      return new Response(JSON.stringify({ success: true, level: 2 }), { headers });
    }
    return new Response(JSON.stringify({ success: false }), { headers });
  }

  return new Response(JSON.stringify({ success: false, error: 'no_credentials' }), { headers });
}
