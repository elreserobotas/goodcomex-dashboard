const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const lotes = await sql`
      SELECT l.talles_detalle, l.cantidad, l.etapa, p.id as pedido_id, p.cliente, p.notas
      FROM lotes l
      JOIN pedidos p ON p.id = l.pedido_id
      WHERE (p.archivado = false OR p.archivado IS NULL)
      AND l.etapa NOT IN ('listo')
    `;

    const talles = await sql`
      SELECT t.modelo, t.talle, t.cantidad, t.nombre_producto, t.pedido_id,
             p.cliente, p.notas
      FROM talles t
      JOIN pedidos p ON p.id = t.pedido_id
      WHERE (p.archivado = false OR p.archivado IS NULL)
    `;

    const resumen = {};
    const detallePorModelo = {}; // modelo → [ { cliente, talle, cantidad } ]

    const pedidosConDetalle = new Set();

    lotes.forEach(l => {
      const td = l.talles_detalle;
      if (td && Array.isArray(td) && td.length > 0) {
        pedidosConDetalle.add(l.pedido_id);
        const clienteNombre = l.notas
          ? l.notas.split(' · ')[0]
          : (l.cliente || '—');

        td.forEach(t => {
          const modelo = t.modelo || '?';
          const nombre = t.nombre_producto || '';
          const talle = t.talle || '—';
          const cant = parseInt(t.cantidad) || 0;

          if (!resumen[modelo]) resumen[modelo] = { modelo, nombre, talles: {} };
          resumen[modelo].talles[talle] = (resumen[modelo].talles[talle] || 0) + cant;

          if (!detallePorModelo[modelo]) detallePorModelo[modelo] = [];
          detallePorModelo[modelo].push({ cliente: clienteNombre, talle, cantidad: cant });
        });
      }
    });

    talles.forEach(t => {
      if (pedidosConDetalle.has(t.pedido_id)) return;
      const modelo = t.modelo || '?';
      const nombre = t.nombre_producto || '';
      const talle = t.talle || '—';
      const cant = parseInt(t.cantidad) || 0;
      const clienteNombre = t.notas
        ? t.notas.split(' · ')[0]
        : (t.cliente || '—');

      if (!resumen[modelo]) resumen[modelo] = { modelo, nombre, talles: {} };
      resumen[modelo].talles[talle] = (resumen[modelo].talles[talle] || 0) + cant;

      if (!detallePorModelo[modelo]) detallePorModelo[modelo] = [];
      detallePorModelo[modelo].push({ cliente: clienteNombre, talle, cantidad: cant });
    });

    // Agrupar detalle por cliente dentro de cada modelo
    const detalleAgrupado = {};
    Object.entries(detallePorModelo).forEach(([modelo, filas]) => {
      const porCliente = {};
      filas.forEach(f => {
        if (!porCliente[f.cliente]) porCliente[f.cliente] = {};
        porCliente[f.cliente][f.talle] = (porCliente[f.cliente][f.talle] || 0) + f.cantidad;
      });
      detalleAgrupado[modelo] = Object.entries(porCliente)
        .map(([cliente, tallesObj]) => ({
          cliente,
          talles: Object.entries(tallesObj)
            .sort((a,b) => (parseInt(a[0])||0) - (parseInt(b[0])||0))
            .map(([talle, cantidad]) => ({ talle, cantidad })),
          total: Object.values(tallesObj).reduce((a,b) => a+b, 0)
        }))
        .sort((a,b) => b.total - a.total);
    });

    const modelos = Object.values(resumen)
      .sort((a, b) => (parseInt(a.modelo) || 0) - (parseInt(b.modelo) || 0))
      .map(m => ({
        modelo: m.modelo,
        nombre: m.nombre,
        talles: Object.entries(m.talles)
          .sort((a, b) => (parseInt(a[0]) || 0) - (parseInt(b[0]) || 0))
          .map(([talle, cantidad]) => ({ talle, cantidad })),
        total: Object.values(m.talles).reduce((a, b) => a + b, 0),
        detalle: detalleAgrupado[m.modelo] || []
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
