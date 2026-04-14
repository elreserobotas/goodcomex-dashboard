const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'Faltan parámetros' });

    const etapas = ['armado', 'cosedor', 'empaque', 'listo'];

    const historial = await sql`
      SELECT 
        hl.etapa_hasta,
        hl.fecha,
        l.cantidad,
        l.talles_detalle,
        p.producto
      FROM historial_lotes hl
      JOIN lotes l ON l.id = hl.lote_id
      JOIN pedidos p ON p.id = hl.pedido_id
      WHERE hl.etapa_hasta = ANY(${etapas})
        AND DATE(hl.fecha) >= ${desde}
        AND DATE(hl.fecha) <= ${hasta}
      ORDER BY hl.fecha ASC
    `;

    // Agrupar por etapa y por día
    const porEtapa = {};
    etapas.forEach(e => { porEtapa[e] = {}; });

    historial.forEach(h => {
      const dia = new Date(h.fecha).toISOString().slice(0,10);
      const etapa = h.etapa_hasta;
      if (!porEtapa[etapa][dia]) porEtapa[etapa][dia] = { pares: 0, modelos: {} };
      porEtapa[etapa][dia].pares += parseInt(h.cantidad) || 0;

      // Desglose por modelo
      const talles = h.talles_detalle || [];
      if (Array.isArray(talles)) {
        talles.forEach(t => {
          const mod = t.modelo || '?';
          if (!porEtapa[etapa][dia].modelos[mod]) porEtapa[etapa][dia].modelos[mod] = 0;
          porEtapa[etapa][dia].modelos[mod] += parseInt(t.cantidad) || 0;
        });
      }
    });

    // Totales por etapa
    const totales = {};
    etapas.forEach(e => {
      totales[e] = Object.values(porEtapa[e]).reduce((a,d) => a + d.pares, 0);
    });

    return res.json({ porEtapa, totales, etapas });

  } catch (err) {
    console.error('ERROR informe:', err.message);
    res.status(500).json({ error: err.message });
  }
};
