const pool = require('../db/pool');

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    bio: row.bio,
    photoDataUrl: row.photo_data_url,
  };
}

async function list(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM team_members ORDER BY display_order ASC, name ASC');
    return res.json({ items: rows.map(serialize) });
  } catch (err) {
    return next(err);
  }
}

// Somente Administrador troca a foto de qualquer membro (tela "Sobre Nós").
async function updatePhoto(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Envie um arquivo de imagem.' });
    }

    const photoDataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    const { rows } = await pool.query(
      'UPDATE team_members SET photo_data_url = $1, updated_at = now() WHERE id = $2 RETURNING *',
      [photoDataUrl, req.params.id]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Membro não encontrado.' });

    return res.json(serialize(rows[0]));
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, updatePhoto };
