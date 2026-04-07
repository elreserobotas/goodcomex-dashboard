const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

async function initDB() {
  await sql`
    CREATE TABLE IF NOT EXISTS pedidos (
      id SERIAL PRIMARY KEY,
      numero TEXT NOT NULL,
      cliente TEXT,
      producto TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'cliente',
      cantidad_pedida INTEGER NOT NULL DEFAULT 0,
      cantidad_stock INTEGER NOT NULL DEFAULT 0,
      etapa TEXT NOT NULL DEFAULT 'recibido',
      aparador TEXT,
      empresa TEXT NOT NULL DEFAULT 'El Resero',
      notas TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS 
      monto_total NUMERIC DEFAULT 0`
    ;
  await sql`
    CREATE TABLE IF NOT EXISTS talles (
      id SERIAL PRIMARY KEY,
      pedido_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
      talle TEXT NOT NULL,
      cantidad INTEGER NOT NULL DEFAULT 0
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS historial (
      id SERIAL PRIMARY KEY,
      pedido_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
      etapa_desde TEXT,
      etapa_hasta TEXT NOT NULL,
      usuario TEXT NOT NULL,
      notas TEXT,
      fecha TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT 'viewer'
    )
  `;
  await sql`
  CREATE TABLE IF NOT EXISTS lotes (
    id SERIAL PRIMARY KEY,
    pedido_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
    numero TEXT NOT NULL,
    cantidad INTEGER NOT NULL DEFAULT 0,
    etapa TEXT NOT NULL DEFAULT 'recibido',
    aparador TEXT,
    notas TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS historial_lotes (
    id SERIAL PRIMARY KEY,
    lote_id INTEGER REFERENCES lotes(id) ON DELETE CASCADE,
    pedido_id INTEGER,
    etapa_desde TEXT,
    etapa_hasta TEXT NOT NULL,
    usuario TEXT NOT NULL,
    aparador TEXT,
    notas TEXT,
    fecha TIMESTAMP DEFAULT NOW()
  )
`;
  
await sql`
  CREATE TABLE IF NOT EXISTS stock_items (
    id SERIAL PRIMARY KEY,
    pedido_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
    lote_id INTEGER REFERENCES lotes(id) ON DELETE CASCADE,
    producto TEXT NOT NULL,
    talle TEXT,
    cantidad INTEGER NOT NULL DEFAULT 0,
    empresa TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'stock',
    created_at TIMESTAMP DEFAULT NOW()
  )
`;
  const existe = await sql`SELECT COUNT(*) FROM usuarios`;
  if (parseInt(existe[0].count) === 0) {
    await sql`INSERT INTO usuarios (nombre, email, password, rol) VALUES
  ('Admin', 'kevinlubi@gmail.com', 'kevinlubi', 'admin'),
  ('Jefe Produccion', 'produccion@goodcomex.com', 'danyfigueroa', 'produccion')
  ('Empaque', 'empaque@goodcomex.com', 'empaque123', 'empaque')
ON CONFLICT (email) DO NOTHING
`;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initDB();
    const { action } = req.query;

    if (req.method === 'POST' && action === 'login') {
      const { email, password } = req.body;
      const users = await sql`SELECT * FROM usuarios WHERE email=${email} AND password=${password}`;
      if (!users.length) return res.status(401).json({ error: 'Credenciales incorrectas' });
      const u = users[0];
      return res.json({ ok: true, usuario: { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol } });
return res.json({ ok: true, usuario: { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol } });
    }

    if (req.method === 'GET' && action === 'pedidos') {
      const pedidos = await sql`SELECT * FROM pedidos ORDER BY updated_at DESC`;
      for (const p of pedidos) {
        p.talles = await sql`SELECT * FROM talles WHERE pedido_id=${p.id} ORDER BY talle`;
        p.historial = await sql`SELECT * FROM historial WHERE pedido_id=${p.id} ORDER BY fecha DESC LIMIT 10`;
        p.lotes = await sql`SELECT id, pedido_id, numero, cantidad, etapa, aparador, notas, talles_detalle, created_at, updated_at FROM lotes WHERE pedido_id=${p.id} ORDER BY created_at ASC`;
        for (const l of p.lotes) {
          l.historial = await sql`SELECT * FROM historial_lotes WHERE lote_id=${l.id} ORDER BY fecha DESC LIMIT 5`;
        }
      }
      return res.json(pedidos);
    }

    if (req.method === 'GET' && action === 'stock') {
      const items = await sql`SELECT * FROM stock_items ORDER BY created_at DESC`;
      const pedidosIds = [...new Set(items.map(i => i.pedido_id))];
      const pedidos = pedidosIds.length > 0
        ? await sql`SELECT id, numero, cliente, producto, empresa FROM pedidos WHERE id = ANY(${pedidosIds})`
        : [];
      const pedidosMap = {};
      pedidos.forEach(p => { pedidosMap[p.id] = p; });
      return res.json(items.map(i => ({ ...i, pedido: pedidosMap[i.pedido_id] || null })));
    }

    if (req.method === 'POST' && action === 'crear') {
      const { numero, cliente, producto, tipo, cantidad_pedida, cantidad_stock, empresa, notas, talles, usuario, monto_total } = req.body;
      const result = await sql`
        INSERT INTO pedidos (numero, cliente, producto, tipo, cantidad_pedida, cantidad_stock, empresa, notas, monto_total)
        VALUES (${numero}, ${cliente||null}, ${producto}, ${tipo}, ${cantidad_pedida||0}, ${cantidad_stock||0}, ${empresa}, ${notas||null}, ${monto_total||0})
        RETURNING *
      `;
      const pedido = result[0];
      if (talles?.length) {
        for (const t of talles) {
          await sql`INSERT INTO talles (pedido_id, talle, cantidad) VALUES (${pedido.id}, ${t.talle}, ${t.cantidad})`;
        }
      }
      const lote = await sql`
        INSERT INTO lotes (pedido_id, numero, cantidad, etapa)
        VALUES (${pedido.id}, ${numero + '-L1'}, ${(cantidad_pedida||0)+(cantidad_stock||0)}, 'recibido')
        RETURNING *
      `;
      await sql`INSERT INTO historial (pedido_id, etapa_desde, etapa_hasta, usuario) VALUES (${pedido.id}, null, 'recibido', ${usuario})`;
      await sql`INSERT INTO historial_lotes (lote_id, pedido_id, etapa_desde, etapa_hasta, usuario) VALUES (${lote[0].id}, ${pedido.id}, null, 'recibido', ${usuario})`;
      return res.json({ ok: true, pedido });
    }

    if (req.method === 'POST' && action === 'crear-lote') {
      const { pedido_id, cantidad, usuario, notas } = req.body;
      const existentes = await sql`SELECT COUNT(*) FROM lotes WHERE pedido_id=${pedido_id}`;
      const num = parseInt(existentes[0].count) + 1;
      const pedido = await sql`SELECT numero FROM pedidos WHERE id=${pedido_id}`;
      const lote = await sql`
        INSERT INTO lotes (pedido_id, numero, cantidad, etapa, notas)
        VALUES (${pedido_id}, ${pedido[0].numero + '-L' + num}, ${cantidad}, 'recibido', ${notas||null})
        RETURNING *
      `;
      await sql`INSERT INTO historial_lotes (lote_id, pedido_id, etapa_desde, etapa_hasta, usuario, notas) VALUES (${lote[0].id}, ${pedido_id}, null, 'recibido', ${usuario}, ${notas||null})`;
      return res.json({ ok: true, lote: lote[0] });
    }

    if (req.method === 'PUT' && action === 'etapa-lote') {
      const { lote_id, etapa, aparador, usuario, notas } = req.body;
      const actual = await sql`SELECT etapa, pedido_id FROM lotes WHERE id=${lote_id}`;
      await sql`UPDATE lotes SET etapa=${etapa}, aparador=${aparador||null}, updated_at=NOW() WHERE id=${lote_id}`;
      await sql`INSERT INTO historial_lotes (lote_id, pedido_id, etapa_desde, etapa_hasta, usuario, aparador, notas) VALUES (${lote_id}, ${actual[0].pedido_id}, ${actual[0].etapa}, ${etapa}, ${usuario}, ${aparador||null}, ${notas||null})`;
      const todoLotes = await sql`SELECT etapa FROM lotes WHERE pedido_id=${actual[0].pedido_id}`;
      const etapas = todoLotes.map(l => l.etapa);
      const etapaOrden = ['recibido','corte','deposito_corte','deposito','aparado','armado','fabrica','cosedor','empaque','stock','listo'];
      const minEtapa = etapas.reduce((min, e) => etapaOrden.indexOf(e) < etapaOrden.indexOf(min) ? e : min, etapas[0]);
      await sql`UPDATE pedidos SET etapa=${minEtapa}, updated_at=NOW() WHERE id=${actual[0].pedido_id}`;
      return res.json({ ok: true });
    }

    if (req.method === 'PUT' && action === 'editar-lote') {
      const { id, cantidad, notas } = req.body;
      await sql`UPDATE lotes SET cantidad=${cantidad}, notas=${notas||null}, updated_at=NOW() WHERE id=${id}`;
      return res.json({ ok: true });
    }

    if (req.method === 'POST' && action === 'dividir-lote') {
  const { lote_id, cantidad_nueva, usuario, notas, talles_nuevo, talles_original } = req.body;
  const lote = await sql`SELECT * FROM lotes WHERE id=${lote_id}`;
  if (!lote.length) return res.status(404).json({ error: 'Lote no encontrado' });
  const l = lote[0];
  if (cantidad_nueva > l.cantidad) return res.status(400).json({ error: 'La cantidad nueva supera el lote original' });
if (cantidad_nueva === l.cantidad) {
  // Mover todo al nuevo lote — actualizar talles_detalle y devolver el mismo lote
  const tallesNuevoJson = talles_nuevo ? JSON.stringify(talles_nuevo) : null;
  await sql`UPDATE lotes SET talles_detalle=${tallesNuevoJson}, updated_at=NOW() WHERE id=${lote_id}`;
  return res.json({ ok: true, nuevoLote: lote[0] });
}
      
  const tallesNuevoJson = talles_nuevo ? JSON.stringify(talles_nuevo) : null;
  const tallesOriginalJson = talles_original ? JSON.stringify(talles_original) : null;
  
  await sql`UPDATE lotes SET cantidad=${l.cantidad - cantidad_nueva}, talles_detalle=${tallesOriginalJson}, updated_at=NOW() WHERE id=${lote_id}`;
  const existentes = await sql`SELECT COUNT(*) FROM lotes WHERE pedido_id=${l.pedido_id}`;
  const num = parseInt(existentes[0].count) + 1;
  const pedido = await sql`SELECT numero FROM pedidos WHERE id=${l.pedido_id}`;
  const nuevoLote = await sql`
    INSERT INTO lotes (pedido_id, numero, cantidad, etapa, aparador, notas, talles_detalle)
    VALUES (${l.pedido_id}, ${pedido[0].numero + '-L' + num}, ${cantidad_nueva}, ${l.etapa}, ${l.aparador||null}, ${notas||null}, ${tallesNuevoJson})
    RETURNING *
  `;
  await sql`INSERT INTO historial_lotes (lote_id, pedido_id, etapa_desde, etapa_hasta, usuario, notas) VALUES (${nuevoLote[0].id}, ${l.pedido_id}, null, ${l.etapa}, ${usuario}, ${'Dividido de ' + l.numero})`;
  return res.json({ ok: true, nuevoLote: nuevoLote[0] });
}

    if (req.method === 'PUT' && action === 'etapa') {
      const { id, etapa, aparador, usuario, notas } = req.body;
      const actual = await sql`SELECT etapa FROM pedidos WHERE id=${id}`;
      await sql`UPDATE pedidos SET etapa=${etapa}, aparador=${aparador||null}, updated_at=NOW() WHERE id=${id}`;
      await sql`UPDATE lotes SET etapa=${etapa}, aparador=${aparador||null}, updated_at=NOW() WHERE pedido_id=${id}`;
      await sql`INSERT INTO historial (pedido_id, etapa_desde, etapa_hasta, usuario, notas) VALUES (${id}, ${actual[0].etapa}, ${etapa}, ${usuario}, ${notas||null})`;
      return res.json({ ok: true });
    }

    if (req.method === 'PUT' && action === 'editar') {
      const { id, cliente, producto, tipo, cantidad_pedida, cantidad_stock, empresa, notas, talles, monto_total } = req.body;
      await sql`UPDATE pedidos SET cliente=${cliente||null}, producto=${producto}, tipo=${tipo}, cantidad_pedida=${cantidad_pedida||0}, cantidad_stock=${cantidad_stock||0}, empresa=${empresa}, notas=${notas||null}, monto_total=${monto_total||0}, updated_at=NOW() WHERE id=${id}`;
      await sql`DELETE FROM talles WHERE pedido_id=${id}`;
      if (talles?.length) {
        for (const t of talles) {
          await sql`INSERT INTO talles (pedido_id, talle, cantidad) VALUES (${id}, ${t.talle}, ${t.cantidad})`;
        }
      }
      return res.json({ ok: true });
    }

    if (req.method === 'DELETE' && action === 'eliminar') {
      const { id } = req.body;
      await sql`DELETE FROM pedidos WHERE id=${id}`;
      return res.json({ ok: true });
    }

    if (req.method === 'DELETE' && action === 'eliminar-lote') {
      const { id } = req.body;
      await sql`DELETE FROM lotes WHERE id=${id}`;
      return res.json({ ok: true });
    }

    if (req.method === 'PUT' && action === 'stock-estado') {
      const { id, estado } = req.body;
      await sql`UPDATE stock_items SET estado=${estado} WHERE id=${id}`;
      return res.json({ ok: true });
    }

    res.status(404).json({ error: 'Acción no encontrada' });

  } catch (err) {
    console.error('ERROR produccion:', err.message);
    res.status(500).json({ error: err.message });
  }
};
