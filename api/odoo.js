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
  const match = text.match(/<int>(\d+)<\/int>/);
  if (!match) throw new Error('Auth fallida: ' + text.slice(0, 300));
  return parseInt(match[1]);
}

async function odooCall(uid, model, domain, fields, extra = {}) {
  const domainXml = domain.map(d => {
    const [f, op, v] = d;
    const safeOp = op.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let valXml;
    if (Array.isArray(v)) {
      valXml = `<value><array><data>${v.map(i => `<value><string>${i}</string></value>`).join('')}</data></array></value>`;
    } else if (typeof v === 'number') {
      valXml = `<value><int>${v}</int></value>`;
    } else {
      valXml = `<value><string><![CDATA[${v}]]></string></value>`;
    }
    return `<value><array><data><value><string>${f}</string></value><value><string>${safeOp}</string></value>${valXml}</data></array></value>`;
  }).join('');

  const fieldsXml = fields.map(f => `<value><string>${f}</string></value>`).join('');
  const limit = extra.limit || 2000;
  const orderXml = extra.order ? `<member><name>order</name><value><string>${extra.order}</string></value></member>` : '';

  const body = `<?xml version="1.0"?><methodCall><methodName>execute_kw</methodName><params>
    <param><value><string>${ODOO_DB}</string></value></param>
    <param><value><int>${uid}</int></value></param>
    <param><value><string>${process.env.ODOO_PASSWORD}</string></value></param>
    <param><value><string>${model}</string></value></param>
    <param><value><string>search_read</string></value></param>
    <param><value><array><data><value><array><data>${domainXml}</data></array></value></data></array></value></param>
    <param><value><struct>
      <member><name>fields</name><value><array><data>${fieldsXml}</data></array></value></member>
      <member><name>limit</name><value><int>${limit}</int></value></member>
      ${orderXml}
    </struct></value></param>
  </params></methodCall>`;

  const res = await fetch(`${ODOO_URL}/xmlrpc/2/object`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body
  });
  return await res.text();
}

function parseAmounts(xml) {
  const results = [];
  const memberRegex = /<struct>([\s\S]*?)<\/struct>/g;
  let struct;
  while ((struct = memberRegex.exec(xml)) !== null) {
    const amountMatch = struct[1].match(/<name>amount_total<\/name>\s*<value><double>([\d.]+)<\/double>/);
    const companyMatch = struct[1].match(/<name>company_id<\/name>\s*<value><array><data>\s*<value><int>(\d+)<\/int>/);
    const partnerMatch = struct[1].match(/<name>partner_id<\/name>[\s\S]*?<value><string>([^<]+)<\/string>/);
    const nameMatch = struct[1].match(/<name>name<\/name>\s*<value><string>([^<]+)<\/string>/);
    const dateMatch = struct[1].match(/<name>invoice_date<\/name>\s*<value><string>([^<]+)<\/string>/);
    const dueDateMatch = struct[1].match(/<name>invoice_date_due<\/name>\s*<value><string>([^<]+)<\/string>/);
    const paymentMatch = struct[1].match(/<name>payment_state<\/name>\s*<value><string>([^<]+)<\/string>/);
    const amountResidualMatch = struct[1].match(/<name>amount_residual<\/name>\s*<value><double>([\d.]+)<\/double>/);
    if (amountMatch) {
      results.push({
        amount_total: parseFloat(amountMatch[1]),
        company_id: companyMatch ? [parseInt(companyMatch[1])] : [0],
        partner_name: partnerMatch?.[1] || '',
        name: nameMatch?.[1] || '',
        invoice_date: dateMatch?.[1] || '',
        invoice_date_due: dueDateMatch?.[1] || '',
        payment_state: paymentMatch?.[1] || '',
        amount_residual: amountResidualMatch ? parseFloat(amountResidualMatch[1]) : 0
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

function generarMeses(desde, hasta) {
  const meses = [];
  const pad = (n) => String(n).padStart(2, '0');
  let year = parseInt(desde.slice(0, 4));
  let month = parseInt(desde.slice(5, 7)) - 1;
  const hastaYear = parseInt(hasta.slice(0, 4));
  const hastaMonth = parseInt(hasta.slice(5, 7)) - 1;
  while (year < hastaYear || (year === hastaYear && month <= hastaMonth)) {
    const ultimoDia = new Date(year, month + 1, 0).getDate();
    const d = new Date(year, month, 1);
    const nombre = d.toLocaleString('es-AR', { month: 'short' }).replace('.', '') + ' ' + String(year).slice(2);
    meses.push({
      nombre,
      desde: `${year}-${pad(month + 1)}-01`,
      hasta: `${year}-${pad(month + 1)}-${ultimoDia}`
    });
    month++;
    if (month > 11) { month = 0; year++; }
  }
  return meses;
}

function parsePickings(xml) {
  const results = [];
  const memberRegex = /<struct>([\s\S]*?)<\/struct>/g;
  let struct;
  while ((struct = memberRegex.exec(xml)) !== null) {
    const idMatch = struct[1].match(/<name>id<\/name>\s*<value><int>(\d+)<\/int>/);
    const nameMatch = struct[1].match(/<name>name<\/name>\s*<value><string>([^<]+)<\/string>/);
    const partnerMatch = struct[1].match(/<name>partner_id<\/name>[\s\S]*?<value><string>([^<]+)<\/string>/);
    const stateMatch = struct[1].match(/<name>state<\/name>\s*<value><string>([^<]+)<\/string>/);
    const dateMatch = struct[1].match(/<name>scheduled_date<\/name>\s*<value><string>([^<]+)<\/string>/);
    const companyMatch = struct[1].match(/<name>company_id<\/name>\s*<value><array><data>\s*<value><int>(\d+)<\/int>/);
    const typeMatch = struct[1].match(/<name>picking_type_code<\/name>\s*<value><string>([^<]+)<\/string>/);
    if (idMatch && nameMatch) {
      results.push({
        id: parseInt(idMatch[1]),
        name: nameMatch[1],
        partner: partnerMatch?.[1] || '—',
        state: stateMatch?.[1] || '',
        scheduled_date: dateMatch?.[1] || '',
        company_id: companyMatch ? parseInt(companyMatch[1]) : 0,
        type: typeMatch?.[1] || ''
      });
    }
  }
  return results;
}

function parseMoves(xml) {
  const results = [];
  const memberRegex = /<struct>([\s\S]*?)<\/struct>/g;
  let struct;
  while ((struct = memberRegex.exec(xml)) !== null) {
    const pickingMatch = struct[1].match(/<name>picking_id<\/name>\s*<value><array><data>\s*<value><int>(\d+)<\/int>/);
    const productMatch = struct[1].match(/<name>product_id<\/name>[\s\S]*?<value><string>([^<]+)<\/string>/);
    const qtyMatch = struct[1].match(/<name>product_uom_qty<\/name>\s*<value><double>([\d.]+)<\/double>/);
    const doneMatch = struct[1].match(/<name>quantity<\/name>\s*<value><double>([\d.]+)<\/double>/);
    if (pickingMatch && productMatch) {
      results.push({
        picking_id: parseInt(pickingMatch[1]),
        product: productMatch?.[1] || '—',
        qty: parseFloat(qtyMatch?.[1] || 0),
        done: parseFloat(doneMatch?.[1] || 0)
      });
    }
  }
  return results;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const hoy = new Date();
    const defaultDesde = '2025-11-01';
    const defaultHasta = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;

    const desde = req.query.desde || defaultDesde;
    const hastaRaw = req.query.hasta || defaultHasta;
    const hastaDate = new Date(hastaRaw.slice(0, 7) + '-01');
    hastaDate.setMonth(hastaDate.getMonth() + 1);
    hastaDate.setDate(0);
    const hasta = hastaDate.toISOString().slice(0, 10);

    const uid = await getUid();
    const meses = generarMeses(desde, hasta);

    const ventasPorMes = await Promise.all(
      meses.map(async (m) => {
        const xml = await odooCall(uid, 'account.move',
          [['move_type','=','out_invoice'],['state','=','posted'],['invoice_date','>=',m.desde],['invoice_date','<=',m.hasta]],
          ['amount_total','company_id','partner_id','name','invoice_date','invoice_date_due','payment_state','amount_residual']
        );
        const facturas = parseAmounts(xml);
        const resero = facturas.filter(f => f.company_id[0] === 1);
        const empresaB = facturas.filter(f => f.company_id[0] === 2);
        return {
          mes: m.nombre,
          resero: { total: resero.reduce((a, o) => a + o.amount_total, 0), cantidad: resero.length },
          empresaB: { total: empresaB.reduce((a, o) => a + o.amount_total, 0), cantidad: empresaB.length },
          facturas
        };
      })
    );

    // Todas las facturas del período
    const todasFacturas = ventasPorMes.flatMap(m => m.facturas);

    // Ranking clientes top
    const clienteMap = {};
    todasFacturas.forEach(f => {
      if (!f.partner_name) return;
      if (!clienteMap[f.partner_name]) clienteMap[f.partner_name] = { nombre: f.partner_name, total: 0, cantidad: 0 };
      clienteMap[f.partner_name].total += f.amount_total;
      clienteMap[f.partner_name].cantidad++;
    });
    const clientesTop = Object.values(clienteMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    // Facturas pendientes y vencidas
    const hoyStr = hoy.toISOString().slice(0, 10);
    const pendientes = todasFacturas.filter(f => f.payment_state !== 'paid' && f.amount_residual > 0);
    const vencidas = pendientes.filter(f => f.invoice_date_due && f.invoice_date_due < hoyStr);
    const totalPendiente = pendientes.reduce((a, f) => a + f.amount_residual, 0);
    const totalVencido = vencidas.reduce((a, f) => a + f.amount_residual, 0);

    // Órdenes recientes
    const [xmlResero, xmlEmpresaB] = await Promise.all([
      odooCall(uid, 'sale.order', [['company_id','=',1],['state','in',['sale','done']]], ['name','partner_id','amount_total','date_order'], { limit: 5, order: 'date_order desc' }),
      odooCall(uid, 'sale.order', [['company_id','=',2],['state','in',['sale','done']]], ['name','partner_id','amount_total','date_order'], { limit: 5, order: 'date_order desc' })
    ]);

    const ordenesRecientes = [
      ...parseOrders(xmlResero, 'El Resero'),
      ...parseOrders(xmlEmpresaB, 'Empresa B')
    ].sort((a, b) => new Date(b.date_order) - new Date(a.date_order)).slice(0, 8);

    // Pedidos pendientes de entrega
    const [xmlPickings1, xmlPickings2] = await Promise.all([
      odooCall(uid, 'stock.picking',
        [['company_id','=',1],['state','in',['confirmed','assigned','waiting']],['picking_type_code','=','outgoing']],
        ['name','partner_id','state','scheduled_date','company_id','picking_type_code']
      ),
      odooCall(uid, 'stock.picking',
        [['company_id','=',2],['state','in',['confirmed','assigned','waiting']],['picking_type_code','=','outgoing']],
        ['name','partner_id','state','scheduled_date','company_id','picking_type_code']
      )
    ]);

    const pickings1 = parsePickings(xmlPickings1);
    const pickings2 = parsePickings(xmlPickings2);
    const todosPickings = [...pickings1, ...pickings2];

    let movesXml = '';
    if (todosPickings.length > 0) {
      const pickingIds = todosPickings.map(p => p.id);
      movesXml = await odooCall(uid, 'stock.move',
        [['picking_id','in', pickingIds],['state','not in',['done','cancel']]],
        ['picking_id','product_id','product_uom_qty','quantity']
      );
    }
    const moves = movesXml ? parseMoves(movesXml) : [];

    const pickingsConProductos = todosPickings.map(p => ({
      ...p,
      productos: moves.filter(m => m.picking_id === p.id)
    }));
    
    res.json({
      ventasPorMes: ventasPorMes.map(m => ({ mes: m.mes, resero: m.resero, empresaB: m.empresaB })),
      clientesTop,
      pendientes: { total: totalPendiente, cantidad: pendientes.length },
      vencidas: { total: totalVencido, cantidad: vencidas.length, detalle: vencidas.slice(0, 5) },
      ordenesRecientes
      pendientesEntrega: pickingsConProductos
    });

  } catch (err) {
    console.error('ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
};
