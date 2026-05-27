const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const lotes = await sql`
      SELECT l.talles_detalle, l.cantidad, l.etapa, p.id as pedido_id
      FROM lotes l
      JOIN pedidos p ON p.id = l.pedido_id
      WHERE (p.archivado = false OR p.archivado IS NULL)
      AND l.etapa NOT IN ('listo')
    `;

    const talles = await sql`
      SELECT t.modelo, t.talle, t.cantidad, t.nombre_producto, t.pedido_id
      FROM talles t
      JOIN pedidos p ON p.id = t.pedido_id
      WHERE (p.archivado = false OR p.archivado IS NULL)
    `;

    const resumen = {};

    // Primero intentar desde talles_detalle de los lotes
    const pedidosConDetalle = new Set();
    lotes.forEach(l => {
      const td = l.talles_detalle;
      if (td && Array.isArray(td) && td.length > 0) {
        pedidosConDetalle.add(l.pedido_id);
        td.forEach(t => {
          const modelo = t.modelo || '?';
          const nombre = t.nombre_producto || '';
          const talle = t.talle || '—';
          if (!resumen[modelo]) resumen[modelo] = { modelo, nombre, talles: {} };
          resumen[modelo].talles[talle] = (resumen[modelo].talles[talle] || 0) + (parseInt(t.cantidad) || 0);
        });
      }
    });

    // Para pedidos sin talles_detalle usar tabla talles
    talles.forEach(t => {
      if (pedidosConDetalle.has(t.pedido_id)) return;
      const modelo = t.modelo || '?';
      const nombre = t.nombre_producto || '';
      const talle = t.talle || '—';
      if (!resumen[modelo]) resumen[modelo] = { modelo, nombre, talles: {} };
      resumen[modelo].talles[talle] = (resumen[modelo].talles[talle] || 0) + (parseInt(t.cantidad) || 0);
    });

    const modelos = Object.values(resumen)
      .sort((a, b) => (parseInt(a.modelo) || 0) - (parseInt(b.modelo) || 0))
      .map(m => ({
        modelo: m.modelo,
        nombre: m.nombre,
        talles: Object.entries(m.talles)
          .sort((a, b) => (parseInt(a[0]) || 0) - (parseInt(b[0]) || 0))
          .map(([talle, cantidad]) => ({ talle, cantidad })),
        total: Object.values(m.talles).reduce((a, b) => a + b, 0)
      }));

    return res.json({
      modelos,
      totalPares: modelos.reduce((a, m) => a + m.total, 0)
    });

  } catch (err) {
    console.error('ERROR resumen-produccion:', err.message);
    res.status(500).json({ error: err.message });
  }
};
