// functions/api/auth.js

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (method === 'OPTIONS') return new Response(null, { headers });

  if (method === 'POST') {
    const body = await request.json();
    const { password } = body;

    if (!password) {
      return new Response(JSON.stringify({ error: '비밀번호를 입력해주세요' }), { status: 400, headers });
    }

    if (password === env.ADMIN_PASSWORD_L1) {
      return new Response(JSON.stringify({ success: true, level: 1 }), { headers });
    }

    if (password === env.ADMIN_PASSWORD_L2) {
      return new Response(JSON.stringify({ success: true, level: 2 }), { headers });
    }

    return new Response(JSON.stringify({ error: '비밀번호가 올바르지 않습니다' }), { status: 401, headers });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
}
