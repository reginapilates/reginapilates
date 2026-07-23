// functions/api/members.js

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
      const response = await fetch(
        `https://api.notion.com/v1/databases/${env.NOTION_MEMBERS_DB_ID}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sorts: [{ property: 'CreatedAt', direction: 'descending' }],
          }),
        }
      );

      const data = await response.json();
      if (!response.ok) {
        return new Response(JSON.stringify({ error: data.message || 'Notion API error', data }), { status: 500, headers });
      }

      const results = data.results || [];
      const members = results.map(page => ({
        id: page.id,
        name: page.properties.Name?.title?.[0]?.plain_text || '',
        phone: page.properties.Phone?.phone_number || '',
        email: page.properties.Email?.email || '',
        birthDate: page.properties.BirthDate?.date?.start || '',
        address: page.properties.Address?.rich_text?.[0]?.plain_text || '',
        height: page.properties.Height?.number || null,
        weight: page.properties.Weight?.number || null,
        jobType: page.properties.JobType?.select?.name || '',
        pilatesExpType: page.properties.PilatesExpType?.select?.name || '',
        pilatesExpCount: page.properties.PilatesExpCount?.number || null,
        exerciseExp: page.properties.ExerciseExp?.rich_text?.[0]?.plain_text || '',
        pilatesCert: page.properties.PilatesCert?.checkbox || false,
        pilatesCertOrg: page.properties.PilatesCertOrg?.rich_text?.[0]?.plain_text || '',
        pilatesCertYears: page.properties.PilatesCertYears?.number || null,
        stopReasons: page.properties.StopReasons?.select?.name || '',
        exerciseGoals: page.properties.ExerciseGoals?.multi_select?.map(s => s.name).join(', ') || '',
        exerciseGoalsEtc: page.properties.ExerciseGoalsEtc?.rich_text?.[0]?.plain_text || '',
        surgery: page.properties.Surgery?.checkbox || false,
        surgeryDetail: page.properties.SurgeryDetail?.rich_text?.[0]?.plain_text || '',
        medicalHistory: page.properties.MedicalHistory?.multi_select?.map(s => s.name).join(', ') || '',
        medicalHistoryEtc: page.properties.MedicalHistoryEtc?.rich_text?.[0]?.plain_text || '',
        painAreas: page.properties.PainAreas?.multi_select?.map(s => s.name).join(', ') || '',
        painAreasEtc: page.properties.PainAreasEtc?.rich_text?.[0]?.plain_text || '',
        visitSource: page.properties.VisitSource?.select?.name || '',
        availableTime: page.properties.AvailableTime?.select?.name || '',
        availableDays: page.properties.AvailableDays?.multi_select?.map(s => s.name).join(', ') || '',
        marketingConsent: page.properties.MarketingConsent?.checkbox || false,
        adConsent: page.properties.AdConsent?.checkbox || false,
        createdAt: page.properties.CreatedAt?.date?.start || '',
        token: page.properties.Token?.rich_text?.[0]?.plain_text || '',
      }));

      const url = new URL(request.url);
      const search = url.searchParams.get('search') || '';
      const filtered = search
        ? members.filter(m => m.name.includes(search) || m.phone.includes(search))
        : members;

      return new Response(JSON.stringify({ members: filtered }), { headers });
    }

    if (method === 'POST') {
      const body = await request.json();

      // 다중선택 값을 배열로 변환
      const toMultiSelect = (str) => str
        ? str.split(',').map(s => s.trim()).filter(Boolean).map(name => ({ name }))
        : [];

      const response = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parent: { database_id: env.NOTION_MEMBERS_DB_ID },
          properties: {
            Name: { title: [{ text: { content: body.name } }] },
            Email: body.email ? { email: body.email } : undefined,
            Phone: body.phone ? { phone_number: body.phone } : undefined,
            BirthDate: body.birthDate ? { date: { start: body.birthDate } } : undefined,
            Address: { rich_text: [{ text: { content: body.address || '' } }] },
            Height: body.height ? { number: body.height } : undefined,
            Weight: body.weight ? { number: body.weight } : undefined,
            JobType: body.jobType ? { select: { name: body.jobType } } : undefined,
            PilatesExpType: body.pilatesExpType ? { select: { name: body.pilatesExpType } } : undefined,
            PilatesExpCount: body.pilatesExpCount ? { number: body.pilatesExpCount } : undefined,
            ExerciseExp: { rich_text: [{ text: { content: body.exerciseExp || '' } }] },
            PilatesCert: { checkbox: body.pilatesCert || false },
            PilatesCertOrg: { rich_text: [{ text: { content: body.pilatesCertOrg || '' } }] },
            PilatesCertYears: body.pilatesCertYears ? { number: body.pilatesCertYears } : undefined,
            StopReasons: body.stopReasons ? { select: { name: body.stopReasons } } : undefined,
            ExerciseGoals: { multi_select: toMultiSelect(body.exerciseGoals) },
            ExerciseGoalsEtc: { rich_text: [{ text: { content: body.exerciseGoalsEtc || '' } }] },
            Surgery: { checkbox: body.surgery || false },
            SurgeryDetail: { rich_text: [{ text: { content: body.surgeryDetail || '' } }] },
            MedicalHistory: { multi_select: toMultiSelect(body.medicalHistory) },
            MedicalHistoryEtc: { rich_text: [{ text: { content: body.medicalHistoryEtc || '' } }] },
            PainAreas: { multi_select: toMultiSelect(body.painAreas) },
            PainAreasEtc: { rich_text: [{ text: { content: body.painAreasEtc || '' } }] },
            VisitSource: body.visitSource ? { select: { name: body.visitSource } } : undefined,
            AvailableTime: body.availableTime ? { select: { name: body.availableTime } } : undefined,
            AvailableDays: { multi_select: toMultiSelect(body.availableDays) },
            MarketingConsent: { checkbox: body.marketingConsent || false },
            AdConsent: { checkbox: body.adConsent || false },
            Token: body.token ? { rich_text: [{ text: { content: body.token } }] } : undefined,
            CreatedAt: { date: { start: new Date().toISOString().split('T')[0] } },
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        return new Response(JSON.stringify({ error: data.message || 'Notion API error', data }), { status: 500, headers });
      }
      return new Response(JSON.stringify({ id: data.id, success: true }), { headers });
    }

    // PUT — 회원 정보 수정
    if (method === 'PUT') {
      const url = new URL(request.url);
      const id = url.searchParams.get('id');
      if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers });

      const body = await request.json();
      const toMultiSelect = (str) => str
        ? str.split(',').map(s => s.trim()).filter(Boolean).map(name => ({ name }))
        : [];

      const res = await fetch(`https://api.notion.com/v1/pages/${id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${env.NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          properties: {
            Name: body.name ? { title: [{ text: { content: body.name } }] } : undefined,
            Email: body.email ? { email: body.email } : undefined,
            Phone: body.phone ? { phone_number: body.phone } : undefined,
            BirthDate: body.birthDate ? { date: { start: body.birthDate } } : undefined,
            Address: { rich_text: [{ text: { content: body.address || '' } }] },
            Height: body.height ? { number: body.height } : undefined,
            Weight: body.weight ? { number: body.weight } : undefined,
            JobType: body.jobType ? { select: { name: body.jobType } } : undefined,
            PilatesExpType: body.pilatesExpType ? { select: { name: body.pilatesExpType } } : undefined,
            PilatesExpCount: body.pilatesExpCount ? { number: body.pilatesExpCount } : undefined,
            ExerciseExp: { rich_text: [{ text: { content: body.exerciseExp || '' } }] },
            PilatesCert: { checkbox: body.pilatesCert || false },
            PilatesCertOrg: { rich_text: [{ text: { content: body.pilatesCertOrg || '' } }] },
            PilatesCertYears: body.pilatesCertYears ? { number: body.pilatesCertYears } : undefined,
            StopReasons: body.stopReasons ? { select: { name: body.stopReasons } } : undefined,
            ExerciseGoals: { multi_select: toMultiSelect(body.exerciseGoals) },
            Surgery: { checkbox: body.surgery || false },
            SurgeryDetail: { rich_text: [{ text: { content: body.surgeryDetail || '' } }] },
            MedicalHistory: { multi_select: toMultiSelect(body.medicalHistory) },
            PainAreas: { multi_select: toMultiSelect(body.painAreas) },
            VisitSource: body.visitSource ? { select: { name: body.visitSource } } : undefined,
            AvailableTime: body.availableTime ? { select: { name: body.availableTime } } : undefined,
            AvailableDays: { multi_select: toMultiSelect(body.availableDays) },
            MarketingConsent: { checkbox: body.marketingConsent || false },
            AdConsent: { checkbox: body.adConsent || false },
            Token: body.token ? { rich_text: [{ text: { content: body.token } }] } : undefined,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) return new Response(JSON.stringify({ error: data.message }), { status: 500, headers });
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}

// PUT handler added below existing onRequest
