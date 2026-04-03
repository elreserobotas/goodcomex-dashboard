const ODOO_URL = 'https://goodcomex-el-resero.odoo.com';
const ODOO_DB = 'goodcomex-el-resero';
const ODOO_USER = 'kevinlubi@gmail.com';

async function getUid() {
  const res = await fetch(`${ODOO_URL}/xmlrpc/2/common`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: `<?xml version="1.0"?>
<methodCall>
  <methodName>authenticate</methodName>
  <params>
    <param><value><string>${ODOO_DB}</string></value></param>
    <param><value><string>${ODOO_USER}</string></value></param>
    <param><value><string>${process.env.ODOO_API_KEY}</string></value></param>
    <param><value><struct></struct></value></param>
  </params>
</methodCall>`
  });
  const text = await res.text();
  console.log('XMLRPC auth response:', text.slice(0, 300));
  const match = text.match(/<int>(\d+)<\/int>/);
  if (!match) throw new Error('Auth fallida: ' + text.slice(0, 200));
  return parseInt(match[1]);
}

async function odooSearch(uid, model, domain, fields) {
  const domainXml = domain.map(([f, op, v]) => {
    const val = typeof v === 'number'
      ? `<value><int>${v}</int></value>`
      : `<value><string>${v}</string></value>`;
    return `<value><array><data>
      <value><string>${f}</string></value>
      <value><string>${op}</string></value>
      ${val}
    </data></array></value>`;
  }).join('');

  const fieldsXml = fields.map(f => `<value><string>${f}</string></value>`).join('');

  const res = await fetch(`${ODOO_URL}/xmlrpc/2/object`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: `<?xml version="1.0"?>
<methodCall>
  <methodName>execute_kw</methodName>
  <params>
    <param><value><string>${ODOO_DB}</string></value></param>
    <param><value><int>${uid}</int></value></param>
    <param><value><string>${process.env.ODOO_API_KEY}</string></value></param>
    <param><value><string>${model}</string></value></param>
    <param><value><string>search_read</string></value></param>
    <param><value><array><data>
      <value><array><data>${domainXml}</data></array></value>
    </data></array></value></param>
    <param><value><struct>
      <member><name>fields</name><value><array><data>${fieldsXml}</data></array></value></member>
      <member><name>limit</name><value><int>1000</int></value></member>
    </struct></value></param>
  </params>
</methodCall>`
  });
  const text = await res.text();
  console.log('XMLRPC object response:', text.slice(0, 500));
  const amounts = [...text.matchAll(/<member><name>amount_total<\/name><value><double>([\d.]+)<\/double><\/value><\/member>/g)];
  return amounts.map(m => ({ amount_total: parseFloat(m[1]) }));
}

async function getOrdenes(uid, companyId) {
  const res = await fetch(`${ODOO_URL}/xmlrpc/2/object`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: `<?xml version="1.0"?>
<methodCall>
  <methodName>execute_kw</methodName>
  <params>
    <param><value><string>${ODOO_DB}</string></value></param>
    <param><value><int>${uid}</int></value></param>
    <param><value><string>${process.env.ODOO_API_KEY}</string></value></param>
    <param><value><string>sale.order</string></value></param>
    <param><value><string>search_read</string></value></param>
    <param><value><array><data>
      <value><array><data>
        <value><array><data>
          <value><string>company_id</string></value>
          <value><string>=</string></value>
          <value><int>${companyId}</int></value>
        </data></array></value>
        <value><array><data>
          <value><string>state</string></value>
          <value><string>in</string></value>
          <value><array><data>
            <value><string>sale</string></value>
            <value><string>done</string></value>
          </data></array></value>
        </data></array></value>
      </data></array></value>
    </data></array></value></param>
    <param><value><struct>
      <member><name>fields</name><value><array><data>
        <value><string>name</string></value>
        <value><string>partner_id</string></value>
        <value><string>amount_total</string></value>
        <value><string>date_order</string></value>
      </data></array></value></member>
      <member><name>limit</name><value><int>5</int></value></member>
      <member><name>order</name><value><string>date_order desc</string></value></member>
    </struct></value></param>
  </params>
</methodCall>`
  });
  const text = await res.text();
  const records = [];
  const nameMatches = [...text.matchAll(/<member><name>name<\/name><value><string>(S\d+)<\/string><\/value><\/member>/g)];
  const amountMatches = [...text.matchAll(/<member><name>amount_total<\/name><value><double>([\d.]+)<\/double><\/value><\/member>/g)];
  const dateMatches = [...text.matchAll(/<member><name>date_order<\/name><value><string>([^<]+)<\/string><\/value><\/member>/g)];
  const partnerMatches = [...text.matchAll(/<member><name>partner_id<\/name><value><array><data><value><int>\d+<\/int><\/value><value><string>([^<]+)<\/string><\/value><\/data><\/array><\/value><\/member>/g)];
  for (let i = 0; i < nameMatches.length; i++) {
    records.push({
      name: nameMatches[i][1],
      amount_total: parseFloat(amountMatches[i]?.[1] || 0),
      date_order: dateMatches[i]?.[1] || '',
      partner_id: [0, partnerMatches[i]?.[1] || '']
    });
  }
  return records;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const uid = await getUid();
    console.log('UID obtenido:', uid);

    const meses = [
      { nombre: 'Enero',   desde: '2026-01-01', hasta: '2026-01-31' },
      { nombre: 'Febrero', desde: '2026-02-01', hasta: '2026-02-28' },
      { nombre: 'Marzo',   desde: '2026-03-01', hasta: '2026-03-31' },
      { nombre: 'Abril',   desde: '2026-04-01', hasta: '2026-04-30' },
    ];

    const ventasPorMes = await Promise.all(
      meses.map(async (m) => {
        const [r, e] = await Promise.all([
          odooSearch(uid, 'account.move', [['company_id','=',1],['move_type','=','out_invoice'],['state','=','posted'],['invoice_date','>=',m.desde],['invoice_date','<=',m.hasta]], ['amount_total']),
          odooSearch(uid, 'account.move', [['company_id','=',2],['move_type','=','out_invoice'],['state','=','posted'],['invoice_date','>=',m.desde],['invoice_date','<=',m.hasta]], ['amount_total'])
        ]);
        return {
          mes: m.nombre,
          resero: { total: r.reduce((a, o) => a + o.amount_total, 0), cantidad: r.length },
          empresaB: { total: e.reduce((a, o) => a + o.amount_total, 0), cantidad: e.length }
        };
      })
    );

    const [ordenesResero, ordenesEmpresaB] = await Promise.all([
      getOrdenes(uid, 1),
      getOrdenes(uid, 2)
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
