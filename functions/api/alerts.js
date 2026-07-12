// functions/api/alerts.js
// 리마케팅 대상 회원 자동 감지
// - 장기 미출석 (30일↑, 60일↑)
// - 잔여 횟수 3회 이하
// - 계약 만료 임박 (7일 이내)

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (method === 'OPTIONS') return new Response(null, { headers });

  try {
    // 진행중인 계약 전체 조회
    const contractsRes = await fetch(
      `https://api.notion.com/v1/databases/${env.NOTION_CONTRACTS_DB_ID}/query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: {
            property: 'Status',
            select: { equals: '진행중' }
          }
        }),
      }
    );

    const contractsData = await contractsRes.json();
    const today = new Date();
    const alerts = [];

    for (const page of contractsData.results) {
      const memberId = page.properties.Member?.relation?.[0]?.id;
      const remaining = page.properties.RemainingSessions?.number || 0;
      const endDate = page.properties.EndDate?.date?.start;
      const contractId = page.id;
      const contractTitle = page.properties.Name?.title?.[0]?.plain_text || '';

      // 마지막 세션 날짜 조회
      const sessionsRes = await fetch(
        `https://api.notion.com/v1/databases/${env.NOTION_SESSIONS_DB_ID}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: {
              property: 'Contract',
              relation: { contains: contractId }
            },
            sorts: [{ property: 'Date', direction: 'descending' }],
            page_size: 1,
          }),
        }
      );

      const sessionsData = await sessionsRes.json();
      const lastSession = sessionsData.results[0];
      const lastDate = lastSession?.properties?.Date?.date?.start;

      let daysSinceLastSession = null;
      if (lastDate) {
        daysSinceLastSession = Math.floor(
          (today - new Date(lastDate)) / (1000 * 60 * 60 * 24)
        );
      }

      // 만료까지 남은 일수
      let daysUntilExpiry = null;
      if (endDate) {
        daysUntilExpiry = Math.floor(
          (new Date(endDate) - today) / (1000 * 60 * 60 * 24)
        );
      }

      // 알림 조건 체크
      const alertTypes = [];
      if (daysSinceLastSession >= 60) alertTypes.push('long_absence_60');
      else if (daysSinceLastSession >= 30) alertTypes.push('long_absence_30');
      if (remaining <= 3 && remaining > 0) alertTypes.push('low_sessions');
      if (remaining === 0) alertTypes.push('no_sessions');
      if (daysUntilExpiry !== null && daysUntilExpiry <= 7 && daysUntilExpiry >= 0) alertTypes.push('expiring_soon');

      if (alertTypes.length > 0) {
        alerts.push({
          contractId,
          contractTitle,
          memberId,
          remaining,
          lastDate,
          daysSinceLastSession,
          endDate,
          daysUntilExpiry,
          alertTypes,
        });
      }
    }

    return new Response(JSON.stringify({ alerts }), { headers });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
