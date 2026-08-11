/**
 * ReefMusic Backend - Render.com
 * 
 * Este servidor:
 * 1. Recibe una solicitud con datos de iTunes (título, artista, URL)
 * 2. Usa yt-dlp para descargar el audio de YouTube
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
const FormData = require('form-data');
const crypto = require('crypto');
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

// YouTube bloquea las IPs de datacenter (como las de Render) pidiendo
// "Sign in to confirm you're not a bot". La forma soportada de evitarlo
// desde un servidor sin navegador es pasarle un cookies.txt de una sesión
// real. Subilo como "Secret File" en Render (nombre "cookies.txt", se monta
// en /etc/secrets/cookies.txt) o seteá YTDLP_COOKIES_PATH con la ruta.
const YTDLP_COOKIES_SOURCE = process.env.YTDLP_COOKIES_PATH || '/etc/secrets/cookies.txt';
// yt-dlp reescribe el archivo de cookies al terminar (para guardar cookies
// renovadas), pero los Secret Files de Render se montan de solo lectura.
// Copiamos el archivo a /tmp, que sí es escribible, y usamos esa copia.
const YTDLP_COOKIES_PATH = path.join(TEMP_DIR, 'cookies.txt');
if (fs.existsSync(YTDLP_COOKIES_SOURCE)) {
  try {
    fs.copyFileSync(YTDLP_COOKIES_SOURCE, YTDLP_COOKIES_PATH);
    console.log('🍪 cookies.txt copiado a una ruta escribible para yt-dlp');
  } catch (err) {
    console.error('No se pudo copiar cookies.txt a una ruta escribible:', err.message);
  }
}

function ytDlpCookieArgs() {
  return fs.existsSync(YTDLP_COOKIES_PATH) ? ['--cookies', YTDLP_COOKIES_PATH] : [];
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

// IDs de video de YouTube: siempre 11 caracteres alfanuméricos (+ "-"/"_").
// Se valida estricto porque el id se inserta como argumento de yt-dlp.
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

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
 * Codifica cada tramo de una clave de R2 por separado (para no romper las
 * "/" que separan carpetas), igual que hace el frontend con r2Url().
 */
function encodeR2Key(key) {
  return String(key).split('/').map(encodeURIComponent).join('/');
}

/**
 * Busca en YouTube la canción usando yt-dlp (fallback cuando no hay
 * un videoId puntual elegido por el usuario).
 */
function searchYouTube(query) {
  try {
    const result = execFileSync('yt-dlp', [
      '-f', 'bestaudio', '--get-url',
      `ytsearch:${query}`,
      '-q', '--no-warnings',
      ...ytDlpCookieArgs()
    ], { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();

    if (!result) {
      throw new Error('No se encontró video en YouTube');
    }

    return result.split('\n')[0]; // Retorna la primera URL
  } catch (error) {
    const detail = processErrorMessage(error);
    console.error('Error buscando en YouTube:', detail);
    throw new Error(`No se pudo encontrar la canción en YouTube: ${detail}`);
  }
}

/**
 * Busca en YouTube y devuelve varios resultados (título, canal, duración,
 * thumbnail, videoId) SIN descargar nada — para mostrar una lista al usuario.
 */
function searchYouTubeMultiple(query, limit = 12) {
  try {
    const raw = execFileSync('yt-dlp', [
      `ytsearch${limit}:${query}`,
      '--flat-playlist',
      '--dump-json',
      '-q', '--no-warnings',
      ...ytDlpCookieArgs()
    ], { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();

    if (!raw) return [];

    return raw.split('\n').filter(Boolean).map(line => {
      let v;
      try { v = JSON.parse(line); } catch (_) { return null; }
      if (!v || !v.id) return null;
      return {
        videoId: v.id,
        title: v.title || 'Sin título',
        artist: v.channel || v.uploader || '',
        duration: v.duration || 0,
        thumbnail: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
      };
    }).filter(Boolean);
  } catch (error) {
    const detail = processErrorMessage(error);
    console.error('Error buscando en YouTube:', detail);
    throw new Error(`No se pudo buscar en YouTube: ${detail}`);
  }
}

/**
 * Obtiene una URL de audio directa (para reproducir un preview) sin
 * descargar el archivo al disco.
 */
function getStreamUrl(videoId) {
  if (!YOUTUBE_ID_RE.test(videoId)) {
    throw new Error('videoId inválido');
  }
  try {
    // Preferimos m4a/AAC en vez del webm/opus que suele ganar como
    // "bestaudio": Safari/iOS no reproduce webm, así que sin esto el
    // preview no suena en iPhone aunque la URL sea válida.
    const result = execFileSync('yt-dlp', [
      '-f', 'bestaudio[ext=m4a]/bestaudio', '--get-url',
      `https://www.youtube.com/watch?v=${videoId}`,
      '-q', '--no-warnings',
      ...ytDlpCookieArgs()
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
 * Descarga audio desde una URL de YouTube y lo convierte a MP3
 */
async function downloadAndConvertToMP3(youtubeUrl, outputPath) {
  try {
    console.log(`📥 Descargando de: ${youtubeUrl}`);

    const tempAudio = path.join(TEMP_DIR, `temp_${Date.now()}.webm`);

    // Descargar con yt-dlp
    execFileSync('yt-dlp', [
      '-f', 'bestaudio', '-o', tempAudio, youtubeUrl, '-q', '--no-warnings',
      ...ytDlpCookieArgs()
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

/**
 * Sube archivo a Cloudflare R2
 */
async function uploadToR2(filePath, fileName, contentType = 'audio/mpeg') {
  try {
    console.log(`☁️  Subiendo a R2: ${fileName}`);

    const fileContent = fs.readFileSync(filePath);
    const fileSize = fileContent.length;

    const now = new Date().toUTCString();
    const authorization = generateR2Authorization('PUT', fileName, now, fileSize);

    const response = await axios.put(
      `${R2_PUBLIC_URL}/${fileName}`,
      fileContent,
      {
        headers: {
          'Authorization': authorization,
          'Date': now,
          'Content-Type': contentType,
          'Content-Length': fileSize
        }
      }
    );
    
    if (response.status >= 200 && response.status < 300) {
      console.log(`✅ Subido a R2: ${R2_PUBLIC_URL}/${fileName}`);
      return `${R2_PUBLIC_URL}/${fileName}`;
    } else {
      throw new Error(`R2 respondió con código ${response.status}`);
    }
  } catch (error) {
    console.error('Error subiendo a R2:', error.message);
    throw new Error(`Fallo al subir a R2: ${error.message}`);
  }
}

/**
 * Genera la cabecera de autorización AWS Signature V4 para R2
 */
function generateR2Authorization(method, key, date, contentLength) {
  const dateString = date.split(', ')[1].split(' ')[0];
  const dateRegions = `${dateString.split(' ')[3]}${dateString.split(' ')[2]}${dateString.split(' ')[1].split(',')[0]}`;
  
  // AWS Signature V4 (simplificado para R2)
  const scope = `${dateRegions}/auto/s3/aws4_request`;
  
  const canonicalRequest = [
    method,
    `/${key}`,
    '',
    `date:${date}`,
    'host:' + R2_PUBLIC_URL.split('://')[1],
    '',
    'date;host',
    '' // Sin payload (sin necesidad de hash)
  ].join('\n');
  
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    date,
    scope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');
  
  const signingKey = crypto
    .createHmac('sha256', `AWS4${R2_SECRET_KEY}`)
    .update(stringToSign)
    .digest('hex');
  
  return `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY}/${scope}, SignedHeaders=date;host, Signature=${signingKey}`;
}

// ────────────────────────────────────────────────────────────────────────────
// RUTAS
// ────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/search?q=...
 *
 * Busca canciones en YouTube (sin descargar) y devuelve una lista de
 * resultados para que el usuario elija cuál quiere escuchar/descargar.
 */
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) {
    return res.status(400).json({ success: false, error: 'Falta el parámetro q' });
  }

  try {
    const results = searchYouTubeMultiple(q, 12);
    return res.json({ success: true, results });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/stream?id=videoId
 *
 * Devuelve una URL de audio directa para reproducir un preview antes
 * de descargar la canción.
 */
app.get('/api/stream', (req, res) => {
  const id = (req.query.id || '').toString().trim();
  if (!id) {
    return res.status(400).json({ success: false, error: 'Falta el parámetro id' });
  }

  try {
    const url = getStreamUrl(id);
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
 *   "videoId": "dQw4w9WgXcQ",
 *   "trackName": "Levitating",
 *   "artistName": "Dua Lipa",
 *   "artworkUrl": "https://...",
 *   "username": "maria"
 * }
 *
 * Body (modo legacy, sin videoId — busca a ciegas por texto):
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
  const { videoId, trackName, artistName, collectionName, artworkUrl, username } = req.body;

  try {
    const user = sanitizeUsername(username);
    if (!user) {
      return res.status(400).json({ success: false, error: 'username es requerido' });
    }

    let youtubeUrl;
    let finalTrackName  = trackName;
    let finalArtistName = artistName;

    if (videoId) {
      if (!YOUTUBE_ID_RE.test(videoId)) {
        return res.status(400).json({ success: false, error: 'videoId inválido' });
      }
      youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
      finalTrackName  = trackName  || 'Sin título';
      finalArtistName = artistName || 'Artista desconocido';
    } else {
      if (!trackName || !artistName) {
        return res.status(400).json({
          success: false,
          error: 'trackName y artistName son requeridos'
        });
      }
      const query = `${trackName} ${artistName} official audio`;
      youtubeUrl = searchYouTube(query);
    }

    console.log(`\n🎵 Nuevo track: ${finalTrackName} - ${finalArtistName} (usuario: ${user})`);

    const trackId = generateTrackId();
    const baseFileName = `${sanitizeForFilename(finalArtistName)} - ${sanitizeForFilename(finalTrackName)}`.trim()
      || `track_${Date.now()}`;
    const mp3Key       = encodeR2Key(`${user}/${baseFileName}.mp3`);
    const coverKey     = encodeR2Key(`${user}/${baseFileName}_cover.jpg`);
    const tempMp3Path  = path.join(TEMP_DIR, `${trackId}.mp3`);

    // 1. Descargar y convertir
    await downloadAndConvertToMP3(youtubeUrl, tempMp3Path);

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
