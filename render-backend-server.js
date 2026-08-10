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
const { execSync } = require('child_process');
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

// ────────────────────────────────────────────────────────────────────────────
// UTILIDADES
// ────────────────────────────────────────────────────────────────────────────

/**
 * Genera un ID único para la canción
 */
function generateTrackId() {
  return `track_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Busca en YouTube la canción usando yt-dlp
 */
function searchYouTube(query) {
  try {
    const cmd = `yt-dlp -f bestaudio --get-url "ytsearch:${query}" -q --no-warnings`;
    const result = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
    
    if (!result) {
      throw new Error('No se encontró video en YouTube');
    }
    
    return result.split('\n')[0]; // Retorna la primera URL
  } catch (error) {
    console.error('Error buscando en YouTube:', error.message);
    throw new Error('No se pudo encontrar la canción en YouTube');
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
    const downloadCmd = `yt-dlp -f bestaudio -o "${tempAudio}" "${youtubeUrl}" -q --no-warnings`;
    execSync(downloadCmd, { maxBuffer: 50 * 1024 * 1024 });
    
    if (!fs.existsSync(tempAudio)) {
      throw new Error('La descarga falló');
    }
    
    console.log(`🔄 Convirtiendo a MP3...`);
    
    // Convertir a MP3 con ffmpeg
    const ffmpegCmd = `ffmpeg -i "${tempAudio}" -q:a 0 -map a "${outputPath}" -y -loglevel error`;
    execSync(ffmpegCmd);
    
    // Eliminar archivo temporal
    fs.unlinkSync(tempAudio);
    
    if (!fs.existsSync(outputPath)) {
      throw new Error('La conversión a MP3 falló');
    }
    
    console.log(`✅ MP3 listo: ${outputPath}`);
    return true;
  } catch (error) {
    console.error('Error en descarga/conversión:', error.message);
    throw new Error(`Fallo en descarga: ${error.message}`);
  }
}

/**
 * Sube archivo a Cloudflare R2
 */
async function uploadToR2(filePath, fileName) {
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
          'Content-Type': 'audio/mpeg',
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
 * POST /api/download-and-upload
 * 
 * Body:
 * {
 *   "trackName": "Levitating",
 *   "artistName": "Dua Lipa",
 *   "collectionName": "Future Nostalgia",
 *   "artworkUrl": "https://..."
 * }
 */
app.post('/api/download-and-upload', async (req, res) => {
  const { trackName, artistName, collectionName, artworkUrl } = req.body;
  
  try {
    // Validar datos
    if (!trackName || !artistName) {
      return res.status(400).json({
        success: false,
        error: 'trackName y artistName son requeridos'
      });
    }
    
    console.log(`\n🎵 Nuevo track: ${trackName} - ${artistName}`);
    
    const trackId = generateTrackId();
    const fileName = `${trackId}.mp3`;
    const tempMp3Path = path.join(TEMP_DIR, fileName);
    
    // 1. Buscar en YouTube
    const query = `${trackName} ${artistName} official audio`;
    const youtubeUrl = searchYouTube(query);
    
    // 2. Descargar y convertir
    await downloadAndConvertToMP3(youtubeUrl, tempMp3Path);
    
    // 3. Subir a R2
    const r2Url = await uploadToR2(tempMp3Path, fileName);
    
    // 4. Limpiar temporal
    fs.unlinkSync(tempMp3Path);
    
    // 5. Retornar metadata
    const response = {
      success: true,
      trackId,
      url: r2Url,
      track: {
        trackName: trackName || 'Desconocido',
        artistName: artistName || 'Artista desconocido',
        collectionName: collectionName || 'Álbum desconocido',
        artworkUrl: artworkUrl || null,
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
    const result = execSync('yt-dlp --version', { encoding: 'utf-8' });
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
