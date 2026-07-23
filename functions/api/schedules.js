// functions/api/schedules.js
// 개편: 전체 로드 제거 → Notion 날짜 필터 쿼리로 변경

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (method === 'OPTIONS') return new Response(null, { headers });

  try {
    if (method === 'GET') {
      const url = new URL(request.url);
      const startDate = url.searchParams.get('startDate');
      const endDate = url.searchParams.get('endDate');
      const instructorId = url.searchParams.get('instructorId');
      const memberId = url.searchParams.get('memberId');

      // Notion 날짜 필터 구성 (전체 로드 → 필터 쿼리로 변경)
      const filters = [];
      if (startDate) filters.push({ property: 'Date', date: { on_or_after: startDate } });
      if (endDate) filters.push({ property: 'Date', date: { on_or_before: endDate } });
      if (memberId) filters.push({ property: 'Member', relation: { contains: memberId } });

      const filterBody = filters.length === 1
        ? { filter: filters[0] }
        : filters.length > 1
          ? { filter: { and: filters } }
          : {};

      // 페이지네이션 (날짜 필터로 결과가 줄어 대부분 1페이지로 끝남)
      let allResults = [];
      let hasMore = true;
      let startCursor = undefined;

      while (hasMore) {
        const body = {
          ...filterBody,
          sorts: [
            { property: 'Date', direction: 'ascending' },
            { property: 'Time', direction: 'ascending' },
          ],
          page_size: 100,
        };
        if (startCursor) body.start_cursor = startCursor;

        const res = await fetch(
          `https://api.notion.com/v1/databases/${env.NOTION_SCHEDULE_DB_ID}/query`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.NOTION_API_KEY}`,
              'Notion-Version': '2022-06-28',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          }
        );

        const data = await res.json();
        if (!res.ok) return new Response(JSON.stringify({ error: data.message }), { status: 500, headers });

        allResults = allResults.concat(data.results || []);
        hasMore = data.has_more || false;
        startCursor = data.next_cursor;
      }

      let schedules = allResults.map(page => ({
        id: page.id,
        name: page.properties.Name?.title?.[0]?.plain_text || '',
        instructorId: page.properties.Instructor?.relation?.[0]?.id || '',
        instructorName: page.properties.InstructorName?.rich_text?.[0]?.plain_text || '',
        memberId: page.properties.Member?.relation?.[0]?.id || '',
        memberName: page.properties.MemberName?.rich_text?.[0]?.plain_text || '',
        contractId: page.properties.Contract?.relation?.[0]?.id || '',
        date: page.properties.Date?.date?.start || '',
        time: page.properties.Time?.select?.name || '',
        type: page.properties.Type?.select?.name || '',
        isRecurring: page.properties.IsRecurring?.checkbox || false,
        recurringDay: page.properties.RecurringDay?.select?.name || '',
        status: page.properties.Status?.select?.name || '',
      }));

      // instructorId 필터는 JS에서 (Notion relation 필터 복잡도 회피)
      if (instructorId) schedules = schedules.filter(s => s.instructorId === instructorId);

      return new Response(JSON.stringify({ schedules, total: schedules.length }), { headers });
    }

    // POST — 예약 등록
    if (method === 'POST') {
      const body = await request.json();
      const created = [];

      if (body.isRecurring && body.contractEndDate) {
        const dayMap = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5 };
        const targetDay = dayMap[body.recurringDay];
        const end = new Date(body.contractEndDate);

        let current = new Date(body.date);
        while (current.getDay() !== targetDay) {
          current.setDate(current.getDate() + 1);
        }

        while (current <= end) {
          const dateStr = `${current.getFullYear()}-${String(current.getMonth()+1).padStart(2,'0')}-${String(current.getDate()).padStart(2,'0')}`;
          const title = `${body.memberName || ''} · ${body.instructorName || ''} ${dateStr} ${body.time}`;
          const res = await createSchedule(env, { ...body, date: dateStr, title });
          if (res.id) created.push(res.id);
          current.setDate(current.getDate() + 7);
        }
      } else {
        const title = `${body.memberName || ''} · ${body.instructorName || ''} ${body.date} ${body.time}`;
        const res = await createSchedule(env, { ...body, title });
        if (res.id) created.push(res.id);
      }

      return new Response(JSON.stringify({ created, count: created.length, success: true }), { headers });
    }

    // PUT — 일정 수정
    if (method === 'PUT') {
      const url = new URL(request.url);
      const id = url.searchParams.get('id');
      const body = await request.json();

      const properties = {};
      if (body.date) properties.Date = { date: { start: body.date } };
      if (body.time) properties.Time = { select: { name: body.time } };
      if (body.status) properties.Status = { select: { name: body.status } };
      if (body.type) properties.Type = { select: { name: body.type } };
      if (body.name) properties.Name = { title: [{ text: { content: body.name } }] };

      const res = await fetch(`https://api.notion.com/v1/pages/${id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${env.NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties }),
      });

      if (!res.ok) {
        const data = await res.json();
        return new Response(JSON.stringify({ error: data.message }), { status: 500, headers });
      }
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    // DELETE — 일정 삭제
    if (method === 'DELETE') {
      const url = new URL(request.url);
      const id = url.searchParams.get('id');
      const res = await fetch(`https://api.notion.com/v1/pages/${id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${env.NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ archived: true }),
      });
      if (!res.ok) {
        const data = await res.json();
        return new Response(JSON.stringify({ error: data.message }), { status: 500, headers });
      }
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}

async function createSchedule(env, body) {
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { database_id: env.NOTION_SCHEDULE_DB_ID },
      properties: {
        Name: { title: [{ text: { content: body.title || '' } }] },
        Instructor: body.instructorId ? { relation: [{ id: body.instructorId }] } : undefined,
        InstructorName: body.instructorName ? { rich_text: [{ text: { content: body.instructorName } }] } : undefined,
        Member: body.memberId ? { relation: [{ id: body.memberId }] } : undefined,
        MemberName: body.memberName ? { rich_text: [{ text: { content: body.memberName } }] } : undefined,
        Contract: body.contractId ? { relation: [{ id: body.contractId }] } : undefined,
        Date: body.date ? { date: { start: body.date } } : undefined,
        Time: body.time ? { select: { name: body.time } } : undefined,
        Type: body.type ? { select: { name: body.type } } : undefined,
        IsRecurring: { checkbox: body.isRecurring || false },
        RecurringDay: body.recurringDay ? { select: { name: body.recurringDay } } : undefined,
        Status: { select: { name: body.status || '확정' } },
      },
    }),
  });
  return await res.json();
}
