# MEG Sistema - Sistema de Gestión Empresarial

Sistema de escritorio multiplataforma para gestión de cotizaciones, órdenes de compra y órdenes de trabajo.

## 🎯 Características Principales

- ✅ **100% Local** - No requiere internet, todos los datos en tu computador
- ✅ **Backup Automático** - Respaldos diarios automáticos
- ✅ **Exportar/Importar** - Backup completo de todos los datos
- ✅ **Multi-empresa** - Gestiona MEG Industrial y MyOrganic
- ✅ **Generación de PDFs** - Crea cotizaciones, OC y OT profesionales
- ✅ **Dashboard Financiero** - Gráficos de ingresos, costos y utilidades
- ✅ **Exportación Excel** - Exporta datos a hojas de cálculo

## 📦 Instalación

### Windows
1. Descarga `MEG-Sistema-Setup-X.X.X.exe` desde Releases
2. Ejecuta el instalador
3. Abre la aplicación

### macOS
1. Descarga `MEG-Sistema-X.X.X-x64.dmg`
2. Arrastra a Aplicaciones
3. Abre la aplicación

### Linux
1. Descarga `MEG-Sistema-X.X.X.AppImage`
2. Dale permisos de ejecución: `chmod +x MEG-Sistema-X.X.X.AppImage`
3. Ejecuta: `./MEG-Sistema-X.X.X.AppImage`

## 🔐 Credenciales

**Usuario MEG Industrial:**
- Usuario: `meg_2025`
- Contraseña: Configurar en variables de entorno (`MEG_PASSWORD`)

**Usuario MyOrganic:**
- Usuario: `myorganic_2025`
- Contraseña: Configurar en variables de entorno (`MYORGANIC_PASSWORD`)

## 💾 Ubicación de Datos

### Base de Datos Local
- **Windows:** `C:\Users\<Usuario>\AppData\Roaming\meg-sistema-electron\data.db`
- **macOS:** `~/Library/Application Support/meg-sistema-electron/data.db`
- **Linux:** `~/.config/meg-sistema-electron/data.db`

### Backups Automáticos
- **Ubicación:** `Documentos/MEG-Sistema-Backups/`
- **Frecuencia:** Diario (2:00 AM)
- **Retención:** Últimos 30 backups (1 mes)
- **Formato:** JSON con timestamp

## 📋 Uso del Sistema

### Apartados Disponibles

**1. Cotizaciones (Principal)**
- Ver y gestionar cotizaciones existentes
- Dashboard con gráficos financieros
- Exportar a Excel
- Gestionar OC, OT, Financiamiento

**2. Creación**
- Crear clientes (con validación RUT)
- Crear cotizaciones con PDF
- Crear órdenes de compra
- Crear órdenes de trabajo

### Backup y Restauración

#### Backup Completo (Recomendado)
1. Clic en **"Exportar TODO"** en el sidebar
2. Guarda el archivo `MEG-Sistema-COMPLETO-YYYY-MM-DD.json`
3. Guarda en lugar seguro (USB, nube, etc.)

#### Restaurar Backup Completo
1. Clic en **"Restaurar TODO"** en el sidebar
2. Selecciona el archivo de backup
3. El sistema restaurará TODOS los apartados
4. La aplicación se recargará automáticamente

#### Backup de Apartado Actual
- **"Exportar"**: Exporta solo el apartado actual
- **"Importar"**: Importa solo el apartado actual

## 🛠️ Desarrollo

### Requisitos
- Node.js 20 LTS
- npm 10+

### Instalación de Desarrollo
```bash
# Clonar repositorio
git clone <repo-url>
cd meg-sistema

# Instalar dependencias
npm install

# Desarrollo
npm run dev

# Build para producción
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

### Estructura del Proyecto
```
meg-sistema/
├── electron/           # Backend Electron (Express + SQLite)
│   ├── main.js        # Servidor Express + IPC
│   └── preload.js     # Bridge seguro
├── src/               # Frontend React
│   ├── pages/         # Páginas principales
│   ├── components/    # Componentes reutilizables
│   └── utils/         # Utilidades
├── public/            # Assets estáticos
└── build/             # Recursos de empaquetado
```

### Scripts Disponibles
```bash
npm run dev              # Desarrollo con hot-reload
npm run build            # Build frontend
npm run build:win        # Empaquetar para Windows
npm run build:mac        # Empaquetar para macOS (requiere Mac)
npm run build:linux      # Empaquetar para Linux
npm run postinstall      # Recompilar dependencias nativas
```

## 🔧 Tecnologías Utilizadas

### Frontend
- React 19
- Vite 6
- TailwindCSS 3.4
- Radix UI
- Recharts (gráficos)
- pdf-lib (generación PDFs)
- XLSX (exportación Excel)

### Backend
- Electron 34
- Express 5
- SQLite3 5.1
- Node.js 20 LTS

## 📊 Arquitectura

```
┌─────────────────────────┐
│   React Frontend        │ ← Usuario interactúa
│   (localhost:5173)      │
└───────────┬─────────────┘
            │ HTTP
┌───────────▼─────────────┐
│ Express + SQLite        │ ← Backend local
│   (puerto 3001)         │
│   data.db (SQLite)      │
└─────────────────────────┘
```

## 🐛 Resolución de Problemas

### La aplicación no abre
- Verifica que no haya otra instancia corriendo
- Elimina `%APPDATA%\meg-sistema-electron` y vuelve a abrir

### Datos no aparecen después de restaurar
1. Cierra la aplicación completamente
2. Abre de nuevo
3. Inicia sesión con tus credenciales

### Error al importar backup
- Verifica que el archivo JSON sea válido
- Asegúrate de que tenga la estructura correcta (`{version, timestamp, data}`)

## 📝 Changelog

### v2.0.0 (Actual)
- ✅ Eliminado sistema VPS (100% local)
- ✅ Backup automático diario
- ✅ Nuevos botones "Exportar TODO" / "Restaurar TODO"
- ✅ Mejoras en UI de backup
- ✅ Limpieza de código (eliminadas 277 líneas)

### v1.6.7
- Última versión con sincronización VPS

## 📄 Licencia

Copyright © 2024-2025 MEG Industrial & MyOrganic
Todos los derechos reservados.

## 🤝 Soporte

Para reportar problemas o solicitar ayuda:
- Crear issue en el repositorio
- Contactar al equipo de desarrollo

---

**Desarrollado con ❤️ por el equipo de MEG Sistema**

🤖 Generated with [Claude Code](https://claude.com/claude-code)
