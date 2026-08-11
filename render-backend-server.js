/**
 * ReefMusic Backend - Render.com
 * 
 * Este servidor:
 * 1. Recibe una solicitud con datos de iTunes (título, artista, URL)
 * 2. Usa yt-dlp para descargar el audio de SoundCloud
 * 3. Convierte a MP3 con ffmpeg
 * 4. Sube a Cloudflare R2
 * 5. Retorna URL y metadatos para almacenar en la app
 * 
 * Stack: Node.js + Express + yt-dlp + ffmpeg
 */

const express = require('express');
const cors = require('cors');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN
// ────────────────────────────────────────────────────────────────────────────

const TEMP_DIR = '/tmp/reefmusic';
const RENDER_BACKEND_URL = process.env.RENDER_BACKEND_URL || 'http://localhost:3000';

// Cloudflare R2
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'reefmusic';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || `https://pub-${R2_ACCOUNT_ID}.r2.dev`;

// Crear directorio temporal si no existe
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Extrae el mensaje de error real de yt-dlp/ffmpeg (stderr) para poder
 * devolverlo en la respuesta y diagnosticar sin entrar a los logs de Render.
 */
function processErrorMessage(error) {
  const raw = error.stderr ? error.stderr.toString() : (error.message || '');
  const lastLine = String(raw).trim().split('\n').filter(Boolean).pop() || String(raw).trim();
  return lastLine.slice(0, 300) || 'Error desconocido';
}

// ────────────────────────────────────────────────────────────────────────────
// UTILIDADES
// ────────────────────────────────────────────────────────────────────────────

/**
 * Genera un ID único para la canción
 */
function generateTrackId() {
  return `track_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Las URLs de tracks de SoundCloud que aceptamos como "id" de una canción.
// Se valida estricto porque la URL se inserta como argumento de yt-dlp.
const SOUNDCLOUD_URL_RE = /^https:\/\/(www\.|m\.)?soundcloud\.com\/[\w\-\/]+(\?[\w=&-]+)?$/;

/**
 * Limpia un texto para poder usarlo como nombre de archivo / clave de R2.
 */
function sanitizeForFilename(str) {
  return String(str || '')
    .replace(/[\/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

/**
 * Limpia el nombre de usuario para usarlo como prefijo de carpeta en R2.
 */
function sanitizeUsername(str) {
  return String(str || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
}

/**
 * Busca en SoundCloud la canción usando yt-dlp (fallback cuando no hay
 * una URL puntual elegida por el usuario).
 */
function searchSoundCloud(query) {
  const results = searchSoundCloudMultiple(query, 1);
  if (!results.length) {
    throw new Error('No se encontró la canción en SoundCloud');
  }
  return results[0].url;
}

/**
 * Busca en SoundCloud y devuelve varios resultados (título, artista,
 * duración, thumbnail, url) SIN descargar nada — para mostrarle una lista
 * al usuario. SoundCloud no tiene el bloqueo anti-bot que tiene YouTube en
 * IPs de datacenter, así que no hace falta cookies ni trucos de cliente.
 */
function searchSoundCloudMultiple(query, limit = 5) {
  try {
    const raw = execFileSync('yt-dlp', [
      `scsearch${limit}:${query}`,
      '--flat-playlist',
      '--dump-json',
      '-q', '--no-warnings'
    ], { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();

    if (!raw) return [];

    return raw.split('\n').filter(Boolean).map(line => {
      let v;
      try { v = JSON.parse(line); } catch (_) { return null; }
      const trackUrl = v?.webpage_url || v?.url;
      if (!v || !trackUrl) return null;
      const thumb = v.thumbnail || (v.thumbnails?.length ? v.thumbnails[v.thumbnails.length - 1].url : '');
      return {
        url: trackUrl,
        title: v.title || 'Sin título',
        artist: v.uploader || v.channel || '',
        duration: v.duration || 0,
        thumbnail: thumb || '',
      };
    }).filter(Boolean);
  } catch (error) {
    const detail = processErrorMessage(error);
    console.error('Error buscando en SoundCloud:', detail);
    throw new Error(`No se pudo buscar en SoundCloud: ${detail}`);
  }
}

/**
 * Obtiene una URL de audio directa (para reproducir un preview) sin
 * descargar el archivo al disco.
 */
function getStreamUrl(trackUrl) {
  if (!SOUNDCLOUD_URL_RE.test(trackUrl)) {
    throw new Error('URL de SoundCloud inválida');
  }
  try {
    const result = execFileSync('yt-dlp', [
      '-f', 'bestaudio/best', '--get-url',
      trackUrl,
      '-q', '--no-warnings'
    ], { encoding: 'utf-8', maxBuffer: 1024 * 1024 }).trim();

    if (!result) throw new Error('No se pudo obtener el audio');
    return result.split('\n')[0];
  } catch (error) {
    const detail = processErrorMessage(error);
    console.error('Error obteniendo stream:', detail);
    throw new Error(`No se pudo obtener el audio de esa canción: ${detail}`);
  }
}

/**
 * Descarga audio desde una URL de SoundCloud y lo convierte a MP3
 */
async function downloadAndConvertToMP3(trackUrl, outputPath) {
  try {
    console.log(`📥 Descargando de: ${trackUrl}`);

    const tempAudio = path.join(TEMP_DIR, `temp_${Date.now()}.audio`);

    // Descargar con yt-dlp
    execFileSync('yt-dlp', [
      '-f', 'bestaudio/best', '-o', tempAudio, trackUrl, '-q', '--no-warnings'
    ], { maxBuffer: 50 * 1024 * 1024 });

    if (!fs.existsSync(tempAudio)) {
      throw new Error('La descarga falló');
    }

    console.log(`🔄 Convirtiendo a MP3...`);

    // Convertir a MP3 con ffmpeg
    execFileSync('ffmpeg', [
      '-i', tempAudio, '-q:a', '0', '-map', 'a', outputPath, '-y', '-loglevel', 'error'
    ]);

    // Eliminar archivo temporal
    fs.unlinkSync(tempAudio);

    if (!fs.existsSync(outputPath)) {
      throw new Error('La conversión a MP3 falló');
    }

    console.log(`✅ MP3 listo: ${outputPath}`);
    return true;
  } catch (error) {
    const detail = processErrorMessage(error);
    console.error('Error en descarga/conversión:', detail);
    throw new Error(`Fallo en descarga: ${detail}`);
  }
}

/**
 * Descarga una imagen de portada (thumbnail) y la sube a R2 junto a la
 * canción. Best-effort: si falla, no rompe el flujo de descarga principal.
 */
async function uploadCoverIfPossible(thumbnailUrl, coverKey) {
  if (!thumbnailUrl) return null;
  const tempCover = path.join(TEMP_DIR, `cover_${Date.now()}.jpg`);
  try {
    const resp = await axios.get(thumbnailUrl, { responseType: 'arraybuffer', timeout: 8000 });
    fs.writeFileSync(tempCover, resp.data);
    const url = await uploadToR2(tempCover, coverKey, 'image/jpeg');
    return url;
  } catch (error) {
    console.warn('No se pudo subir la portada:', error.message);
    return null;
  } finally {
    if (fs.existsSync(tempCover)) fs.unlinkSync(tempCover);
  }
}

// pub-xxxx.r2.dev es un dominio público de SOLO LECTURA (para reproducir),
// no acepta subidas autenticadas. Las subidas van al endpoint real de la
// API S3 de Cloudflare, firmado con el SDK oficial (evita reinventar SigV4).
const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
  },
});

/**
 * Sube archivo a Cloudflare R2. "key" es la clave RAW (sin percent-encode) —
 * el SDK se encarga de codificarla en el request; el frontend hace su propio
 * encodeURIComponent por tramo al armar la URL pública de lectura.
 */
async function uploadToR2(filePath, key, contentType = 'audio/mpeg') {
  try {
    console.log(`☁️  Subiendo a R2: ${key}`);

    const fileContent = fs.readFileSync(filePath);

    await r2Client.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: fileContent,
      ContentType: contentType,
    }));

    const publicUrl = `${R2_PUBLIC_URL}/${key.split('/').map(encodeURIComponent).join('/')}`;
    console.log(`✅ Subido a R2: ${publicUrl}`);
    return publicUrl;
  } catch (error) {
    console.error('Error subiendo a R2:', error.message);
    throw new Error(`Fallo al subir a R2: ${error.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// RUTAS
// ────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/search?q=...
 *
 * Busca canciones en SoundCloud (sin descargar) y devuelve una lista de
 * resultados para que el usuario elija cuál quiere escuchar/descargar.
 */
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) {
    return res.status(400).json({ success: false, error: 'Falta el parámetro q' });
  }

  try {
    const results = searchSoundCloudMultiple(q, 5);
    return res.json({ success: true, results });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/stream?url=trackUrl
 *
 * Devuelve una URL de audio directa para reproducir un preview antes
 * de descargar la canción.
 */
app.get('/api/stream', (req, res) => {
  const trackUrl = (req.query.url || '').toString().trim();
  if (!trackUrl) {
    return res.status(400).json({ success: false, error: 'Falta el parámetro url' });
  }

  try {
    const url = getStreamUrl(trackUrl);
    return res.json({ success: true, url });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/download-and-upload
 *
 * Body (buscador nuevo, canción puntual ya elegida por el usuario):
 * {
 *   "trackUrl": "https://soundcloud.com/artista/cancion",
 *   "trackName": "Levitating",
 *   "artistName": "Dua Lipa",
 *   "artworkUrl": "https://...",
 *   "username": "maria"
 * }
 *
 * Body (modo legacy, sin trackUrl — busca a ciegas por texto):
 * {
 *   "trackName": "Levitating",
 *   "artistName": "Dua Lipa",
 *   "collectionName": "Future Nostalgia",
 *   "artworkUrl": "https://...",
 *   "username": "maria"
 * }
 *
 * "username" define la carpeta del usuario en R2 (misma convención que usa
 * el resto de la app: "usuario/Artista - Título.mp3") para que la canción
 * aparezca en su biblioteca al sincronizar.
 */
app.post('/api/download-and-upload', async (req, res) => {
  const { trackUrl, trackName, artistName, collectionName, artworkUrl, username } = req.body;

  try {
    const user = sanitizeUsername(username);
    if (!user) {
      return res.status(400).json({ success: false, error: 'username es requerido' });
    }

    let sourceUrl;
    let finalTrackName  = trackName;
    let finalArtistName = artistName;

    if (trackUrl) {
      if (!SOUNDCLOUD_URL_RE.test(trackUrl)) {
        return res.status(400).json({ success: false, error: 'trackUrl inválida' });
      }
      sourceUrl = trackUrl;
      finalTrackName  = trackName  || 'Sin título';
      finalArtistName = artistName || 'Artista desconocido';
    } else {
      if (!trackName || !artistName) {
        return res.status(400).json({
          success: false,
          error: 'trackName y artistName son requeridos'
        });
      }
      const query = `${trackName} ${artistName}`;
      sourceUrl = searchSoundCloud(query);
    }

    console.log(`\n🎵 Nuevo track: ${finalTrackName} - ${finalArtistName} (usuario: ${user})`);

    const trackId = generateTrackId();
    const baseFileName = `${sanitizeForFilename(finalArtistName)} - ${sanitizeForFilename(finalTrackName)}`.trim()
      || `track_${Date.now()}`;
    const mp3Key       = `${user}/${baseFileName}.mp3`;
    const coverKey     = `${user}/${baseFileName}_cover.jpg`;
    const tempMp3Path  = path.join(TEMP_DIR, `${trackId}.mp3`);

    // 1. Descargar y convertir
    await downloadAndConvertToMP3(sourceUrl, tempMp3Path);

    // 2. Subir a R2 bajo la carpeta del usuario
    const r2Url = await uploadToR2(tempMp3Path, mp3Key, 'audio/mpeg');

    // 3. Limpiar temporal
    fs.unlinkSync(tempMp3Path);

    // 4. Subir portada (best-effort, no bloquea si falla)
    const coverUrl = await uploadCoverIfPossible(artworkUrl, coverKey);

    // 5. Retornar metadata
    const response = {
      success: true,
      trackId,
      url: r2Url,
      track: {
        trackName: finalTrackName || 'Desconocido',
        artistName: finalArtistName || 'Artista desconocido',
        collectionName: collectionName || 'Álbum desconocido',
        artworkUrl: coverUrl || artworkUrl || null,
        downloadedAt: new Date().toISOString(),
        duration: 0 // Se puede obtener con ffprobe si es necesario
      }
    };

    console.log(`✨ Track completado: ${trackId}`);
    return res.json(response);

  } catch (error) {
    console.error('❌ Error:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error procesando la solicitud'
    });
  }
});

/**
 * GET /api/health
 * Verificar que el servidor está activo
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    backend: 'ReefMusic Render',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/test-youtube
 * Prueba rápida de yt-dlp
 */
app.get('/api/test-youtube', (req, res) => {
  try {
    const result = execFileSync('yt-dlp', ['--version'], { encoding: 'utf-8' });
    res.json({
      status: 'ok',
      ytdlp: result.trim()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'yt-dlp no está instalado'
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// INICIO DEL SERVIDOR
// ────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 ReefMusic Backend ejecutándose en puerto ${PORT}`);
  console.log(`📍 URL: ${RENDER_BACKEND_URL}`);
  console.log(`☁️  R2: ${R2_PUBLIC_URL}/${R2_BUCKET_NAME}`);
  console.log(`✅ Listo para procesar canciones\n`);
});
