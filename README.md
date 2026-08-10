# 🎵 ReefMusic - Backend & Descarga Automática

**Sistema completo para descargar música desde iTunes, procesarla y almacenarla en Cloudflare R2**

---

## 📊 Arquitectura del Sistema

```
REEFMUSIC APP (iOS/Web)
        ↓ (Usuario busca canción)
    ITUNES API
        ↓ (Resultados + Preview 30seg)
    RENDER BACKEND ⭐
        ├─ Busca en YouTube (yt-dlp)
        ├─ Descarga audio (webm)
        ├─ Convierte a MP3 (ffmpeg)
        └─ Sube a R2 (Cloudflare)
        ↓ (URL de R2 + metadatos)
CLOUDFLARE R2 (Almacenamiento)
        ↓ (URL para reproducir)
    REEFMUSIC APP (Biblioteca Local)
        ↓ (Streaming sin DRM)
    USUARIO REPRODUCE 🎵
```

---

## 📁 Archivos Principales

```
├── render-backend-server.js       ← 🔥 Servidor Node.js (lo importante)
├── package.json                   ← Dependencias
├── Dockerfile                     ← Para Render.com
├── .env.example                   ← Variables de entorno
├── reef-render-integration.js     ← 🔗 Código para tu app
├── ReefMusic_updated.html         ← Tu app con "Buscar"
├── RENDER_SETUP_GUIA.md          ← Paso a paso completo ⭐
└── README.md                      ← Este archivo
```

---

## 🚀 EMPEZAR (Resumen)

### 1. Cloudflare R2 - Obtener credenciales
- Ve a Cloudflare Dashboard → R2
- Crea bucket `reefmusic`
- Crea API Token (copia Access Key + Secret Key)
- Anota tu Account ID

### 2. GitHub - Subir código
```bash
git clone tu_repo_aqui
# Copia los archivos
git add .
git commit -m "Initial"
git push
```

### 3. Render.com - Desplegar
- Nueva Web Service → Docker
- Conecta tu GitHub
- Agrega variables de entorno (R2 credentials)
- Deploy ✅

### 4. Tu App - Integrar
```html
<script src="reef-render-integration.js"></script>
```

```javascript
// Cuando usuario toca "Descargar"
await window.reefRender.process(itunesTrack);
```

**[Ver guía paso a paso →](./RENDER_SETUP_GUIA.md)**

---

## 🔑 Variables de Entorno Necesarias

```
R2_ACCOUNT_ID=tu_id_aqui
R2_ACCESS_KEY=tu_access_key
R2_SECRET_KEY=tu_secret_key
R2_BUCKET_NAME=reefmusic
R2_PUBLIC_URL=https://pub-tu_id.r2.dev
RENDER_BACKEND_URL=https://tu-app.onrender.com
```

---

## 🎯 Flujo Completo

1. **Usuario busca en iTunes** → "Levitating"
2. **Resultados de iTunes** → 10 canciones con preview
3. **Usuario toca "Descargar"** → Se envía al backend
4. **Backend de Render**:
   - Busca en YouTube
   - Descarga con yt-dlp
   - Convierte a MP3 con ffmpeg
   - Sube a Cloudflare R2
5. **App recibe URL de R2**
6. **Guarda en biblioteca local**
7. **Usuario reproduce** desde R2 ✅

---

## 📞 Endpoints de API

### POST /api/download-and-upload
```json
{
  "trackName": "Levitating",
  "artistName": "Dua Lipa",
  "collectionName": "Future Nostalgia",
  "artworkUrl": "https://..."
}
```

**Retorna:**
```json
{
  "success": true,
  "trackId": "track_123456",
  "url": "https://pub-xxx.r2.dev/track_123456.mp3"
}
```

### GET /api/health
Verifica que el servidor está funcionando.

---

## 💾 Stack Tecnológico

- **Backend**: Node.js 18 + Express
- **Descarga**: yt-dlp (Python)
- **Audio**: ffmpeg
- **Almacenamiento**: Cloudflare R2
- **Hosting**: Render.com (Docker)
- **Frontend**: HTML5 + JavaScript

---

## 💰 Costos

- **Render Free**: Gratis (con limitaciones)
- **Cloudflare R2**: 10GB gratis/mes
- **Total**: ~**GRATIS** para uso normal

---

## ⚠️ Notas Importantes

### Cloudflare R2
✅ Necesitas cuenta (gratuita)  
✅ Crea bucket para almacenar MP3s  
✅ Genera API Token con permisos R2  
✅ URL pública es: `https://pub-{ACCOUNT_ID}.r2.dev`

### Render.com
✅ Plan Free funciona bien  
⚠️ Se apaga después de 15 min sin uso (reinicia automático)  
✅ Instala yt-dlp y ffmpeg via Dockerfile

### YouTube/yt-dlp
✅ La mayoría de canciones están disponibles  
⚠️ A veces falla si yt-dlp no está actualizado  
✅ Retorna la mejor calidad de audio disponible

---

## 🔧 Troubleshooting Rápido

| Problema | Solución |
|----------|----------|
| "yt-dlp no instalado" | Dockerfile debe instalar Python + pip |
| "R2 credentials inválidas" | Verifica en Render → Environment variables |
| "No encontré canción" | YouTube no tiene esa canción exacta |
| "Servidor lento" | Upgrade plan Render o espera |

**[Troubleshooting completo →](./RENDER_SETUP_GUIA.md#-troubleshooting)**

---

## 📖 Documentación Completa

| Archivo | Contenido |
|---------|----------|
| **[RENDER_SETUP_GUIA.md](./RENDER_SETUP_GUIA.md)** | ⭐ Todo paso a paso (LEER PRIMERO) |
| **[render-backend-server.js](./render-backend-server.js)** | Código del servidor |
| **[reef-render-integration.js](./reef-render-integration.js)** | JavaScript para integrar en app |
| **[ReefMusic_updated.html](./ReefMusic_updated.html)** | App con pestaña "Buscar" |

---

## 🎵 ¿Cómo funciona?

1. **Búsqueda**: iTunes API busca canciones
2. **Preview**: Apple proporciona 30 segundos de preview
3. **Descarga**: Si al usuario le gusta, presiona "Descargar"
4. **Procesamiento**: Render backend lo maneja todo:
   - YouTube Search
   - yt-dlp Descarga
   - ffmpeg Conversion
   - R2 Upload
5. **Reproducción**: URL de R2 en la app
6. **Offline**: Puede reproducir sin conexión si la tiene almacenada localmente

---

## ✅ Checklist de Implementación

- [ ] Crear cuenta Cloudflare + R2 bucket
- [ ] Generar R2 API Token y anotar credenciales
- [ ] Crear repositorio GitHub
- [ ] Copiar archivos del backend
- [ ] Crear .env con R2 credentials
- [ ] Subir a GitHub
- [ ] Crear servicio en Render.com
- [ ] Desplegar (Docker build)
- [ ] Probar endpoint /api/health
- [ ] Integrar JavaScript en app
- [ ] Probar descarga completa
- [ ] 🎉 ¡Usar!

---

## 🎯 Próximos Pasos

1. **Lee** [RENDER_SETUP_GUIA.md](./RENDER_SETUP_GUIA.md)
2. **Configura** Cloudflare R2
3. **Sube** código a GitHub
4. **Despliega** en Render
5. **Integra** JavaScript
6. **Prueba** con canciones
7. **¡Disfruta!** 🎵

---

## 📞 Ayuda

- Ver logs en Render: Dashboard → Logs
- Ver analytics R2: Cloudflare → R2 → Analytics
- Consola del navegador: F12 → Console

---

**ReefMusic Backend - Descarga inteligente de música** 🎵

Creado para que disfrutes tu música sin restricciones.
