const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

const ODOO_URL = 'https://goodcomex-el-resero.odoo.com';
const ODOO_DB = process.env.ODOO_DB;

async function getUid() {
  const res = await fetch(`${ODOO_URL}/xmlrpc/2/common`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: `<?xml version="1.0"?><methodCall><methodName>authenticate</methodName><params><param><value><string>${ODOO_DB}</string></value></param><param><value><string>kevinlubi@gmail.com</string></value></param><param><value><string>${process.env.ODOO_PASSWORD}</string></value></param><param><value><struct></struct></value></param></params></methodCall>`
  });
  const text = await res.text();
  const match = text.match(/<int>(\d+)<\/int>/);
  if (!match) throw new Error('Auth fallida');
  return parseInt(match[1]);
}

async function odooCall(uid, model, domain, fields) {
  const domainXml = domain.map(d => {
    const [f, op, v] = d;
    const safeOp = op.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let valXml;
    if (Array.isArray(v)) {
      valXml = `<value><array><data>${v.map(i => typeof i === 'number' ? `<value><int>${i}</int></value>` : `<value><string>${i}</string></value>`).join('')}</data></array></value>`;
    } else if (typeof v === 'number') {
      valXml = `<value><int>${v}</int></value>`;
    } else {
      valXml = `<value><string><![CDATA[${v}]]></string></value>`;
    }
    return `<value><array><data><value><string>${f}</string></value><value><string>${safeOp}</string></value>${valXml}</data></array></value>`;
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
      <member><name>limit</name><value><int>500</int></value></member>
    </struct></value></param>
  </params></methodCall>`;

  const res = await fetch(`${ODOO_URL}/xmlrpc/2/object`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body
  });
  return await res.text();
}

function parsePickings(xml) {
  const results = [];
  const memberRegex = /<struct>([\s\S]*?)<\/struct>/g;
  let struct;
  while ((struct = memberRegex.exec(xml)) !== null) {
    const idMatch = struct[1].match(/<name>id<\/name>\s*<value><int>(\d+)<\/int>/);
    const nameMatch = struct[1].match(/<name>name<\/name>\s*<value><string>([^<]+)<\/string>/);
    const partnerMatch = struct[1].match(/<name>partner_id<\/name>[\s\S]*?<value><string>([^<]+)<\/string>/);
    const dateMatch = struct[1].match(/<name>scheduled_date<\/name>\s*<value><string>([^<]+)<\/string>/);
    const companyMatch = struct[1].match(/<name>company_id<\/name>\s*<value><array><data>\s*<value><int>(\d+)<\/int>/);
    if (idMatch && nameMatch) {
      results.push({
        id: parseInt(idMatch[1]),
        name: nameMatch[1],
        partner: partnerMatch?.[1] || '—',
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
    if (pickingMatch && productMatch) {
      results.push({
        picking_id: parseInt(pickingMatch[1]),
        product: productMatch[1],
        qty: parseFloat(qtyMatch?.[1] || 0)
      });
    }
  }
  return results;
}

function parsearTallesDeProductos(productos) {
  const talles = [];
  let total = 0;
  productos.forEach(pr => {
    const match = pr.product.match(/\[(\d+)\.(\d+)[MNAV]?\]/);
    if (match) {
      const talle = match[2];
      const cantidad = Math.round(pr.qty);
      if (cantidad > 0) {
        talles.push({ talle, cantidad });
        total += cantidad;
      }
    }
  });
  return { talles, total };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const uid = await getUid();

    const [xmlP1, xmlP2] = await Promise.all([
      odooCall(uid, 'stock.picking',
        [['company_id','=',1],['state','in',['confirmed','assigned','waiting']],['picking_type_code','=','outgoing']],
        ['name','partner_id','state','scheduled_date','company_id']
      ),
      odooCall(uid, 'stock.picking',
        [['company_id','=',2],['state','in',['confirmed','assigned','waiting']],['picking_type_code','=','outgoing']],
        ['name','partner_id','state','scheduled_date','company_id']
      )
    ]);

    const pickings = [...parsePickings(xmlP1), ...parsePickings(xmlP2)];
    if (!pickings.length) return res.json({ importados: 0, omitidos: 0 });

    const movesXml = await odooCall(uid, 'stock.move',
      [['picking_id','in',pickings.map(p => p.id)],['state','not in',['done','cancel']]],
      ['picking_id','product_id','product_uom_qty']
    );
    const moves = parseMoves(movesXml);

    let importados = 0;
    let omitidos = 0;

    for (const p of pickings) {
      const existe = await sql`SELECT id FROM pedidos WHERE numero=${p.name}`;
      if (existe.length) { omitidos++; continue; }

      const empresa = p.company_id === 1 ? 'El Resero' : 'Empresa B';
      const productos = moves.filter(m => m.picking_id === p.id);
      const { talles, total } = parsearTallesDeProductos(productos);

      const modelosUnicos = [...new Set(productos.map(pr => {
        const m = pr.product.match(/\[(\d+)\./);
        return m ? m[1] : pr.product;
      }))];

      const productoNombre = modelosUnicos.length === 1
        ? productos[0].product.replace(/\[.*?\]\s*/, '').split('(')[0].trim()
        : 'Modelos: ' + modelosUnicos.join(', ');

      const notasDetalle = productos.map(pr => {
        const m = pr.product.match(/\[(\d+)\.(\d+)[MNAV]?\]/);
        return m ? `T${m[2]} x${Math.round(pr.qty)}` : pr.product + ' x' + pr.qty;
      }).join(' · ');

      const result = await sql`
        INSERT INTO pedidos (numero, cliente, producto, tipo, cantidad_pedida, cantidad_stock, empresa, notas, monto_total)
        VALUES (${p.name}, ${p.partner}, ${productoNombre}, 'cliente', ${total}, 0, ${empresa}, ${notasDetalle}, 0)
        RETURNING id
      `;
      const pedidoId = result[0].id;

      const lote = await sql`
        INSERT INTO lotes (pedido_id, numero, cantidad, etapa)
        VALUES (${pedidoId}, ${p.name + '-L1'}, ${total}, 'recibido')
        RETURNING id
      `;

      if (talles.length > 0) {
        for (const t of talles) {
          await sql`INSERT INTO talles (pedido_id, talle, cantidad) VALUES (${pedidoId}, ${t.talle}, ${t.cantidad})`;
        }
      }

      await sql`INSERT INTO historial (pedido_id, etapa_desde, etapa_hasta, usuario) VALUES (${pedidoId}, null, 'recibido', 'Sistema Odoo')`;
      await sql`INSERT INTO historial_lotes (lote_id, pedido_id, etapa_desde, etapa_hasta, usuario) VALUES (${lote[0].id}, ${pedidoId}, null, 'recibido', 'Sistema Odoo')`;

      importados++;
    }

    res.json({ importados, omitidos });

  } catch (err) {
    console.error('ERROR importar:', err.message);
    res.status(500).json({ error: err.message });
  }
};
