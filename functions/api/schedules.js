// functions/api/schedules.js

const TIMES = ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00'];

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
    // GET — 일정 조회
    if (method === 'GET') {
      const url = new URL(request.url);
      const startDate = url.searchParams.get('startDate');
      const endDate = url.searchParams.get('endDate');
      const instructorId = url.searchParams.get('instructorId');
      const memberId = url.searchParams.get('memberId');

      const filters = [];
      if (startDate) filters.push({ property: 'Date', date: { on_or_after: startDate } });
      if (endDate) filters.push({ property: 'Date', date: { on_or_before: endDate } });
      if (instructorId) filters.push({ property: 'Instructor', relation: { contains: instructorId } });
      if (memberId) filters.push({ property: 'Member', relation: { contains: memberId } });

      const filter = filters.length > 1 ? { and: filters } : filters.length === 1 ? filters[0] : undefined;

      const res = await fetch(
        `https://api.notion.com/v1/databases/${env.NOTION_SCHEDULE_DB_ID}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter,
            sorts: [
              { property: 'Date', direction: 'ascending' },
              { property: 'Time', direction: 'ascending' },
            ],
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) return new Response(JSON.stringify({ error: data.message }), { status: 500, headers });

      const schedules = (data.results || []).map(page => ({
        id: page.id,
        name: page.properties.Name?.title?.[0]?.plain_text || '',
        instructorId: page.properties.Instructor?.relation?.[0]?.id || '',
        memberId: page.properties.Member?.relation?.[0]?.id || '',
        contractId: page.properties.Contract?.relation?.[0]?.id || '',
        date: page.properties.Date?.date?.start || '',
        time: page.properties.Time?.select?.name || '',
        type: page.properties.Type?.select?.name || '',
        isRecurring: page.properties.IsRecurring?.checkbox || false,
        recurringDay: page.properties.RecurringDay?.select?.name || '',
        status: page.properties.Status?.select?.name || '',
      }));

      return new Response(JSON.stringify({ schedules }), { headers });
    }

    // POST — 예약 등록 (정기일정 포함)
    if (method === 'POST') {
      const body = await request.json();
      const created = [];

      if (body.isRecurring && body.contractEndDate) {
        // 정기 일정 — 계약 종료일까지 매주 생성
        const dayMap = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5 };
        const targetDay = dayMap[body.recurringDay];
        const start = new Date(body.date);
        const end = new Date(body.contractEndDate);

        let current = new Date(start);
        // 첫 날짜가 해당 요일이 되도록 조정
        while (current.getDay() !== targetDay) {
          current.setDate(current.getDate() + 1);
        }

        while (current <= end) {
          const dateStr = current.toISOString().split('T')[0];
          const memberName = body.memberName || '';
          const title = `${memberName} - ${dateStr} ${body.time}`;

          const res = await createSchedule(env, {
            ...body,
            date: dateStr,
            title,
          });
          if (res.id) created.push(res.id);
          current.setDate(current.getDate() + 7);
        }
      } else {
        // 단일 일정
        const title = `${body.memberName || body.instructorName || ''} - ${body.date} ${body.time}`;
        const res = await createSchedule(env, { ...body, title });
        if (res.id) created.push(res.id);
      }

      return new Response(JSON.stringify({ created, count: created.length, success: true }), { headers });
    }

    // PUT — 일정 수정 (상태변경, 날짜/시간 변경)
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
        Member: body.memberId ? { relation: [{ id: body.memberId }] } : undefined,
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
