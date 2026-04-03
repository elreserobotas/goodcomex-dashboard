const ODOO_URL = 'https://goodcomex-el-resero.odoo.com';
const ODOO_USER = 'kevinlubi@gmail.com';

function authHeader() {
  return 'Basic ' + Buffer.from(`${ODOO_USER}:${process.env.ODOO_API_KEY}`).toString('base64');
}

async function odooRPC(model, method, domain, fields) {
  const res = await fetch(`${ODOO_URL}/web/dataset/call_kw/${model}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader()
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      id: 1,
      params: {
        model,
        method,
        args: [domain],
        kwargs: {
          fields,
          limit: 2000,
          context: {}
        }
      }
    })
  });
  const data = await res.json();
  console.log(`${model} result count:`, data.result?.length, 'error:', data.error?.message);
  return data.result || [];
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
        const facturas = await odooRPC(
          'account.move', 'search_read',
          [
            ['move_type', '=', 'out_invoice'],
            ['state', '=', 'posted'],
            ['invoice_date', '>=', m.desde],
            ['invoice_date', '<=', m.hasta]
          ],
          ['amount_total', 'company_id']
        );
        const resero = facturas.filter(f => f.company_id[0] === 1);
        const empresaB = facturas.filter(f => f.company_id[0] === 2);
        return {
          mes: m.nombre,
          resero: { total: resero.reduce((a, o) => a + o.amount_total, 0), cantidad: resero.length },
          empresaB: { total: empresaB.reduce((a, o) => a + o.amount_total, 0), cantidad: empresaB.length }
        };
      })
    );

    const ordenes = await odooRPC(
      'sale.order', 'search_read',
      [['state', 'in', ['sale', 'done']]],
      ['name', 'partner_id', 'amount_total', 'date_order', 'company_id']
    );

    const ordenesRecientes = ordenes
      .sort((a, b) => new Date(b.date_order) - new Date(a.date_order))
      .slice(0, 8)
      .map(o => ({
        ...o,
        empresa: o.company_id[0] === 1 ? 'El Resero' : 'Empresa B'
      }));

    res.json({ ventasPorMes, ordenesRecientes });

  } catch (err) {
    console.error('ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
};
