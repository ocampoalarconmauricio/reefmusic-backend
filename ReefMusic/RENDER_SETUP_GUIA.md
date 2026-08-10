# 🚀 Guía Completa: ReefMusic Backend en Render.com

Esta guía te mostrará cómo desplegar el backend de ReefMusic en Render.com con descargas automáticas de YouTube, conversión a MP3 y almacenamiento en Cloudflare R2.

---

## 📋 Pre-requisitos

Antes de empezar, necesitas tener:

- ✅ Cuenta en [Render.com](https://render.com) (gratuita)
- ✅ Cuenta en [Cloudflare](https://cloudflare.com) (gratuita)
- ✅ Tener creado un bucket en Cloudflare R2
- ✅ Credenciales de R2 (Access Key ID y Secret Key)

---

## 🔧 Paso 1: Obtener Credenciales de Cloudflare R2

### 1.1 Crear un bucket en R2

1. Entra en [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Ve a **R2** en el menú izquierdo
3. Haz clic en **Create bucket**
4. Nombre: `reefmusic` (o el nombre que prefieras)
5. Haz clic en **Create bucket**

### 1.2 Crear API Token para R2

1. En Cloudflare, ve a **R2** → **Settings**
2. Scroll hasta **API Tokens**
3. Haz clic en **Create API Token**
4. Nombre: `ReefMusic Backend`
5. **Permissions**: 
   - Permiso: `Object.* (Read, Write, Delete)`
   - Recurso: `Todos los buckets`
6. Haz clic en **Create Token**
7. **COPIA Y GUARDA**:
   - `Access Key ID`
   - `Secret Access Key`

### 1.3 Obtener Account ID y URL pública

1. En el mismo **Settings**, busca **Account details**
2. Copia tu `Account ID` (algo como: `a1b2c3d4e5f6...`)
3. Tu URL pública será: `https://pub-{ACCOUNT_ID}.r2.dev`

**Ejemplo:**
```
Account ID: a1b2c3d4e5f6
R2_PUBLIC_URL: https://pub-a1b2c3d4e5f6.r2.dev
```

---

## 🛠️ Paso 2: Preparar tu repositorio GitHub

### 2.1 Crear un repositorio en GitHub

1. Ve a [GitHub.com](https://github.com/new)
2. Nombre: `reefmusic-backend`
3. Descripción: "Backend para ReefMusic"
4. **Público** (así Render puede acceder)
5. Haz clic en **Create repository**

### 2.2 Subir los archivos

En tu computadora (o terminal), ejecuta:

```bash
# Clonar el repositorio
git clone https://github.com/tu_usuario/reefmusic-backend.git
cd reefmusic-backend

# Copiar los archivos necesarios:
# - render-backend-server.js
# - package.json
# - Dockerfile
# - .env.example

# Agregar los archivos
git add .
git commit -m "Initial commit: ReefMusic backend setup"
git push origin main
```

---

## 🌐 Paso 3: Desplegar en Render.com

### 3.1 Conectar Render con GitHub

1. Ve a [Render.com](https://render.com) y entra con tu cuenta
2. En el dashboard, haz clic en **New +** → **Web Service**
3. Selecciona **Deploy an existing repository**
4. Busca `reefmusic-backend` y selecciona **Connect**
5. Si es la primera vez, autoriza Render a acceder a tu GitHub

### 3.2 Configurar el servicio

**Básico:**
- **Name**: `reefmusic-backend`
- **Environment**: Selecciona **Docker** (porque tenemos Dockerfile)
- **Branch**: `main`
- **Dockerfile path**: `./Dockerfile`

**Plan:**
- Selecciona el plan **Free** (o superior si lo necesitas)

### 3.3 Agregar variables de entorno

Antes de hacer deploy, necesitas agregar las variables de entorno:

1. En Render, ve a **Environment** (pestaña)
2. Agrega estas variables:

```
NODE_ENV=production
PORT=3000
RENDER_BACKEND_URL=https://reefmusic-backend.onrender.com

R2_ACCOUNT_ID=tu_account_id
R2_ACCESS_KEY=tu_access_key_id
R2_SECRET_KEY=tu_secret_access_key
R2_BUCKET_NAME=reefmusic
R2_PUBLIC_URL=https://pub-tu_account_id.r2.dev
```

**⚠️ Reemplaza con tus valores reales de Cloudflare R2**

### 3.4 Iniciar el Deploy

1. Haz clic en **Deploy**
2. Espera a que termine la construcción (5-10 minutos)
3. Verás un mensaje **Your service is live** cuando esté listo

**Tu URL será algo como:** `https://reefmusic-backend.onrender.com`

---

## ✅ Paso 4: Verificar que todo funciona

### 4.1 Probar el servidor

En tu navegador, entra a:

```
https://tu-render-url.onrender.com/api/health
```

Deberías ver algo como:
```json
{
  "status": "ok",
  "backend": "ReefMusic Render",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### 4.2 Probar descarga de canción

Usa Postman o curl para probar:

```bash
curl -X POST https://tu-render-url.onrender.com/api/download-and-upload \
  -H "Content-Type: application/json" \
  -d '{
    "trackName": "Levitating",
    "artistName": "Dua Lipa",
    "collectionName": "Future Nostalgia",
    "artworkUrl": "https://..."
  }'
```

**Respuesta esperada:**
```json
{
  "success": true,
  "trackId": "track_1234567890_abc123",
  "url": "https://pub-xxx.r2.dev/track_1234567890_abc123.mp3",
  "track": {
    "trackName": "Levitating",
    "artistName": "Dua Lipa",
    "collectionName": "Future Nostalgia"
  }
}
```

---

## 📱 Paso 5: Conectar ReefMusic App con tu Backend

### 5.1 Actualizar el HTML

En tu archivo HTML de ReefMusic (`ReefMusic_updated.html`), añade esta configuración al inicio del `<script>`:

```javascript
// Configuración del Backend
const REEF_BACKEND_URL = 'https://tu-render-url.onrender.com';

// Función para descargar canción desde iTunes
async function downloadTrackToR2(track) {
  try {
    const loadingEl = document.getElementById('download-status');
    if (loadingEl) {
      loadingEl.textContent = 'Descargando...';
    }
    
    const response = await fetch(`${REEF_BACKEND_URL}/api/download-and-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        trackName: track.trackName,
        artistName: track.artistName,
        collectionName: track.collectionName || 'Sin álbum',
        artworkUrl: track.artworkUrl100 || null
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // Agregar a biblioteca local
      addToLibrary({
        key: data.trackId,
        title: track.trackName,
        artist: track.artistName,
        album: track.collectionName,
        url: data.url,
        artwork: track.artworkUrl100,
        addedAt: Date.now()
      });
      
      if (loadingEl) {
        loadingEl.textContent = '✅ ¡Descargado!';
      }
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    console.error('Error descargando:', error);
    alert('Error: ' + error.message);
  }
}
```

### 5.2 Modificar el botón "Agregar" en iTunes

En la función que renderiza los resultados de iTunes, cambia el botón de "Usar" a una llamada a tu backend:

```javascript
// En lugar de:
// useBtn.addEventListener('click', () => itunesApplyResult(track));

// Usa:
useBtn.addEventListener('click', async () => {
  useBtn.disabled = true;
  useBtn.textContent = 'Descargando...';
  await downloadTrackToR2(track);
  useBtn.disabled = false;
  useBtn.textContent = 'Descargar';
});
```

---

## 🎵 Flujo Completo de Uso

```
Usuario busca "Levitating" en ReefMusic
         ↓
iTunes devuelve resultados
         ↓
Usuario toca "Descargar"
         ↓
App envía a Render Backend:
  - Título: "Levitating"
  - Artista: "Dua Lipa"
         ↓
Backend:
  1. Busca en YouTube
  2. Descarga con yt-dlp
  3. Convierte a MP3 con ffmpeg
  4. Sube a Cloudflare R2
         ↓
Backend retorna URL de R2
         ↓
App guarda en biblioteca local
         ↓
Usuario puede reproducir MP3 desde R2
```

---

## 🔧 Troubleshooting

### Error: "yt-dlp no está instalado"

**Solución:** El Dockerfile debe instalar `yt-dlp`. Verifica que tu Dockerfile incluya:
```dockerfile
RUN pip install --no-cache-dir yt-dlp
```

### Error: "No se puede conectar con R2"

1. Verifica que tus credenciales de R2 sean correctas
2. Verifica que tu Account ID sea correcto
3. En Render, ve a **Logs** para ver el error específico

### Error: "No encontré canciones para X"

1. Verifica que YouTube tiene la canción
2. Prueba con un término de búsqueda más específico
3. Revisa los logs en Render

### El servidor se queda sin memoria

- En Render, sube a un plan superior
- O implementa limpieza de archivos temporales más agresiva

---

## 📊 Monitoreo

### Ver logs en Render

1. En tu servicio en Render, ve a la pestaña **Logs**
2. Verás en tiempo real qué está pasando

### Monitorear uso de R2

1. En Cloudflare, ve a **R2** → **Bucket**
2. Verás estadísticas de uso y almacenamiento

---

## 💰 Costos

- **Render.com**: Gratuito hasta cierto uso
- **Cloudflare R2**: Primeros 10GB gratuitos al mes
- **Total**: ~Gratis para un uso moderado

---

## ✨ ¡Listo!

Tu ReefMusic Backend está activo y listo para descargar canciones desde iTunes, procesarlas y almacenarlas en R2.

**Próximos pasos:**
1. Prueba con varias canciones
2. Integra en tu app móvil
3. Ajusta parámetros según sea necesario

¿Preguntas? Revisa los logs en Render o contacta al soporte.

---

**Happy Music! 🎵**
