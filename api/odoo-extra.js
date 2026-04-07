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
  if (!match) throw new Error('Auth fallida');
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
    if (amountMatch) {
      results.push({
        amount_total: parseFloat(amountMatch[1]),
        company_id: companyMatch ? [parseInt(companyMatch[1])] : [0]
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
    const partnerMatch = struct[1].match(/<name>partner_id<\/name>[\s\S]*?<value><string>([^<]+)<\/string>/);
    if (prodMatch && qtyMatch) {
      results.push({
        producto: prodMatch[1],
        cantidad: Math.abs(parseFloat(qtyMatch[1])),
        total: Math.abs(parseFloat(totalMatch?.[1] || 0)),
        cliente: partnerMatch?.[1] || ''
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
  const nombreBase = nombre.replace(/\[.*?\]\s*/, '').replace(/\s*\(.*?\)\s*/g, '').trim();
  return colorCod ? `${modelo} ${colores[colorCod]} — ${nombreBase}` : `${modelo} — ${nombreBase}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const { desde, hasta, tipo } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'Faltan parámetros' });

    const uid = await getUid();

    if (tipo === 'clientes') {
      const xml = await odooCall(uid, 'account.move',
        [['move_type','=','out_invoice'],['state','=','posted'],['invoice_date','>=',desde],['invoice_date','<=',hasta]],
        ['amount_total','partner_id','company_id']
      );
      const facturas = parseAmounts(xml);
      const memberRegex = /<struct>([\s\S]*?)<\/struct>/g;
      let struct;
      const clienteMap = {};
      const xmlFull = await odooCall(uid, 'account.move',
        [['move_type','=','out_invoice'],['state','=','posted'],['invoice_date','>=',desde],['invoice_date','<=',hasta]],
        ['amount_total','partner_id']
      );
      const mr = /<struct>([\s\S]*?)<\/struct>/g;
      let s;
      while ((s = mr.exec(xmlFull)) !== null) {
        const amountMatch = s[1].match(/<name>amount_total<\/name>\s*<value><double>(-?[\d.]+)<\/double>/);
        const partnerMatch = s[1].match(/<name>partner_id<\/name>[\s\S]*?<value><string>([^<]+)<\/string>/);
        if (amountMatch && partnerMatch) {
          const nombre = partnerMatch[1];
          if (!clienteMap[nombre]) clienteMap[nombre] = { nombre, total: 0, cantidad: 0 };
          clienteMap[nombre].total += parseFloat(amountMatch[1]);
          clienteMap[nombre].cantidad++;
        }
      }
      const clientesTop = Object.values(clienteMap).sort((a,b) => b.total - a.total).slice(0, 10);
      return res.json({ clientesTop });
    }

    if (tipo === 'productos') {
      const xmlLineas = await odooCall(uid, 'account.move.line',
        [['move_id.move_type','=','out_invoice'],['move_id.state','=','posted'],
         ['product_id','!=',false],['tax_line_id','=',false],
         ['move_id.invoice_date','>=',desde],['move_id.invoice_date','<=',hasta]],
        ['product_id','quantity','price_subtotal']
      );
      const lineas = parseLineasFactura(xmlLineas);
      const productoMap = {};
      lineas.forEach(l => {
        const key = parsearModeloColor(l.producto);
        if (!productoMap[key]) productoMap[key] = { nombre: key, cantidad: 0, total: 0 };
        productoMap[key].cantidad += l.cantidad;
        productoMap[key].total += l.total;
        const EXCLUIR = ['ajuste', 'redondeo', 'descuento'];
        const productosBase = Object.values(productoMap)
        .filter(p => p.cantidad > 0)
        .filter(p => !EXCLUIR.some(ex => p.nombre.toLowerCase().includes(ex)))
        .map(p => ({ ...p, promedio: p.cantidad > 0 ? Math.round(p.total / p.cantidad) : 0 }));
      });
      const EXCLUIR = ['ajuste', 'redondeo', 'descuento'];
      const productosBase = Object.values(productoMap)
      .filter(p => p.cantidad > 0)
      .filter(p => !EXCLUIR.some(ex => p.nombre.toLowerCase().includes(ex)))
      .map(p => ({
        ...p, promedio: p.cantidad > 0 ? Math.round(p.total / p.cantidad) : 0
      }));
      return res.json({
        productosPorCantidad: [...productosBase].sort((a,b) => b.cantidad - a.cantidad).slice(0, 10),
        productosPorMonto: [...productosBase].sort((a,b) => b.total - a.total).slice(0, 10)
      });
    }

    if (tipo === 'comparativa') {
      const periodoAnteriorHasta = new Date(new Date(desde) - 86400000).toISOString().slice(0,10);
      const diff = new Date(hasta) - new Date(desde);
      const periodoAnteriorDesde = new Date(new Date(desde) - diff - 86400000).toISOString().slice(0,10);
      const anioAnteriorDesde = desde.replace(/^\d{4}/, y => String(parseInt(y)-1));
      const anioAnteriorHasta = hasta.replace(/^\d{4}/, y => String(parseInt(y)-1));

      const getResumen = async (d, h) => {
        const xml = await odooCall(uid, 'account.move',
          [['move_type','=','out_invoice'],['state','=','posted'],['invoice_date','>=',d],['invoice_date','<=',h]],
          ['amount_total','company_id']
        );
        const facts = parseAmounts(xml);
        return {
          total: facts.reduce((a,f) => a+f.amount_total, 0),
          cantidad: facts.length,
          resero: facts.filter(f => f.company_id[0]===1).reduce((a,f) => a+f.amount_total, 0),
          empresaB: facts.filter(f => f.company_id[0]===2).reduce((a,f) => a+f.amount_total, 0),
          desde: d, hasta: h
        };
      };

      const [periodoAnterior, anioAnterior] = await Promise.all([
        getResumen(periodoAnteriorDesde, periodoAnteriorHasta),
        getResumen(anioAnteriorDesde, anioAnteriorHasta)
      ]);
      return res.json({ comparativa: { periodoAnterior, anioAnterior } });
    }
    
if (tipo === 'iva') {
  const hoy = new Date();
  const mesActualDesde = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-01`;
  const mesActualHasta = new Date().toISOString().slice(0,10);

  // Calcular meses entre desde y hasta
  const meses = [];
  let cur = new Date(desde + '-01');
  const fin = new Date(hasta.slice(0,7) + '-01');
  while (cur <= fin) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth()+1).padStart(2,'0');
    const ultimoDia = new Date(y, cur.getMonth()+1, 0).getDate();
    meses.push({
      label: cur.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }),
      desde: `${y}-${m}-01`,
      hasta: `${y}-${m}-${ultimoDia}`
    });
    cur.setMonth(cur.getMonth()+1);
  }

  // Agregar mes actual si no está ya incluido
  const mesActualKey = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}`;
  const yaIncluido = meses.some(m => m.desde.startsWith(mesActualKey));
  if (!yaIncluido) {
    meses.push({
      label: hoy.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }) + ' (en curso)',
      desde: mesActualDesde,
      hasta: mesActualHasta
    });
  }

  async function calcularIVA(d, h) {
    const xmlV = await odooCall(uid, 'account.move.line',
      [['move_id.move_type','=','out_invoice'],['move_id.state','=','posted'],
       ['tax_line_id','!=',false],['move_id.invoice_date','>=',d],['move_id.invoice_date','<=',h]],
      ['balance','tax_line_id']
    );
    const xmlC = await odooCall(uid, 'account.move.line',
      [['move_id.move_type','=','in_invoice'],['move_id.state','=','posted'],
       ['tax_line_id','!=',false],['move_id.invoice_date','>=',d],['move_id.invoice_date','<=',h]],
      ['balance','tax_line_id']
    );
    function parseL(xml) {
      const results = [];
      const re = /<struct>([\s\S]*?)<\/struct>/g;
      let s;
      while ((s = re.exec(xml)) !== null) {
        const b = s[1].match(/<name>balance<\/name>\s*<value><double>(-?[\d.]+)<\/double>/);
        const t = s[1].match(/<name>tax_line_id<\/name>[\s\S]*?<value><string>([^<]+)<\/string>/);
        if (b && t) results.push({ balance: parseFloat(b[1]), tax: t[1] });
      }
      return results;
    }
    const lV = parseL(xmlV);
    const lC = parseL(xmlC);
    const ivaVNombres = ['VAT 21%','VAT 10.5%','VAT 27%','Exento (paga IVA 21%)'];
    const ivaCNombres = ['VAT 21%','VAT 10.5%','VAT 27%','Perc VAT'];
    const iibbNombres = ['P. IIBB CABA','P. IIBB BA','P. IIBB N','P. IIBB LP','P. Especial de IVA'];
    return {
      ivaVentas: Math.round(lV.filter(l => ivaVNombres.includes(l.tax)).reduce((a,l) => a+Math.abs(l.balance),0)),
      ivaCompras: Math.round(lC.filter(l => ivaCNombres.includes(l.tax)).reduce((a,l) => a+Math.abs(l.balance),0)),
      iibb: Math.round(lC.filter(l => iibbNombres.includes(l.tax)).reduce((a,l) => a+Math.abs(l.balance),0)),
    };
  }

  const resultados = [];
  for (const mes of meses) {
    const r = await calcularIVA(mes.desde, mes.hasta);
    resultados.push({ label: mes.label, ...r, ivaNeto: r.ivaVentas - r.ivaCompras });
  }

  return res.json({ meses: resultados });
}

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

  return res.json({
    ivaVentas: Math.round(ivaVentas),
    ivaCompras: Math.round(ivaCompras),
    iibb: Math.round(iibb),
    ivaNeto: Math.round(ivaVentas - ivaCompras)
  });
}
    
    res.status(400).json({ error: 'Tipo no válido' });
  } catch (err) {
    console.error('ERROR odoo-extra:', err.message);
    res.status(500).json({ error: err.message });
  }
};
