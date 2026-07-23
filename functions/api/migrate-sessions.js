// functions/api/migrate-sessions.js
// 1회성 마이그레이션: Sessions DB 카운트 → Contracts DB UsedSessions 동기화
// 실행 후 삭제해도 됨

export async function onRequest(context) {
  const { request, env } = context;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { headers });

  try {
    // 1. 전체 계약 조회
    let allContracts = [];
    let hasMore = true;
    let startCursor = undefined;
    while (hasMore) {
      const body = { page_size: 100 };
      if (startCursor) body.start_cursor = startCursor;
      const res = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_CONTRACTS_DB_ID}/query`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.NOTION_API_KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      allContracts = allContracts.concat(data.results || []);
      hasMore = data.has_more || false;
      startCursor = data.next_cursor;
    }

    // 2. 전체 세션 조회
    let allSessions = [];
    hasMore = true; startCursor = undefined;
    while (hasMore) {
      const body = { page_size: 100 };
      if (startCursor) body.start_cursor = startCursor;
      const res = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_SESSIONS_DB_ID}/query`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.NOTION_API_KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      allSessions = allSessions.concat(data.results || []);
      hasMore = data.has_more || false;
      startCursor = data.next_cursor;
    }

    // 3. 계약별 세션 수 집계 (참석인 세션만 카운트)
    const sessionCountMap = {};
    allSessions.forEach(s => {
      const cid = s.properties.Contract?.relation?.[0]?.id;
      const status = s.properties.AttendanceStatus?.select?.name || '';
      if (cid && (status === '참석' || status === '노쇼')) {
        sessionCountMap[cid] = (sessionCountMap[cid] || 0) + 1;
      }
    });

    // 4. 각 계약의 UsedSessions 업데이트
    const results = [];
    for (const contract of allContracts) {
      const cid = contract.id;
      const contractName = contract.properties.Name?.title?.[0]?.plain_text || cid;
      const actualCount = sessionCountMap[cid] || 0;
      const currentUsed = contract.properties.UsedSessions?.number || 0;

      if (currentUsed === actualCount) {
        results.push({ id: cid, name: contractName, skipped: true, count: actualCount });
        continue;
      }

      try {
        await fetch(`https://api.notion.com/v1/pages/${cid}`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${env.NOTION_API_KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
          body: JSON.stringify({ properties: { UsedSessions: { number: actualCount } } }),
        });
        results.push({ id: cid, name: contractName, updated: true, from: currentUsed, to: actualCount });
      } catch(e) {
        results.push({ id: cid, name: contractName, error: e.message });
      }
    }

    const updated = results.filter(r => r.updated).length;
    const skipped = results.filter(r => r.skipped).length;

    return new Response(JSON.stringify({
      success: true,
      total: allContracts.length,
      updated,
      skipped,
      sessions: allSessions.length,
      results,
    }), { headers });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
