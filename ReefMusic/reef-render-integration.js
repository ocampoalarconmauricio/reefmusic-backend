/**
 * ReefMusic - Integración con Render Backend
 * 
 * Este archivo contiene las funciones necesarias para:
 * 1. Buscar canciones en iTunes
 * 2. Enviar al backend de Render
 * 3. Descargar, procesar y subir a R2
 * 4. Guardar en la biblioteca local
 */

// ────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN
// ────────────────────────────────────────────────────────────────────────

const REEF_CONFIG = {
  // Reemplaza con tu URL de Render backend
  backendUrl: 'https://tu-render-backend.onrender.com',
  
  // Endpoints disponibles
  endpoints: {
    health: '/api/health',
    downloadAndUpload: '/api/download-and-upload',
    testYoutube: '/api/test-youtube'
  },
  
  // Timeouts
  timeouts: {
    download: 300000, // 5 minutos
    search: 10000      // 10 segundos
  }
};

// ────────────────────────────────────────────────────────────────────────
// ESTADO GLOBAL
// ────────────────────────────────────────────────────────────────────────

const reefRenderState = {
  isProcessing: false,
  currentTrack: null,
  downloadProgress: 0,
  backendHealthy: false
};

// ────────────────────────────────────────────────────────────────────────
// UTILIDADES
// ────────────────────────────────────────────────────────────────────────

/**
 * Muestra un toast/notificación al usuario
 */
function showNotification(message, type = 'info') {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: ${type === 'error' ? '#ff4444' : type === 'success' ? '#44ff44' : '#4488ff'};
    color: white;
    padding: 16px 24px;
    border-radius: 10px;
    font-size: 14px;
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
    font-weight: 600;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-in';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/**
 * Verifica si el backend está disponible
 */
async function checkBackendHealth() {
  try {
    const response = await fetch(
      `${REEF_CONFIG.backendUrl}${REEF_CONFIG.endpoints.health}`,
      { timeout: REEF_CONFIG.timeouts.search }
    );
    
    if (response.ok) {
      const data = await response.json();
      reefRenderState.backendHealthy = true;
      console.log('✅ Backend de Render conectado:', data);
      return true;
    }
  } catch (error) {
    console.error('❌ Backend no disponible:', error);
    reefRenderState.backendHealthy = false;
    return false;
  }
}

/**
 * Descarga una canción desde iTunes al backend de Render
 */
async function downloadTrackToRender(itunesTrack) {
  // Validar track
  if (!itunesTrack || !itunesTrack.trackName || !itunesTrack.artistName) {
    showNotification('Datos de canción incompletos', 'error');
    return null;
  }
  
  // Validar que backend esté disponible
  const isHealthy = await checkBackendHealth();
  if (!isHealthy) {
    showNotification('No se puede conectar con el servidor de descargas', 'error');
    return null;
  }
  
  // Ya está procesando
  if (reefRenderState.isProcessing) {
    showNotification('Ya hay una descarga en proceso', 'info');
    return null;
  }
  
  reefRenderState.isProcessing = true;
  reefRenderState.currentTrack = itunesTrack;
  
  try {
    showNotification(`📥 Descargando: ${itunesTrack.trackName}...`, 'info');
    
    // Preparar payload
    const payload = {
      trackName: itunesTrack.trackName,
      artistName: itunesTrack.artistName,
      collectionName: itunesTrack.collectionName || 'Desconocido',
      artworkUrl: itunesTrack.artworkUrl100 || null
    };
    
    console.log('📤 Enviando a Render:', payload);
    
    // Hacer request al backend
    const response = await fetch(
      `${REEF_CONFIG.backendUrl}${REEF_CONFIG.endpoints.downloadAndUpload}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        timeout: REEF_CONFIG.timeouts.download
      }
    );
    
    const result = await response.json();
    
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Error en el servidor');
    }
    
    console.log('✅ Canción descargada:', result);
    showNotification(`✅ ${itunesTrack.trackName} descargado!`, 'success');
    
    // Retornar datos procesados
    return {
      trackId: result.trackId,
      url: result.url,
      track: {
        title: itunesTrack.trackName,
        artist: itunesTrack.artistName,
        album: itunesTrack.collectionName,
        artwork: itunesTrack.artworkUrl100,
        downloadUrl: result.url,
        downloadedAt: new Date().toISOString()
      }
    };
    
  } catch (error) {
    console.error('❌ Error descargando:', error);
    showNotification(`Error: ${error.message}`, 'error');
    return null;
  } finally {
    reefRenderState.isProcessing = false;
  }
}

/**
 * Agregar canción descargada a la biblioteca local
 */
async function addDownloadedTrackToLibrary(processedTrack) {
  if (!processedTrack) return false;
  
  try {
    // Aquí integras con tu sistema local de biblioteca
    // Ejemplo (adapta según tu estructura):
    
    const trackData = {
      key: processedTrack.trackId,
      title: processedTrack.track.title,
      artist: processedTrack.track.artist,
      album: processedTrack.track.album,
      artwork: processedTrack.track.artwork,
      url: processedTrack.track.downloadUrl,
      source: 'render', // Identificar que viene de Render
      addedAt: Date.now(),
      isDownloaded: true
    };
    
    // Si tienes IndexedDB o localStorage para guardar localmente:
    if (typeof addToLibrary === 'function') {
      addToLibrary(trackData);
    } else {
      console.warn('Función addToLibrary no encontrada');
    }
    
    console.log('✅ Agregado a biblioteca:', trackData);
    return true;
    
  } catch (error) {
    console.error('Error agregando a biblioteca:', error);
    return false;
  }
}

/**
 * Flujo completo: Buscar iTunes → Descargar → Guardar
 */
async function processItunesTrackComplete(itunesTrack) {
  try {
    // Paso 1: Descargar con Render
    const processed = await downloadTrackToRender(itunesTrack);
    if (!processed) return false;
    
    // Paso 2: Agregar a biblioteca local
    const added = await addDownloadedTrackToLibrary(processed);
    if (!added) return false;
    
    console.log('🎵 Track completamente procesado:', processed);
    return true;
    
  } catch (error) {
    console.error('Error en flujo completo:', error);
    showNotification('Error procesando canción', 'error');
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────
// INICIALIZACIÓN
// ────────────────────────────────────────────────────────────────────────

/**
 * Inicializar integración con Render (llamar al cargar la página)
 */
async function initReefRenderIntegration() {
  console.log('🚀 Iniciando integración Render...');
  
  // Verificar backend al cargar
  setTimeout(() => {
    checkBackendHealth();
  }, 2000);
  
  // Re-verificar cada 30 segundos
  setInterval(() => {
    checkBackendHealth();
  }, 30000);
  
  console.log('✅ Integración Render lista');
}

// Inicializar cuando documento esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initReefRenderIntegration);
} else {
  initReefRenderIntegration();
}

// ────────────────────────────────────────────────────────────────────────
// EXPORTAR PARA USO EN HTML
// ────────────────────────────────────────────────────────────────────────

// Hacer disponibles globalmente
window.reefRender = {
  downloadTrack: downloadTrackToRender,
  addToLibrary: addDownloadedTrackToLibrary,
  process: processItunesTrackComplete,
  checkHealth: checkBackendHealth,
  config: REEF_CONFIG,
  state: reefRenderState
};
