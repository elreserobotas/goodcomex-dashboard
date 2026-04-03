const ODOO_URL = 'https://goodcomex-el-resero.odoo.com';
const ODOO_USER = 'kevinlubi@gmail.com';

function getAuth() {
  return 'Basic ' + Buffer.from(`${ODOO_USER}:${process.env.ODOO_API_KEY}`).toString('base64');
}

async function odooCall(model, method, args, kwargs = {}) {
  const res = await fetch(`${ODOO_URL}/web/dataset/call_kw`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': getAuth()
    },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call',
      params: {
        model, method, args,
        kwargs: {
          ...kwargs,
          context: {
            allowed_company_ids: [1, 2],
            lang: 'es_AR',
            tz: 'America/Argentina/Buenos_Aires'
          }
        }
      }
    })
  });
  const data = await res.json();
  return data.result || [];
}

async function getVentas(companyId, desde, hasta) {
  return odooCall('account.move', 'search_read',
    [[['company_id','=',companyId],['move_type','=','out_invoice'],['state','=','posted'],['invoice_date','>=',desde],['invoice_date','<=',hasta]]],
    { fields: ['amount_total'], limit: 1000 }
  );
}

async function getOrdenes(companyId) {
  return odooCall('sale.order', 'search_read',
    [[['company_id','=',companyId],['state','in',['sale','done']]]],
    { fields: ['name','partner_id','amount_total','date_order'], limit: 5, order: 'date_order desc' }
  );
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const meses = [
      { nombre: 'Enero',   desde: '2026-01-01', hasta: '2026-01-31' },
      { nombre: 'Febrero', desde: '2026-02-01', hasta: '2026-02-28' },
      { nombre: 'Marzo',   desde: '2026-03-01', hasta: '2026-03-31' },
      { nombre: 'Abril',   desde: '2026-04-01', hasta: '2026-04-30' },
    ];

    const ventasPorMes = await Promise.all(
      meses.map(async (m) => {
        const [r, e] = await Promise.all([
          getVentas(1, m.desde, m.hasta),
          getVentas(2, m.desde, m.hasta)
        ]);
        return {
          mes: m.nombre,
          resero: { total: r.reduce((a, o) => a + o.amount_total, 0), cantidad: r.length },
          empresaB: { total: e.reduce((a, o) => a + o.amount_total, 0), cantidad: e.length }
        };
      })
    );

    const [ordenesResero, ordenesEmpresaB] = await Promise.all([
      getOrdenes(1),
      getOrdenes(2)
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
