const ODOO_URL = 'https://goodcomex-el-resero.odoo.com';
const ODOO_DB = process.env.ODOO_DB;
const ODOO_USER = 'kevinlubi@gmail.com';

async function getUid() {
  const res = await fetch(`${ODOO_URL}/xmlrpc/2/common`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: `<?xml version="1.0"?><methodCall><methodName>authenticate</methodName><params><param><value><string>${ODOO_DB}</string></value></param><param><value><string>${ODOO_USER}</string></value></param><param><value><string>${process.env.ODOO_PASSWORD}</string></value></param><param><value><struct></struct></value></param></params></methodCall>`
  });
  const text = await res.text();
  console.log('Auth response:', text.slice(0, 200));
  const match = text.match(/<int>(\d+)<\/int>/);
  if (!match) throw new Error('Auth fallida: ' + text.slice(0, 300));
  return parseInt(match[1]);
}

async function odooCall(uid, model, domain, fields) {
  const domainXml = domain.map(d => {
    if (typeof d === 'string') return `<value><string>${d}</string></value>`;
    const [f, op, v] = d;
    let valXml;
    if (Array.isArray(v)) {
      valXml = `<value><array><data>${v.map(i => `<value><string>${i}</string></value>`).join('')}</data></array></value>`;
    } else if (typeof v === 'number') {
      valXml = `<value><int>${v}</int></value>`;
    } else {
      valXml = `<value><string>${v}</string></value>`;
    }
    return `<value><array><data><value><string>${f}</string></value><value><string>${op}</string></value>${valXml}</data></array></value>`;
  }).join('');

  const fieldsXml = fields.map(f => `<value><string>${f}</string></value>`).join('');

  const body = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>
    <param><value><string>${ODOO_DB}</string></value></param>
    <param><value><int>${uid}</int></value></param>
    <param><value><string>${process.env.ODOO_PASSWORD}</string></value></param>
    <param><value><string>${model}</string></value></param>
    <param><value><string>search_read</string></value></param>
    <param><value><array><data><value><array><data>${domainXml}</data></array></value></data></array></value></param>
    <param><value><struct>
      <member><name>fields</name><value><array><data>${fieldsXml}</data></array></value></member>
      <member><name>limit</name><value><int>2000</int></value></member>
    </struct></value></param>
  </params></methodCall>`;

  const res = await fetch(`${ODOO_URL}/xmlrpc/2/object`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body
  });
  const text = await res.text();
  console.log(`${model} raw:`, text.slice(0, 400));
  return text;
}

function parseAmounts(xml) {
  const results = [];
  const memberRegex = /<struct>([\s\S]*?)<\/struct>/g;
  let struct;
  while ((struct = memberRegex.exec(xml)) !== null) {
    const amountMatch = struct[1].match(/<name>amount_total<\/name>\s*<value><double>([\d.]+)<\/double>/);
    const companyMatch = struct[1].match(/<name>company_id<\/name>\s*<value><array><data>\s*<value><int>(\d+)<\/int>/);
    if (amountMatch) {
      results.push({
        amount_total: parseFloat(amountMatch[1]),
        company_id: companyMatch ? [parseInt(companyMatch[1])] : [0]
      });
    }
  }
  return results;
}

function parseOrders(xml, empresa) {
  const results = [];
  const memberRegex = /<struct>([\s\S]*?)<\/struct>/g;
  let struct;
  while ((struct = memberRegex.exec(xml)) !== null) {
    const nameMatch = struct[1].match(/<name>name<\/name>\s*<value><string>(S\d+)<\/string>/);
    const amountMatch = struct[1].match(/<name>amount_total<\/name>\s*<value><double>([\d.]+)<\/double>/);
    const dateMatch = struct[1].match(/<name>date_order<\/name>\s*<value><string>([^<]+)<\/string>/);
    const partnerMatch = struct[1].match(/<name>partner_id<\/name>[\s\S]*?<value><string>([^<]+)<\/string>/);
    if (nameMatch && amountMatch) {
      results.push({
        name: nameMatch[1],
        amount_total: parseFloat(amountMatch[1]),
        date_order: dateMatch?.[1] || '',
        partner_id: [0, partnerMatch?.[1] || ''],
        empresa
      });
    }
  }
  return results;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const uid = await getUid();
    console.log('UID:', uid);

    const meses = [
      { nombre: 'Enero',   desde: '2026-01-01', hasta: '2026-01-31' },
      { nombre: 'Febrero', desde: '2026-02-01', hasta: '2026-02-28' },
      { nombre: 'Marzo',   desde: '2026-03-01', hasta: '2026-03-31' },
      { nombre: 'Abril',   desde: '2026-04-01', hasta: '2026-04-30' },
    ];

    const ventasPorMes = await Promise.all(
      meses.map(async (m) => {
        const xml = await odooCall(uid, 'account.move',
          [['move_type','=','out_invoice'],['state','=','posted'],['invoice_date','>=',m.desde],['invoice_date','<=',m.hasta]],
          ['amount_total','company_id']
        );
        const facturas = parseAmounts(xml);
        const resero = facturas.filter(f => f.company_id[0] === 1);
        const empresaB = facturas.filter(f => f.company_id[0] === 2);
        return {
          mes: m.nombre,
          resero: { total: resero.reduce((a, o) => a + o.amount_total, 0), cantidad: resero.length },
          empresaB: { total: empresaB.reduce((a, o) => a + o.amount_total, 0), cantidad: empresaB.length }
        };
      })
    );

    const [xmlResero, xmlEmpresaB] = await Promise.all([
      odooCall(uid, 'sale.order', [['company_id','=',1],['state','in',['sale','done']]], ['name','partner_id','amount_total','date_order']),
      odooCall(uid, 'sale.order', [['company_id','=',2],['state','in',['sale','done']]], ['name','partner_id','amount_total','date_order'])
    ]);

    const ordenesRecientes = [
      ...parseOrders(xmlResero, 'El Resero'),
      ...parseOrders(xmlEmpresaB, 'Empresa B')
    ].sort((a, b) => new Date(b.date_order) - new Date(a.date_order)).slice(0, 8);

    res.json({ ventasPorMes, ordenesRecientes });

  } catch (err) {
    console.error('ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
};
