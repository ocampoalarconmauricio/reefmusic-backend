# ⚡ Integración Rápida - ReefMusic + Render Backend

Cómo integrar el backend de Render en tu app de 5 minutos.

---

## 📝 Paso 1: Editar el HTML

En tu `ReefMusic_updated.html`, busca la sección de scripts al final (antes del `</body>`).

Agrega esto **ANTES** del último `</script>`:

```html
<!-- Integración con Render Backend para descargas -->
<script src="reef-render-integration.js"></script>
<script>
  // Configuración específica de tu backend
  window.REEF_CONFIG.backendUrl = 'https://tu-render-url.onrender.com';
</script>
```

**Ejemplo completo:**
```html
<!-- ... otros scripts ... -->
<script>
  // Tu código JS existente aquí
</script>

<!-- ⭐ AGREGAR ESTO ⭐ -->
<script src="reef-render-integration.js"></script>
<script>
  window.REEF_CONFIG.backendUrl = 'https://reefmusic-backend.onrender.com';
</script>

</body>
</html>
```

---

## 🎯 Paso 2: Modificar Botón de iTunes

Busca en tu HTML dónde se renderiza el botón "Usar" en los resultados de iTunes.

### Ubicación actual (línea ~8684)

En la función `itunesSearchAdd()`:

```javascript
useBtn.addEventListener('click', e => {
  e.stopPropagation();
  itunesApplyResult(track);  // ← ESTO ES LO QUE CAMBIAS
});
```

### Reemplazar con:

```javascript
useBtn.addEventListener('click', async e => {
  e.stopPropagation();
  
  // Cambiar texto del botón mientras se procesa
  const originalText = useBtn.textContent;
  useBtn.disabled = true;
  useBtn.textContent = 'Descargando...';
  
  try {
    // Usar backend de Render
    const success = await window.reefRender.process(track);
    
    if (success) {
      // Limpiar resultados de búsqueda
      document.getElementById('itunes-add-search-input').value = '';
      const results = document.getElementById('itunes-add-results');
      if (results) {
        results.classList.remove('open');
        results.innerHTML = '';
      }
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Restaurar botón
    useBtn.disabled = false;
    useBtn.textContent = originalText;
  }
});
```

---

## 🔍 Paso 3: Verificar Librería Local

Asegúrate de que exista la función `addToLibrary()` en tu app (debe estar en tu código JS):

```javascript
// Si NO existe, agrega esta versión mínima:
function addToLibrary(trackData) {
  // Aquí iría la lógica para guardar en tu base de datos local
  console.log('Agregado a biblioteca:', trackData);
  
  // Ejemplo con IndexedDB:
  if ('indexedDB' in window) {
    const request = indexedDB.open('reefmusic', 1);
    request.onerror = () => console.error('IndexedDB error');
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('tracks')) {
        db.createObjectStore('tracks', { keyPath: 'key' });
      }
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('tracks', 'readwrite');
      tx.objectStore('tracks').add(trackData);
    };
  }
}
```

---

## ✨ Paso 4: Personalizar Mensajes

Opcionalmente, puedes personalizar los mensajes que ve el usuario.

Edita estos textos en `reef-render-integration.js`:

```javascript
// Línea ~55-60
showNotification(`📥 Descargando: ${itunesTrack.trackName}...`, 'info');

// Línea ~100
showNotification(`✅ ${itunesTrack.trackName} descargado!`, 'success');

// Cambia los emojis y textos según prefieras
// Ejemplos:
showNotification('⏳ Procesando...', 'info');
showNotification('🎉 ¡Listo!', 'success');
showNotification('❌ Error', 'error');
```

---

## 🧪 Paso 5: Probar Localmente

### En tu navegador:

1. Abre la consola del navegador (F12)
2. Escribe:
```javascript
// Verificar que Render está disponible
window.reefRender.checkHealth();
```

3. Deberías ver en la consola:
```
✅ Backend de Render conectado: {status: 'ok', backend: 'ReefMusic Render', ...}
```

4. Intenta descarga:
```javascript
// Test con track dummy
await window.reefRender.process({
  trackName: 'Levitating',
  artistName: 'Dua Lipa',
  collectionName: 'Future Nostalgia',
  artworkUrl100: 'https://...'
});
```

---

## 📋 Checklist de Integración

- [ ] Agregué `reef-render-integration.js` al HTML
- [ ] Configuré la URL de Render backend
- [ ] Modifiqué el click handler del botón "Usar"
- [ ] Verificé que `addToLibrary()` existe
- [ ] Probé `/api/health` en consola
- [ ] Hice una descarga de prueba
- [ ] ¿Funciona? ✅

---

## 🐛 Si algo falla...

### Error: "undefined is not a function addToLibrary"
**Solución**: Agrega la función (ver Paso 3)

### Error: "Cannot connect to backend"
**Solución**: 
1. Verifica que tu Render URL es correcta
2. Verifica que el backend está corriendo en Render
3. Abre Render Dashboard → Logs

### Error: "No encontré canción en YouTube"
**Solución**: Intenta con otro término de búsqueda o canción diferente

### El botón no responde
**Solución**: Abre consola (F12) y busca errores de JavaScript

---

## 📦 Archivo Necesarios

Para que funcione, necesitas en tu carpeta:

```
mi_app/
├── ReefMusic_updated.html
├── reef-render-integration.js  ← 🔑 IMPORTANTE
└── ... otros archivos
```

El archivo `reef-render-integration.js` debe estar en la misma carpeta que el HTML o en una carpeta accesible.

---

## 🎨 Personalización de Estilos

Si quieres cambiar cómo se ven los mensajes de notificación, edita en `reef-render-integration.js`:

```javascript
// Busca la función `showNotification` (~línea 35)

toast.style.cssText = `
  position: fixed;
  bottom: 20px;           /* Cambia la posición */
  right: 20px;
  background: #4488ff;    /* Color: azul por defecto */
  color: white;
  padding: 16px 24px;
  border-radius: 10px;
  font-size: 14px;
  z-index: 10000;
  font-weight: 600;
`;
```

**Ejemplos de colores:**
- `#ff4444` = Rojo (error)
- `#44ff44` = Verde (éxito)
- `#4488ff` = Azul (info)
- `#ffaa44` = Naranja (warning)

---

## 🚀 Verificar que Todo Funciona

### 1. Verifica el backend
```
https://tu-render-url.onrender.com/api/health
```

Debería retornar JSON con status: "ok"

### 2. Abre la app
Entra en tu ReefMusic app

### 3. Busca una canción en iTunes
Escribe algo como "The Weeknd Blinding Lights"

### 4. Toca "Descargar"
Deberías ver mensajes:
- 📥 Descargando...
- (procesando - puede tardar 30-60 seg)
- ✅ ¡Descargado!

### 5. Revisa tu biblioteca
La canción debería aparecer en "Mis descargas"

---

## 💡 Consejos

- Los primeros descargas tardan más (compilación de Docker)
- Render se apaga después de 15 min sin uso
- Las canciones más buscadas se descargan más rápido
- Prueba con canciones "oficiales" (official audio)

---

## 📞 Soporte Rápido

| Problema | Qué revisar |
|----------|-----------|
| Descarga lenta | Logs de Render (normal si es nueva instancia) |
| Canción no encontrada | yt-dlp puede necesitar actualización |
| Credentials error | Verifica variables en Render |
| App no responde | Consola del navegador (F12) |

---

## ✅ ¡Listo!

Si llegaste aquí y todo funciona:

1. 🎉 ¡Felicidades!
2. 🔗 Comparte el código con otros
3. 💬 Reporta bugs o mejoras
4. 🎵 ¡A disfrutar la música!

---

**Necesitas más ayuda? Lee [RENDER_SETUP_GUIA.md](./RENDER_SETUP_GUIA.md)**
