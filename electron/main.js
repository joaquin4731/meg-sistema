const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const os = require('os');

// Puerto para el servidor Express local
const EXPRESS_PORT = 3001;

let mainWindow;
let expressServer;
let db;

// Ruta de la base de datos local (en la carpeta de datos del usuario)
const userDataPath = app.getPath('userData');
const localDbPath = path.join(userDataPath, 'data.db');

console.log('User data path:', userDataPath);
console.log('Local DB path:', localDbPath);

// ✅ FIX: Sanitizar solo caracteres NULL problemáticos, NO sanitizar base64
function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  // Solo eliminar caracteres NULL (0x00) que causan problemas en SQLite
  // MANTENER saltos de línea, tabs, etc. que son válidos en JSON
  return str.replace(/\x00/g, '');
}

// Lista de claves que contienen datos base64 y NO deben sanitizarse
const BASE64_KEYS = ['dataUrl', 'data', 'pdf', 'base64', 'image', 'file', 'attachment'];

// Función para sanitizar recursivamente todos los strings en un objeto
// EXCEPTO campos base64 (PDFs, imágenes, etc.)
function sanitizeObject(obj, parentKey = '') {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    // NO sanitizar si es un campo base64
    if (BASE64_KEYS.some(key => parentKey.toLowerCase().includes(key.toLowerCase()))) {
      return obj; // Retornar sin sanitizar
    }
    // NO sanitizar si parece un data URL (data:image/... o data:application/pdf...)
    if (obj.startsWith('data:')) {
      return obj; // Retornar sin sanitizar
    }
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map((item, idx) => sanitizeObject(item, `${parentKey}[${idx}]`));
  }

  if (typeof obj === 'object') {
    const sanitized = {};
    for (const key in obj) {
      sanitized[key] = sanitizeObject(obj[key], key);
    }
    return sanitized;
  }

  return obj;
}

/**
 * Generar UID simple (compatibilidad con frontend)
 */
function generateUID() {
  return Math.random().toString(36).substring(2, 9);
}

/**
 * Obtener campo de ID según tipo de array
 */
function getIdField(arrayType) {
  switch (arrayType) {
    case 'cotizaciones':
      return 'numero'; // ✅ Cotizaciones usan 'numero' como ID
    case 'clientes':
      return 'rut';
    case 'ordenesCompra':
      return 'numero';
    case 'ordenesTrabajo':
      return 'numero';
    default:
      return 'id';
  }
}

/**
 * Comparar si newItem es más reciente que existingItem
 */
function isNewer(newItem, existingItem) {
  const newDate = new Date(newItem.updatedAt || newItem.fecha || 0);
  const existingDate = new Date(existingItem.updatedAt || existingItem.fecha || 0);

  if (!isNaN(newDate.getTime()) && !isNaN(existingDate.getTime())) {
    return newDate >= existingDate;
  }

  return true; // Si no hay fechas, asumir que el nuevo es más reciente
}

/**
 * Migrar facturaVenta (objeto antiguo) a facturasVenta (array nuevo)
 * ✅ FIX: Actualiza updatedAt para que el merge detecte el cambio
 */
function migrateFacturasVenta(item) {
  let wasMigrated = false;

  // Si ya tiene facturasVenta (array), asegurarse de que tenga IDs
  if (Array.isArray(item.facturasVenta)) {
    item.facturasVenta = item.facturasVenta.map(f => ({
      ...f,
      id: f.id || generateUID(),
      monto: Number(f.monto || 0)
    }));
    delete item.facturaVenta; // Eliminar campo antiguo si existe
    // No marcar como migrado si ya tenía facturasVenta
  } else if (item.facturaVenta && typeof item.facturaVenta === 'object') {
    // Si tiene facturaVenta (objeto antiguo), convertir a array
    const { codigo, rut, monto } = item.facturaVenta;

    // Solo crear factura si tiene algún dato
    if (codigo || rut || monto) {
      item.facturasVenta = [{
        id: generateUID(),
        codigo: codigo || '',
        rut: rut || '',
        monto: Number(monto || 0)
      }];
    } else {
      item.facturasVenta = [];
    }

    delete item.facturaVenta; // Eliminar campo antiguo
    wasMigrated = true; // Se hizo migración
  } else {
    // No tiene ninguno, crear array vacío
    item.facturasVenta = [];
  }

  // ✅ Actualizar timestamp si se hizo migración
  if (wasMigrated) {
    item.updatedAt = new Date().toISOString();
    console.log(`[MIGRATION] Factura migrada, updatedAt actualizado: ${item.numero || item.id}`);
  }

  return item;
}

/**
 * Calcular tiempo hasta las 2:00 AM del siguiente día
 */
function getTimeUntil2AM() {
  const now = new Date();
  const next2AM = new Date();

  next2AM.setHours(2, 0, 0, 0);

  // Si ya pasaron las 2:00 AM hoy, programar para mañana
  if (now >= next2AM) {
    next2AM.setDate(next2AM.getDate() + 1);
  }

  return next2AM.getTime() - now.getTime();
}

/**
 * Programar backup automático recursivamente
 */
function scheduleNextBackup() {
  const timeUntil2AM = getTimeUntil2AM();
  const hours = Math.floor(timeUntil2AM / (1000 * 60 * 60));
  const minutes = Math.floor((timeUntil2AM % (1000 * 60 * 60)) / (1000 * 60));

  console.log(`[AUTO-BACKUP] 📅 Próximo backup programado en ${hours}h ${minutes}m`);

  setTimeout(() => {
    performAutoBackup();
    // Programar el siguiente backup
    scheduleNextBackup();
  }, timeUntil2AM);
}

/**
 * Backup Automático Diario
 * Guarda un backup completo en formato JSON en la carpeta de documentos del usuario
 * Mantiene los últimos 30 backups (1 mes)
 */
function performAutoBackup() {
  if (!db) {
    console.log('[AUTO-BACKUP] ⚠️ Base de datos no inicializada');
    return;
  }

  console.log('[AUTO-BACKUP] 💾 Iniciando backup automático...');

  const backupsDir = path.join(app.getPath('documents'), 'MEG-Sistema-Backups');

  // Crear carpeta de backups si no existe
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
    console.log(`[AUTO-BACKUP] 📁 Carpeta de backups creada: ${backupsDir}`);
  }

  // Obtener todos los datos
  db.all('SELECT id, content FROM app_data', [], (err, rows) => {
    if (err) {
      console.error('[AUTO-BACKUP] ❌ Error al leer datos:', err);
      return;
    }

    const backup = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      data: {}
    };

    rows.forEach(row => {
      try {
        backup.data[row.id] = JSON.parse(row.content);
      } catch (e) {
        console.error(`[AUTO-BACKUP] Error parseando ${row.id}:`, e);
        backup.data[row.id] = { error: 'Parse error' };
      }
    });

    // Nombre del archivo con fecha y hora (formato: backup-2025-11-19_22-30-45.json)
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
    const backupFile = path.join(backupsDir, `backup-${timestamp}.json`);

    // Guardar backup
    fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
    console.log(`[AUTO-BACKUP] ✅ Backup guardado: ${backupFile}`);

    // Limpiar backups antiguos (mantener solo los últimos 30)
    try {
      const files = fs.readdirSync(backupsDir)
        .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
        .map(f => ({
          name: f,
          path: path.join(backupsDir, f),
          time: fs.statSync(path.join(backupsDir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time); // Más recientes primero

      // Si hay más de 30 backups, eliminar los más antiguos
      if (files.length > 30) {
        const toDelete = files.slice(30);
        toDelete.forEach(file => {
          fs.unlinkSync(file.path);
          console.log(`[AUTO-BACKUP] 🗑️  Backup antiguo eliminado: ${file.name}`);
        });
      }

      console.log(`[AUTO-BACKUP] 📊 Total de backups: ${Math.min(files.length, 30)}`);
    } catch (cleanupErr) {
      console.error('[AUTO-BACKUP] Error limpiando backups antiguos:', cleanupErr);
    }
  });
}

/**
 * Limpieza automática de items eliminados
 * Elimina permanentemente items con deleted=true que tengan más de 30 días
 * Los backups automáticos preservan el historial antes de la limpieza
 */
function cleanupDeletedItems() {
  if (!db) return;

  console.log('[CLEANUP] Iniciando limpieza de items eliminados (>30 días)...');

  const DAYS_TO_KEEP = 30;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - DAYS_TO_KEEP);
  const cutoffISO = cutoffDate.toISOString();

  db.all('SELECT id, content FROM app_data', [], (err, rows) => {
    if (err) {
      console.error('[CLEANUP] Error al leer datos:', err);
      return;
    }

    let totalCleaned = 0;

    rows.forEach(row => {
      try {
        const data = JSON.parse(row.content);
        let hasChanges = false;

        ['cotizaciones', 'clientes', 'ordenesCompra', 'ordenesTrabajo'].forEach(key => {
          if (Array.isArray(data[key])) {
            const originalLength = data[key].length;

            data[key] = data[key].filter(item => {
              if (!item.deleted) return true;

              const itemDate = item.updatedAt || item.fecha || null;
              if (!itemDate) return true; // Sin fecha: mantener por seguridad

              return itemDate > cutoffISO; // Mantener si fue eliminado hace menos de 30 días
            });

            const cleaned = originalLength - data[key].length;
            if (cleaned > 0) {
              console.log(`[CLEANUP] ${row.id} - ${key}: eliminados ${cleaned} items`);
              totalCleaned += cleaned;
              hasChanges = true;
            }
          }
        });

        if (hasChanges) {
          const updatedContent = JSON.stringify(data);
          db.run(
            'UPDATE app_data SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [updatedContent, row.id],
            (updateErr) => {
              if (updateErr) {
                console.error(`[CLEANUP] Error actualizando ${row.id}:`, updateErr);
              }
            }
          );
        }
      } catch (parseErr) {
        console.error(`[CLEANUP] Error parseando datos de ${row.id}:`, parseErr);
      }
    });

    if (totalCleaned > 0) {
      console.log(`[CLEANUP] ✅ Limpieza completada: ${totalCleaned} items eliminados permanentemente`);
    } else {
      console.log('[CLEANUP] ✅ Sin items para limpiar');
    }
  });
}

/**
 * Validar estructura de datos según apartado
 * ✅ FIX: Agregado para consistencia con VPS
 *
 * @param {String} userKey - Clave del usuario (meg, myorganic, meg_creacion, myorganic_creacion)
 * @param {Object} data - Datos a validar
 * @returns {Object} - { valid: boolean, filteredData?: Object, error?: String }
 */
function validateDataStructure(userKey, data) {
  const isMainApartment = userKey === 'meg' || userKey === 'myorganic' || userKey === 'avar';
  const isCreacionApartment = userKey === 'meg_creacion' || userKey === 'myorganic_creacion' || userKey === 'avar_creacion';

  if (isMainApartment) {
    // Apartado principal: SOLO debe tener cotizaciones
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Datos inválidos' };
    }

    if (!Array.isArray(data.cotizaciones)) {
      return { valid: false, error: 'Apartado principal debe tener array de cotizaciones' };
    }

    // Filtrar solo cotizaciones (ignorar claves extra)
    const filteredData = {
      cotizaciones: data.cotizaciones
    };

    // Advertir si tiene claves extra
    const receivedKeys = Object.keys(data);
    const extraKeys = receivedKeys.filter(k => k !== 'cotizaciones');
    if (extraKeys.length > 0) {
      console.warn(`⚠️ [${userKey}] Claves extra ignoradas: ${extraKeys.join(', ')}`);
    }

    return { valid: true, filteredData };
  }

  if (isCreacionApartment) {
    // Apartado creación: debe tener los 4 arrays
    const requiredKeys = ['clientes', 'cotizaciones', 'ordenesCompra', 'ordenesTrabajo'];

    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Datos inválidos' };
    }

    for (const key of requiredKeys) {
      if (!Array.isArray(data[key])) {
        return { valid: false, error: `Apartado creación debe tener array de ${key}` };
      }
    }

    // Filtrar solo claves permitidas
    const filteredData = {
      clientes: data.clientes,
      cotizaciones: data.cotizaciones,
      ordenesCompra: data.ordenesCompra,
      ordenesTrabajo: data.ordenesTrabajo
    };

    return { valid: true, filteredData };
  }

  return { valid: false, error: `userKey desconocido: ${userKey}` };
}


// Función para inicializar la base de datos local
function initDatabase() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(localDbPath, (err) => {
      if (err) {
        console.error('Error opening database:', err);
        reject(err);
        return;
      }

      console.log('Local database connected');

      // Crear tabla si no existe
      db.run(`
        CREATE TABLE IF NOT EXISTS app_data (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          console.error('Error creating table:', err);
          reject(err);
          return;
        }

        // ✅ FIX: Crear índices para mejorar rendimiento
        db.run(`CREATE INDEX IF NOT EXISTS idx_app_data_updated_at ON app_data(updated_at DESC)`, (err) => {
          if (err) console.error('Error creating index on updated_at:', err);
        });

        console.log('✅ Database schema initialized with indexes');

        // Insertar datos iniciales si la tabla está vacía
        const initialData = {
          'meg': { cotizaciones: [] },
          'myorganic': { cotizaciones: [] },
          'avar': { cotizaciones: [] },
          'meg_creacion': { clientes: [], cotizaciones: [], ordenesCompra: [], ordenesTrabajo: [] },
          'myorganic_creacion': { clientes: [], cotizaciones: [], ordenesCompra: [], ordenesTrabajo: [] },
          'avar_creacion': { clientes: [], cotizaciones: [], ordenesCompra: [], ordenesTrabajo: [] }
        };

        db.get('SELECT COUNT(*) as count FROM app_data', (err, row) => {
          if (err) {
            console.error('Error checking data:', err);
            reject(err);
            return;
          }

          if (row.count === 0) {
            console.log('Initializing database with default data...');
            const stmt = db.prepare('INSERT OR IGNORE INTO app_data (id, content) VALUES (?, ?)');

            Object.entries(initialData).forEach(([key, value]) => {
              stmt.run(key, JSON.stringify(value));
            });

            stmt.finalize(() => {
              console.log('Database initialized');

              // Ejecutar backup automático al iniciar (después de 10 segundos)
              setTimeout(() => performAutoBackup(), 10000);

              // Programar backup automático (a las 2:00 AM cada día)
              scheduleNextBackup();

              // Ejecutar limpieza al iniciar (después de 5 minutos)
              setTimeout(() => cleanupDeletedItems(), 5 * 60 * 1000);
              // Repetir limpieza cada 30 días
              setInterval(() => cleanupDeletedItems(), 30 * 24 * 60 * 60 * 1000);

              resolve();
            });
          } else {
            console.log('Database already has data');

            // Asegurar que existan las filas de AVAR (por si es una BD anterior)
            const avarDefaults = {
              'avar': { cotizaciones: [] },
              'avar_creacion': { clientes: [], cotizaciones: [], ordenesCompra: [], ordenesTrabajo: [] }
            };
            const avarStmt = db.prepare('INSERT OR IGNORE INTO app_data (id, content) VALUES (?, ?)');
            Object.entries(avarDefaults).forEach(([key, value]) => {
              avarStmt.run(key, JSON.stringify(value));
            });
            avarStmt.finalize(() => {
              console.log('✅ Filas AVAR aseguradas en BD existente');
            });

            // Programar backup automático (a las 2:00 AM cada día)
            scheduleNextBackup();

            // Ejecutar limpieza al iniciar (después de 5 minutos)
            setTimeout(() => cleanupDeletedItems(), 5 * 60 * 1000);
            // Repetir limpieza cada 30 días
            setInterval(() => cleanupDeletedItems(), 30 * 24 * 60 * 60 * 1000);

            resolve();
          }
        });
      });
    });
  });
}

// Función para iniciar el servidor Express local
function startExpressServer() {
  return new Promise((resolve, reject) => {
    const expressApp = express();

    expressApp.use(cors());
    expressApp.use(express.json({ limit: '100mb' }));
    expressApp.use(express.urlencoded({ limit: '100mb', extended: true }));

    // Endpoint de health check
    expressApp.get('/api/health', (req, res) => {
      res.json({ status: 'ok', mode: 'local' });
    });

    // Endpoint de login (credenciales desde variables de entorno)
    expressApp.post('/api/login', (req, res) => {
      const { username, password } = req.body;

      // ✅ FIX: Credenciales por defecto (deben coincidir con VPS)
      const DEFAULT_MEG_PASSWORD = 'meg4731$';
      const DEFAULT_MYORGANIC_PASSWORD = 'myorganic4731$';

      const DEFAULT_AVAR_PASSWORD = 'avar4731$';

      const credentials = {
        'meg_2025': process.env.MEG_PASSWORD || DEFAULT_MEG_PASSWORD,
        'myorganic_2025': process.env.MYORGANIC_PASSWORD || DEFAULT_MYORGANIC_PASSWORD,
        'avar_2025': process.env.AVAR_PASSWORD || DEFAULT_AVAR_PASSWORD
      };

      // ⚠️ Advertir si se están usando credenciales por defecto
      if (!process.env.MEG_PASSWORD || !process.env.MYORGANIC_PASSWORD || !process.env.AVAR_PASSWORD) {
        console.warn('═══════════════════════════════════════');
        console.warn('⚠️  ADVERTENCIA DE SEGURIDAD');
        console.warn('═══════════════════════════════════════');
        console.warn('Usando credenciales por defecto.');
        console.warn('Configure MEG_PASSWORD y MYORGANIC_PASSWORD');
        console.warn('en las variables de entorno del sistema.');
        console.warn('═══════════════════════════════════════');
      }

      // Mapeo de username a userKey
      const usernameToKey = {
        'meg_2025': 'meg',
        'myorganic_2025': 'myorganic',
        'avar_2025': 'avar'
      };

      if (credentials[username] === password) {
        const userKey = usernameToKey[username];
        const companyNames = {
          'meg': 'MEG Industrial',
          'myorganic': 'MyOrganic',
          'avar': 'AVAR'
        };

        res.json({
          success: true,
          username,
          userKey,
          company: companyNames[userKey] || userKey
        });
      } else {
        res.status(401).json({ success: false, message: 'Credenciales inválidas' });
      }
    });

    // Endpoint para obtener datos
    expressApp.get('/api/data', (req, res) => {
      const userKey = req.query.key;

      if (!userKey) {
        return res.status(400).json({ error: 'Missing key parameter' });
      }

      db.get('SELECT content, updated_at FROM app_data WHERE id = ?', [userKey], (err, row) => {
        if (err) {
          console.error('Error fetching data:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (!row) {
          // Si no existe, retornar estructura vacía
          return res.json({ cotizaciones: [] });
        }

        try {
          const data = JSON.parse(row.content);

          // ✅ FIX: Validar y filtrar estructura antes de enviar
          const validation = validateDataStructure(userKey, data);

          if (!validation.valid) {
            console.warn(`⚠️ [${userKey}] Estructura inválida en DB, retornando estructura correcta:`, validation.error);
            // Retornar estructura vacía correcta
            return res.json({ cotizaciones: [] });
          }

          // Enviar datos filtrados (solo las claves permitidas)
          res.json(validation.filteredData);
        } catch (e) {
          console.error('Error parsing data:', e);
          res.status(500).json({ error: 'Data parsing error' });
        }
      });
    });

    // Endpoint para guardar datos
    expressApp.post('/api/data', (req, res) => {
      const userKey = req.query.key;
      const data = req.body;

      if (!userKey) {
        return res.status(400).json({ error: 'Missing key parameter' });
      }

      const content = JSON.stringify(data);

      db.run(
        'INSERT OR REPLACE INTO app_data (id, content, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        [userKey, content],
        function(err) {
          if (err) {
            console.error('Error saving data:', err);
            return res.status(500).json({ error: 'Database error' });
          }

          res.json({ success: true, changes: this.changes });
        }
      );
    });

    // Endpoints para el sistema de creación
    expressApp.get('/api/creacion', (req, res) => {
      const userKey = req.query.key;

      if (!userKey) {
        return res.status(400).json({ error: 'Missing key parameter' });
      }

      // Agregar sufijo _creacion
      const creacionKey = userKey + '_creacion';

      db.get('SELECT content FROM app_data WHERE id = ?', [creacionKey], (err, row) => {
        if (err) {
          console.error('Error fetching creacion data:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (!row) {
          return res.json({ clientes: [], cotizaciones: [], ordenesCompra: [], ordenesTrabajo: [] });
        }

        try {
          const data = JSON.parse(row.content);

          // ✅ FIX: Validar y filtrar estructura antes de enviar
          const validation = validateDataStructure(creacionKey, data);

          if (!validation.valid) {
            console.warn(`⚠️ [${creacionKey}] Estructura inválida en DB, retornando estructura correcta:`, validation.error);
            // Retornar estructura vacía correcta
            return res.json({ clientes: [], cotizaciones: [], ordenesCompra: [], ordenesTrabajo: [] });
          }

          // Enviar datos filtrados (solo las claves permitidas)
          res.json(validation.filteredData);
        } catch (e) {
          console.error('Error parsing creacion data:', e);
          res.status(500).json({ error: 'Data parsing error' });
        }
      });
    });

    expressApp.post('/api/creacion', (req, res) => {
      const userKey = req.query.key;
      const data = req.body;

      if (!userKey) {
        return res.status(400).json({ error: 'Missing key parameter' });
      }

      // Agregar sufijo _creacion
      const creacionKey = userKey + '_creacion';

      const content = JSON.stringify(data);

      // Guardar en SQLite local
      db.run(
        'INSERT OR REPLACE INTO app_data (id, content, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        [creacionKey, content],
        function(err) {
          if (err) {
            console.error('Error saving creacion data:', err);
            return res.status(500).json({ error: 'Database error' });
          }

          console.log(`[SAVE] ✓ Datos guardados localmente para ${creacionKey}`);
          res.json({ success: true, changes: this.changes });
        }
      );
    });

    // ========================================
    // 📦 ENDPOINTS DE BACKUP COMPLETO
    // ========================================

    // GET /api/backup/export-all - Exportar TODOS los apartados en un solo JSON
    expressApp.get('/api/backup/export-all', (req, res) => {
      console.log('[BACKUP] 📦 Exportando backup completo...');

      db.all('SELECT id, content FROM app_data', [], (err, rows) => {
        if (err) {
          console.error('[BACKUP] Error al exportar:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        const backup = {
          version: '1.0',
          timestamp: new Date().toISOString(),
          data: {}
        };

        rows.forEach(row => {
          try {
            backup.data[row.id] = JSON.parse(row.content);
          } catch (e) {
            console.error(`[BACKUP] Error parseando ${row.id}:`, e);
            backup.data[row.id] = { error: 'Parse error' };
          }
        });

        console.log(`[BACKUP] ✅ Backup completo generado (${rows.length} apartados)`);
        res.json(backup);
      });
    });

    // POST /api/backup/import-all - Importar TODOS los apartados desde JSON (REEMPLAZA TODO)
    expressApp.post('/api/backup/import-all', async (req, res) => {
      const backup = req.body;

      if (!backup || !backup.data) {
        return res.status(400).json({ error: 'Invalid backup format' });
      }

      console.log('[BACKUP] 📥 Importando backup completo (modo REEMPLAZAR)...');

      const entries = Object.entries(backup.data);

      // Si no hay datos que importar
      if (entries.length === 0) {
        return res.json({ success: true, imported: 0, errors: 0, message: 'Backup vacío' });
      }

      try {
        // Convertir db.run a Promise para usar con Promise.all
        const importPromises = entries.map(([key, data]) => {
          return new Promise((resolve, reject) => {
            const content = JSON.stringify(data);

            db.run(
              'INSERT OR REPLACE INTO app_data (id, content, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
              [key, content],
              function(err) {
                if (err) {
                  console.error(`[BACKUP] Error importando ${key}:`, err);
                  resolve({ success: false, key, error: err.message });
                } else {
                  resolve({ success: true, key });
                }
              }
            );
          });
        });

        // Esperar a que todas las importaciones terminen
        const results = await Promise.all(importPromises);

        // Contar exitosos y errores
        const imported = results.filter(r => r.success).length;
        const errors = results.filter(r => !r.success).length;

        console.log(`[BACKUP] ✅ Importación completa: ${imported} exitosos, ${errors} errores`);

        res.json({
          success: true,
          imported,
          errors,
          message: `Backup restaurado: ${imported} apartados`
        });
      } catch (error) {
        console.error('[BACKUP] ❌ Error fatal en importación:', error);
        res.status(500).json({
          success: false,
          error: 'Error al importar backup',
          message: error.message
        });
      }
    });

    // POST /api/backup/import-merge - NUEVO: Merge inteligente (combina datos sin perder nada)
    expressApp.post('/api/backup/import-merge', async (req, res) => {
      const backup = req.body;

      if (!backup || !backup.data) {
        return res.status(400).json({ error: 'Invalid backup format' });
      }

      console.log('[BACKUP-MERGE] 🔀 Iniciando merge inteligente...');

      const entries = Object.entries(backup.data);

      if (entries.length === 0) {
        return res.json({
          success: true,
          merged: 0,
          added: 0,
          updated: 0,
          message: 'Backup vacío'
        });
      }

      try {
        let totalMerged = 0;
        let totalAdded = 0;
        let totalUpdated = 0;

        for (const [key, backupData] of entries) {
          // Obtener datos actuales de la base de datos
          const currentRow = await new Promise((resolve, reject) => {
            db.get('SELECT content FROM app_data WHERE id = ?', [key], (err, row) => {
              if (err) reject(err);
              else resolve(row);
            });
          });

          let mergedData;

          if (!currentRow) {
            // No existe en DB, insertar directamente
            mergedData = backupData;
            console.log(`[BACKUP-MERGE] ➕ ${key}: No existe, insertando...`);
          } else {
            // Ya existe, hacer merge inteligente
            const currentData = JSON.parse(currentRow.content);
            mergedData = smartMerge(key, currentData, backupData);
            console.log(`[BACKUP-MERGE] 🔀 ${key}: Merge completado`);
          }

          // Guardar datos merged
          await new Promise((resolve, reject) => {
            db.run(
              'INSERT OR REPLACE INTO app_data (id, content, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
              [key, JSON.stringify(mergedData)],
              function(err) {
                if (err) reject(err);
                else resolve();
              }
            );
          });

          totalMerged++;
        }

        console.log(`[BACKUP-MERGE] ✅ Merge completo: ${totalMerged} apartados procesados`);

        res.json({
          success: true,
          merged: totalMerged,
          message: `Backup combinado exitosamente: ${totalMerged} apartados`
        });

      } catch (error) {
        console.error('[BACKUP-MERGE] ❌ Error en merge:', error);
        res.status(500).json({
          success: false,
          error: 'Error al hacer merge del backup',
          message: error.message
        });
      }
    });

    /**
     * SMART MERGE: Combina datos actuales con backup sin perder nada
     * @param {String} key - Clave del apartado (meg, myorganic, meg_creacion, etc.)
     * @param {Object} currentData - Datos actuales en DB
     * @param {Object} backupData - Datos del backup
     * @returns {Object} - Datos combinados
     */
    function smartMerge(key, currentData, backupData) {
      const isCreacion = key.endsWith('_creacion');

      if (isCreacion) {
        // Apartado de creación: merge de 4 arrays
        return {
          clientes: mergeArray(currentData.clientes || [], backupData.clientes || [], 'rut'),
          cotizaciones: mergeArray(currentData.cotizaciones || [], backupData.cotizaciones || [], 'numero'),
          ordenesCompra: mergeArray(currentData.ordenesCompra || [], backupData.ordenesCompra || [], 'numero'),
          ordenesTrabajo: mergeArray(currentData.ordenesTrabajo || [], backupData.ordenesTrabajo || [], 'numero')
        };
      } else {
        // Apartado principal: solo cotizaciones
        return {
          cotizaciones: mergeArray(currentData.cotizaciones || [], backupData.cotizaciones || [], 'numero')
        };
      }
    }

    /**
     * Merge de arrays por ID único, manteniendo el más reciente en caso de duplicados
     * @param {Array} currentArray - Array actual
     * @param {Array} backupArray - Array del backup
     * @param {String} idField - Campo que sirve como ID único (rut, numero, etc.)
     * @returns {Array} - Array combinado sin duplicados
     */
    function mergeArray(currentArray, backupArray, idField) {
      const merged = {};

      // Agregar items actuales
      currentArray.forEach(item => {
        const id = item[idField];
        if (id) {
          merged[id] = item;
        }
      });

      // Agregar/actualizar con items del backup
      backupArray.forEach(item => {
        const id = item[idField];
        if (id) {
          const existing = merged[id];

          if (!existing) {
            // No existe, agregar
            merged[id] = item;
          } else {
            // Ya existe, mantener el más reciente según updatedAt o fecha
            if (isNewer(item, existing)) {
              merged[id] = item;
            }
            // Si el actual es más reciente, no hacer nada (mantener el actual)
          }
        }
      });

      return Object.values(merged);
    }

    // Iniciar servidor
    expressServer = expressApp.listen(EXPRESS_PORT, () => {
      console.log(`Express server running on port ${EXPRESS_PORT}`);
      resolve();
    });
  });
}

// Crear ventana principal
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../public/logo-meg.png'),
    title: 'MEG Industrial & MyOrganic Sistema',
    backgroundColor: '#ffffff',
    show: false // No mostrar hasta que esté lista
  });

  // Mostrar cuando esté lista para evitar flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // En desarrollo, cargar desde Vite dev server
  // En producción, cargar los archivos estáticos
  const isDev = !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // En producción, cargar desde dist empaquetado
    const appPath = app.getAppPath();
    const indexPath = path.join(appPath, 'dist', 'index.html');
    console.log('Loading from:', indexPath);
    mainWindow.loadFile(indexPath).catch(err => {
      console.error('Error loading file:', err);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers para comunicación con el renderer
ipcMain.handle('get-user-data-path', () => {
  return userDataPath;
});

ipcMain.handle('get-local-db-path', () => {
  return localDbPath;
});

ipcMain.handle('export-database', async () => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar Base de Datos',
      defaultPath: path.join(app.getPath('downloads'), 'meg-backup.db'),
      filters: [
        { name: 'Database', extensions: ['db'] }
      ]
    });

    if (!result.canceled && result.filePath) {
      fs.copyFileSync(localDbPath, result.filePath);
      return { success: true, path: result.filePath };
    }

    return { success: false, message: 'Exportación cancelada' };
  } catch (error) {
    console.error('Error exporting database:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('import-database', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Importar Base de Datos',
      filters: [
        { name: 'Database', extensions: ['db'] }
      ],
      properties: ['openFile']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      // Crear backup antes de importar
      const backupPath = localDbPath + '.backup';
      fs.copyFileSync(localDbPath, backupPath);

      // Cerrar la base de datos actual
      await new Promise((resolve, reject) => {
        db.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Copiar la nueva base de datos
      fs.copyFileSync(result.filePaths[0], localDbPath);

      // Reiniciar la base de datos
      await initDatabase();

      return { success: true, message: 'Base de datos importada correctamente' };
    }

    return { success: false, message: 'Importación cancelada' };
  } catch (error) {
    console.error('Error importing database:', error);
    return { success: false, message: error.message };
  }
});

ipcMain.handle('open-pdf', async (event, { name, dataUrl }) => {
  try {
    // Extraer el base64 del data URL
    const base64Data = dataUrl.replace(/^data:application\/pdf;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Crear archivo temporal con un nombre único
    const tempFileName = `${Date.now()}_${name}`;
    const tempPath = path.join(os.tmpdir(), tempFileName);

    // Escribir el PDF temporalmente
    fs.writeFileSync(tempPath, buffer);

    // Abrir con el visor predeterminado del sistema
    const result = await shell.openPath(tempPath);

    // Si result es un string vacío, significa que se abrió correctamente
    if (result === '') {
      console.log('PDF opened successfully:', tempFileName);

      // Eliminar el archivo temporal después de 30 segundos
      setTimeout(() => {
        try {
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
            console.log('Temp PDF cleaned up:', tempFileName);
          }
        } catch (cleanupError) {
          console.error('Error cleaning up temp PDF:', cleanupError);
        }
      }, 30000);

      return { success: true };
    } else {
      console.error('Error opening PDF:', result);
      return { success: false, message: result };
    }
  } catch (error) {
    console.error('Error in open-pdf handler:', error);
    return { success: false, message: error.message };
  }
});

// Inicialización de la aplicación
app.whenReady().then(async () => {
  try {
    console.log('Initializing MEG Sistema...');

    // Inicializar base de datos local
    await initDatabase();

    // Iniciar servidor Express local
    await startExpressServer();

    // Crear ventana principal
    createWindow();

    console.log('Application ready!');
  } catch (error) {
    console.error('Error during initialization:', error);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Cerrar la aplicación cuando todas las ventanas estén cerradas
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Cerrar servidor Express
    if (expressServer) {
      expressServer.close();
    }

    // Cerrar base de datos
    if (db) {
      db.close();
    }

    app.quit();
  }
});

// Cleanup antes de salir
app.on('before-quit', () => {
  if (expressServer) {
    expressServer.close();
  }

  if (db) {
    db.close();
  }
});
