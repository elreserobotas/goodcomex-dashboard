const ODOO_URL = 'https://goodcomex-el-resero.odoo.com';
const ODOO_DB = 'goodcomex-el-resero';
const ODOO_USER = 'kevinlubi@gmail.com';
const ODOO_KEY = process.env.ODOO_API_KEY;

async function odooCall(session, model, method, args, kwargs = {}) {
  const res = await fetch(`${ODOO_URL}/web/dataset/call_kw`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `session_id=${session}`
    },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call',
      params: { model, method, args, kwargs }
    })
  });
  const data = await res.json();
  return data.result;
}

async function getSession() {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call',
      params: { db: ODOO_DB, login: ODOO_USER, password: ODOO_KEY }
    })
  });
  const cookies = res.headers.get('set-cookie');
  const match = cookies?.match(/session_id=([^;]+)/);
  return match ? match[1] : null;
}

async function getVentas(session, companyId, desde, hasta) {
  const result = await odooCall(session, 'account.move', 'search_read',
    [[
      ['company_id', '=', companyId],
      ['move_type', '=', 'out_invoice'],
      ['state', '=', 'posted'],
      ['invoice_date', '>=', desde],
      ['invoice_date', '<=', hasta]
    ]],
    { fields: ['amount_total', 'invoice_date', 'partner_id', 'name'], limit: 1000 }
  );
  return result || [];
}

async function getOrdenesRecientes(session, companyId) {
  const result = await odooCall(session, 'sale.order', 'search_read',
    [[['company_id', '=', companyId], ['state', 'in', ['sale', 'done']]]],
    { fields: ['name', 'partner_id', 'amount_total', 'date_order'], limit: 5, order: 'date_order desc' }
  );
  return result || [];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const session = await getSession();
    if (!session) return res.status(401).json({ error: 'Auth failed' });

    const meses = [
      { nombre: 'Enero',   desde: '2026-01-01', hasta: '2026-01-31' },
      { nombre: 'Febrero', desde: '2026-02-01', hasta: '2026-02-28' },
      { nombre: 'Marzo',   desde: '2026-03-01', hasta: '2026-03-31' },
      { nombre: 'Abril',   desde: '2026-04-01', hasta: '2026-04-30' },
    ];

    const ventasPorMes = await Promise.all(
      meses.map(async (m) => {
        const [r, e] = await Promise.all([
          getVentas(session, 1, m.desde, m.hasta),
          getVentas(session, 2, m.desde, m.hasta)
        ]);
        return {
          mes: m.nombre,
          resero: { total: r.reduce((a, o) => a + o.amount_total, 0), cantidad: r.length },
          empresaB: { total: e.reduce((a, o) => a + o.amount_total, 0), cantidad: e.length }
        };
      })
    );

    const [ordenesResero, ordenesEmpresaB] = await Promise.all([
      getOrdenesRecientes(session, 1),
      getOrdenesRecientes(session, 2)
    ]);

    res.json({
      ventasPorMes,
      ordenesRecientes: [
        ...ordenesResero.map(o => ({ ...o, empresa: 'El Resero' })),
        ...ordenesEmpresaB.map(o => ({ ...o, empresa: 'Empresa B' }))
      ].sort((a, b) => new Date(b.date_order) - new Date(a.date_order)).slice(0, 8)
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
