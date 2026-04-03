const ODOO_URL = 'https://goodcomex-el-resero.odoo.com';
const ODOO_DB = 'goodcomex-el-resero';
const ODOO_USER = 'kevinlubi@gmail.com';

async function getSession() {
  const res = await fetch(`${ODOO_URL}/web/session/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call',
      params: { db: ODOO_DB, login: ODOO_USER, password: process.env.ODOO_API_KEY }
    })
  });
  const text = await res.text();
  const data = JSON.parse(text);
  if (!data.result || !data.result.uid) throw new Error('Auth fallida: ' + text.slice(0, 200));
  const cookies = res.headers.get('set-cookie');
  const match = cookies?.match(/session_id=([^;]+)/);
  return match ? match[1] : null;
}

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
  return data.result || [];
}

async function getVentas(session, companyId, desde, hasta) {
  return odooCall(session, 'account.move', 'search_read',
    [[['company_id','=',companyId],['move_type','=','out_invoice'],['state','=','posted'],['invoice_date','>=',desde],['invoice_date','<=',hasta]]],
    { fields: ['amount_total','invoice_date','partner_id','name'], limit: 1000 }
  );
}

async function getOrdenes(session, companyId) {
  return odooCall(session, 'sale.order', 'search_read',
    [[['company_id','=',companyId],['state','in',['sale','done']]]],
    { fields: ['name','partner_id','amount_total','date_order'], limit: 5, order: 'date_order desc' }
  );
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    console.log('API KEY presente:', !!process.env.ODOO_API_KEY);
    const session = await getSession();
    if (!session) throw new Error('No se pudo obtener sesión');

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
      getOrdenes(session, 1),
      getOrdenes(session, 2)
    ]);

    const ordenesRecientes = [
      ...ordenesResero.map(o => ({ ...o, empresa: 'El Resero' })),
      ...ordenesEmpresaB.map(o => ({ ...o, empresa: 'Empresa B' }))
    ].sort((a, b) => new Date(b.date_order) - new Date(a.date_order)).slice(0, 8);

    res.json({ ventasPorMes, ordenesRecientes });

  } catch (err) {
    console.error('ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
};
