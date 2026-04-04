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
  const existe = await sql`SELECT COUNT(*) FROM usuarios`;
  if (parseInt(existe[0].count) === 0) {
    await sql`INSERT INTO usuarios (nombre, email, password, rol) VALUES
      ('Admin', 'kevinlubi@gmail.com', 'admin123', 'admin'),
      ('Jefe Produccion', 'produccion@goodcomex.com', 'produccion123', 'produccion')
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
    }

    if (req.method === 'GET' && action === 'pedidos') {
      const pedidos = await sql`SELECT * FROM pedidos ORDER BY updated_at DESC`;
      for (const p of pedidos) {
        p.talles = await sql`SELECT * FROM talles WHERE pedido_id=${p.id} ORDER BY talle`;
        p.historial = await sql`SELECT * FROM historial WHERE pedido_id=${p.id} ORDER BY fecha DESC LIMIT 10`;
      }
      return res.json(pedidos);
    }

    if (req.method === 'POST' && action === 'crear') {
      const { numero, cliente, producto, tipo, cantidad_pedida, cantidad_stock, empresa, notas, talles, usuario } = req.body;
      const result = await sql`
        INSERT INTO pedidos (numero, cliente, producto, tipo, cantidad_pedida, cantidad_stock, empresa, notas)
        VALUES (${numero}, ${cliente||null}, ${producto}, ${tipo}, ${cantidad_pedida||0}, ${cantidad_stock||0}, ${empresa}, ${notas||null})
        RETURNING *
      `;
      const pedido = result[0];
      if (talles && talles.length) {
        for (const t of talles) {
          await sql`INSERT INTO talles (pedido_id, talle, cantidad) VALUES (${pedido.id}, ${t.talle}, ${t.cantidad})`;
        }
      }
      await sql`INSERT INTO historial (pedido_id, etapa_desde, etapa_hasta, usuario) VALUES (${pedido.id}, null, 'recibido', ${usuario})`;
      return res.json({ ok: true, pedido });
    }

    if (req.method === 'PUT' && action === 'etapa') {
      const { id, etapa, aparador, usuario, notas } = req.body;
      const actual = await sql`SELECT etapa FROM pedidos WHERE id=${id}`;
      await sql`UPDATE pedidos SET etapa=${etapa}, aparador=${aparador||null}, updated_at=NOW() WHERE id=${id}`;
      await sql`INSERT INTO historial (pedido_id, etapa_desde, etapa_hasta, usuario, notas) VALUES (${id}, ${actual[0].etapa}, ${etapa}, ${usuario}, ${notas||null})`;
      return res.json({ ok: true });
    }

    if (req.method === 'PUT' && action === 'editar') {
      const { id, cliente, producto, tipo, cantidad_pedida, cantidad_stock, empresa, notas, talles } = req.body;
      await sql`UPDATE pedidos SET cliente=${cliente||null}, producto=${producto}, tipo=${tipo}, cantidad_pedida=${cantidad_pedida||0}, cantidad_stock=${cantidad_stock||0}, empresa=${empresa}, notas=${notas||null}, updated_at=NOW() WHERE id=${id}`;
      await sql`DELETE FROM talles WHERE pedido_id=${id}`;
      if (talles && talles.length) {
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

    res.status(404).json({ error: 'Acción no encontrada' });

  } catch (err) {
    console.error('ERROR produccion:', err.message);
    res.status(500).json({ error: err.message });
  }
};
