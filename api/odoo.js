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
      valXml = `<value><array><data>${v.map(i => typeof i === 'number' ? `<value><int>${i}</int></value>` : `<value><string>${i}</string></value>`).join('')}</data></array></value>`;
    } else if (typeof v === 'number') {
      valXml = `<value><int>${v}</int></value>`;
    } else if (v === false) {
      valXml = `<value><boolean>0</boolean></value>`;
    } else {
      valXml = `<value><string><![CDATA[${v}]]></string></value>`;
    }
    return `<value><array><data><value><string>${f}</string></value><value><string>${safeOp}</string></value>${valXml}</data></array></value>`;
  }).join('');

  const fieldsXml = fields.map(f => `<value><string>${f}</string></value>`).join('');
  const limit = extra.limit || 5000;
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
    const amountMatch = struct[1].match(/<name>amount_total<\/name>\s*<value><double>(-?[\d.]+)<\/double>/);
    const companyMatch = struct[1].match(/<name>company_id<\/name>\s*<value><array><data>\s*<value><int>(\d+)<\/int>/);
    const partnerMatch = struct[1].match(/<name>partner_id<\/name>[\s\S]*?<value><string>([^<]+)<\/string>/);
    const nameMatch = struct[1].match(/<name>name<\/name>\s*<value><string>([^<]+)<\/string>/);
    const dateMatch = struct[1].match(/<name>invoice_date<\/name>\s*<value><string>([^<]+)<\/string>/);
    const dueDateMatch = struct[1].match(/<name>invoice_date_due<\/name>\s*<value><string>([^<]+)<\/string>/);
    const paymentMatch = struct[1].match(/<name>payment_state<\/name>\s*<value><string>([^<]+)<\/string>/);
    const amountResidualMatch = struct[1].match(/<name>amount_residual<\/name>\s*<value><double>(-?[\d.]+)<\/double>/);
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
    if (idMatch && nameMatch) {
      results.push({
        id: parseInt(idMatch[1]),
        name: nameMatch[1],
        partner: partnerMatch?.[1] || '—',
        state: stateMatch?.[1] || '',
        scheduled_date: dateMatch?.[1] || '',
        company_id: companyMatch ? parseInt(companyMatch[1]) : 0
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
        product: productMatch[1],
        qty: parseFloat(qtyMatch?.[1] || 0),
        done: parseFloat(doneMatch?.[1] || 0)
      });
    }
  }
  return results;
}

function parseLineasFactura(xml) {
  const results = [];
  const memberRegex = /<struct>([\s\S]*?)<\/struct>/g;
  let struct;
  while ((struct = memberRegex.exec(xml)) !== null) {
    const prodMatch = struct[1].match(/<name>product_id<\/name>[\s\S]*?<value><string>([^<]+)<\/string>/);
    const qtyMatch = struct[1].match(/<name>quantity<\/name>\s*<value><double>(-?[\d.]+)<\/double>/);
    const totalMatch = struct[1].match(/<name>price_subtotal<\/name>\s*<value><double>(-?[\d.]+)<\/double>/);
    if (prodMatch && qtyMatch) {
      results.push({
        producto: prodMatch[1],
        cantidad: Math.abs(parseFloat(qtyMatch[1])),
        total: Math.abs(parseFloat(totalMatch?.[1] || 0))
      });
    }
  }
  return results;
}

function parsearModeloColor(nombre) {
  const match = nombre.match(/\[(\d+)\.?\d*([MNAV])?\]/);
  if (!match) return nombre;
  const modelo = match[1];
  const colorCod = match[2] || null;
  const colores = { M: 'Marrón', N: 'Negro', A: 'Arena', V: 'Verde' };
  const nombreBase = nombre.replace(/\[.*?\]\s*/, '').replace(/\(.*?\)/g, '').trim();
  return colorCod ? `${modelo} ${colores[colorCod] || colorCod} — ${nombreBase}` : `${modelo} — ${nombreBase}`;
}

function generarMeses(desde, hasta) {
  const meses = [];
  const pad = n => String(n).padStart(2, '0');
  let year = parseInt(desde.slice(0, 4));
  let month = parseInt(desde.slice(5, 7)) - 1;
  const hastaYear = parseInt(hasta.slice(0, 4));
  const hastaMonth = parseInt(hasta.slice(5, 7)) - 1;
  while (year < hastaYear || (year === hastaYear && month <= hastaMonth)) {
    const ultimoDia = new Date(year, month + 1, 0).getDate();
    const d = new Date(year, month, 1);
    const nombre = d.toLocaleString('es-AR', { month: 'short' }).replace('.', '') + ' ' + String(year).slice(2);
    meses.push({ nombre, desde: `${year}-${pad(month + 1)}-01`, hasta: `${year}-${pad(month + 1)}-${ultimoDia}` });
    month++;
    if (month > 11) { month = 0; year++; }
  }
  return meses;
}

async function getFacturasPeriodo(uid, desde, hasta) {
  const xml = await odooCall(uid, 'account.move',
    [['move_type','=','out_invoice'],['state','=','posted'],['invoice_date','>=',desde],['invoice_date','<=',hasta]],
    ['amount_total','company_id','partner_id','name','invoice_date','invoice_date_due','payment_state','amount_residual']
  );
  return parseAmounts(xml);
}

async function getIVA(uid, desde, hasta) {
  const xmlVentas = await odooCall(uid, 'account.move.line',
    [['move_id.move_type','=','out_invoice'],['move_id.state','=','posted'],
     ['tax_line_id','!=',false],['move_id.invoice_date','>=',desde],['move_id.invoice_date','<=',hasta]],
    ['balance','tax_line_id']
  );
  const xmlCompras = await odooCall(uid, 'account.move.line',
    [['move_id.move_type','=','in_invoice'],['move_id.state','=','posted'],
     ['tax_line_id','!=',false],['move_id.invoice_date','>=',desde],['move_id.invoice_date','<=',hasta]],
    ['balance','tax_line_id']
  );

  function parseLineas(xml) {
    const results = [];
    const memberRegex = /<struct>([\s\S]*?)<\/struct>/g;
    let struct;
    while ((struct = memberRegex.exec(xml)) !== null) {
      const balMatch = struct[1].match(/<name>balance<\/name>\s*<value><double>(-?[\d.]+)<\/double>/);
      const taxMatch = struct[1].match(/<name>tax_line_id<\/name>[\s\S]*?<value><string>([^<]+)<\/string>/);
      if (balMatch && taxMatch) results.push({ balance: parseFloat(balMatch[1]), tax: taxMatch[1] });
    }
    return results;
  }

  const lineasVentas = parseLineas(xmlVentas);
  const lineasCompras = parseLineas(xmlCompras);
  const ivaVentasNombres = ['VAT 21%', 'VAT 10.5%', 'VAT 27%', 'Exento (paga IVA 21%)'];
  const ivaComprasNombres = ['VAT 21%', 'VAT 10.5%', 'VAT 27%', 'Perc VAT'];
  const iibbNombres = ['P. IIBB CABA', 'P. IIBB BA', 'P. IIBB N', 'P. IIBB LP', 'P. Especial de IVA'];

  const ivaVentas = lineasVentas.filter(l => ivaVentasNombres.includes(l.tax)).reduce((a,l) => a + Math.abs(l.balance), 0);
  const ivaCompras = lineasCompras.filter(l => ivaComprasNombres.includes(l.tax)).reduce((a,l) => a + Math.abs(l.balance), 0);
  const iibb = lineasCompras.filter(l => iibbNombres.includes(l.tax)).reduce((a,l) => a + Math.abs(l.balance), 0);

  return { ivaVentas: Math.round(ivaVentas), ivaCompras: Math.round(ivaCompras), iibb: Math.round(iibb), ivaNeto: Math.round(ivaVentas - ivaCompras) };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const hoy = new Date();
    const defaultDesde = '2025-11-01';
    const defaultHasta = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

    const desde = req.query.desde || defaultDesde;
    const hastaRaw = req.query.hasta || defaultHasta;
    const hasta = hastaRaw;

    const uid = await getUid();
    const meses = generarMeses(desde.slice(0,7) + '-01', hasta.slice(0,7) + '-01');

    const ventasPorMes = await Promise.all(
      meses.map(async m => {
        const facturas = await getFacturasPeriodo(uid, m.desde, m.hasta);
        const resero = facturas.filter(f => f.company_id[0] === 1);
        const empresaB = facturas.filter(f => f.company_id[0] === 2);
        return {
          mes: m.nombre,
          resero: { total: resero.reduce((a,o) => a + o.amount_total, 0), cantidad: resero.length },
          empresaB: { total: empresaB.reduce((a,o) => a + o.amount_total, 0), cantidad: empresaB.length },
          facturas
        };
      })
    );

    const todasFacturas = ventasPorMes.flatMap(m => m.facturas);

    const hoyStr = hoy.toISOString().slice(0, 10);
    const xmlTodoPendiente = await odooCall(uid, 'account.move',
      [['move_type','=','out_invoice'],['state','=','posted'],['payment_state','in',['not_paid','partial']]],
      ['amount_total','company_id','partner_id','name','invoice_date','invoice_date_due','payment_state','amount_residual']
    );
    const todasPendientes = parseAmounts(xmlTodoPendiente);
    const diasDiferencia = fecha => fecha ? Math.floor((new Date(hoyStr) - new Date(fecha)) / (1000 * 60 * 60 * 24)) : 0;
    const pendientesConDias = todasPendientes.filter(f => f.amount_residual > 0).map(f => ({ ...f, dias: diasDiferencia(f.invoice_date_due) }));
    const tramos = {
      noVencidas: pendientesConDias.filter(f => f.dias < 0),
      d0_30: pendientesConDias.filter(f => f.dias >= 0 && f.dias <= 30),
      d30_60: pendientesConDias.filter(f => f.dias > 30 && f.dias <= 60),
      d60_90: pendientesConDias.filter(f => f.dias > 60 && f.dias <= 90),
      d90: pendientesConDias.filter(f => f.dias > 90)
    };
    const totalPendiente = pendientesConDias.reduce((a,f) => a + f.amount_residual, 0);
    const totalVencido = pendientesConDias.filter(f => f.dias >= 0).reduce((a,f) => a + f.amount_residual, 0);
    const todasVencidas = pendientesConDias.filter(f => f.dias >= 0);

    const ivaTotal = await getIVA(uid, desde, hasta);
    const ivaMeses = [{ mes: 'Total período', ...ivaTotal }];

    const [xmlPickings1, xmlPickings2] = await Promise.all([
      odooCall(uid, 'stock.picking',
        [['company_id','=',1],['state','in',['confirmed','assigned','waiting']],['picking_type_code','=','outgoing']],
        ['name','partner_id','state','scheduled_date','company_id']
      ),
      odooCall(uid, 'stock.picking',
        [['company_id','=',2],['state','in',['confirmed','assigned','waiting']],['picking_type_code','=','outgoing']],
        ['name','partner_id','state','scheduled_date','company_id']
      )
    ]);
    const pickings1 = parsePickings(xmlPickings1);
    const pickings2 = parsePickings(xmlPickings2);
    const todosPickings = [...pickings1, ...pickings2];
    let moves = [];
    if (todosPickings.length > 0) {
      const movesXml = await odooCall(uid, 'stock.move',
        [['picking_id','in',todosPickings.map(p => p.id)],['state','not in',['done','cancel']]],
        ['picking_id','product_id','product_uom_qty','quantity']
      );
      moves = parseMoves(movesXml);
    }
    const pendientesEntrega = todosPickings.map(p => ({
      ...p,
      empresa: p.company_id === 1 ? 'El Resero' : 'Empresa B',
      productos: moves.filter(m => m.picking_id === p.id)
    }));

  const [xmlResero, xmlEmpresaB] = await Promise.all([
      odooCall(uid, 'sale.order', [['company_id','=',1],['state','in',['sale','done']]], ['name','partner_id','amount_total','date_order'], { limit: 10, order: 'date_order desc' }),
      odooCall(uid, 'sale.order', [['company_id','=',2],['state','in',['sale','done']]], ['name','partner_id','amount_total','date_order'], { limit: 10, order: 'date_order desc' })
    ]);
    const ordenesRecientes = [
      ...parseOrders(xmlResero, 'El Resero'),
      ...parseOrders(xmlEmpresaB, 'Empresa B')
    ].sort((a,b) => new Date(b.date_order) - new Date(a.date_order)).slice(0, 10);

    const totalGeneral = todasFacturas.reduce((a,f) => a + f.amount_total, 0);
    const totalResero = todasFacturas.filter(f => f.company_id[0] === 1).reduce((a,f) => a + f.amount_total, 0);
    const totalEmpresaB = todasFacturas.filter(f => f.company_id[0] === 2).reduce((a,f) => a + f.amount_total, 0);

    res.json({
      ventasPorMes: ventasPorMes.map(m => ({ mes: m.mes, resero: m.resero, empresaB: m.empresaB })),
      pendientes: {
        total: totalPendiente,
        cantidad: pendientesConDias.length,
        tramos: {
          noVencidas: { total: tramos.noVencidas.reduce((a,f) => a+f.amount_residual,0), cantidad: tramos.noVencidas.length },
          d0_30: { total: tramos.d0_30.reduce((a,f) => a+f.amount_residual,0), cantidad: tramos.d0_30.length },
          d30_60: { total: tramos.d30_60.reduce((a,f) => a+f.amount_residual,0), cantidad: tramos.d30_60.length },
          d60_90: { total: tramos.d60_90.reduce((a,f) => a+f.amount_residual,0), cantidad: tramos.d60_90.length },
          d90: { total: tramos.d90.reduce((a,f) => a+f.amount_residual,0), cantidad: tramos.d90.length }
        }
      },
      vencidas: { total: totalVencido, cantidad: todasVencidas.length, detalle: todasVencidas },
      pendientesEntrega,
      ordenesRecientes,
      resumen: { totalGeneral, totalResero, totalEmpresaB, totalFacturas: todasFacturas.length }
    });
  } catch (err) {
    console.error('ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
};
