import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/Toast';
import { RUTInput } from '@/components/RUTInput';
import { validateRUT } from '@/utils/rut';
import { MoneyInput, fmtMoney as formatMoney } from '@/utils/money';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Trash2, Pencil, Users, FileText, ShoppingCart, Wrench,
  Plus, Save, FolderOpen, Search, Download, LogOut,
  Sparkles, LayoutDashboard
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { saveAs } from 'file-saver';

/* ===========================
   localStorage: Plantillas de Condiciones Comerciales
   =========================== */
const CONDICIONES_STORAGE_KEY = 'meg_condiciones_plantillas';

function getCondicionesPlantillas() {
  try {
    const data = localStorage.getItem(CONDICIONES_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Error al cargar plantillas de condiciones:', e);
    return [];
  }
}

function saveCondicionesPlantilla(nombre, contenido) {
  try {
    const plantillas = getCondicionesPlantillas();
    const existe = plantillas.find(p => p.nombre === nombre);

    if (existe) {
      // Actualizar plantilla existente
      const actualizadas = plantillas.map(p =>
        p.nombre === nombre ? { nombre, contenido, fecha: new Date().toISOString() } : p
      );
      localStorage.setItem(CONDICIONES_STORAGE_KEY, JSON.stringify(actualizadas));
    } else {
      // Crear nueva plantilla
      plantillas.push({ nombre, contenido, fecha: new Date().toISOString() });
      localStorage.setItem(CONDICIONES_STORAGE_KEY, JSON.stringify(plantillas));
    }
    return true;
  } catch (e) {
    console.error('Error al guardar plantilla de condiciones:', e);
    return false;
  }
}

function deleteCondicionesPlantilla(nombre) {
  try {
    const plantillas = getCondicionesPlantillas();
    const filtradas = plantillas.filter(p => p.nombre !== nombre);
    localStorage.setItem(CONDICIONES_STORAGE_KEY, JSON.stringify(filtradas));
    return true;
  } catch (e) {
    console.error('Error al eliminar plantilla de condiciones:', e);
    return false;
  }
}

/* ===========================
   Configuración centralizada
   =========================== */
const CONFIG = {
  MAX_FILE_SIZE_MB: 20,
  ITEMS_POR_PAGINA: 9,
  PDF_TIMEOUT_MS: 60000,
  MAX_ITEMS_IN_PDF: 500,
};

/* ===========================
   Store de persistencia (API)
   =========================== */
function useCreacionStore(userKey, isEditing, toast) {
  // Siempre usar localhost:3001 porque Express corre localmente en Electron
  const API_BASE = 'http://localhost:3001';

  const [data, setDataState] = useState({
    clientes: [],
    cotizaciones: [],
    ordenesCompra: [],
    ordenesTrabajo: []
  });
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // ✅ FIX: Carga de datos con cancelación correcta de race conditions
  useEffect(() => {
    if (!userKey) return;

    let cancelled = false;
    const abortController = new AbortController();

    const loadData = async () => {
      try {
        console.log('[CreacionPage] Cargando datos...');
        const res = await fetch(`${API_BASE}/api/creacion?key=${encodeURIComponent(userKey)}`, {
          signal: abortController.signal
        });

        if (!cancelled) {
          if (!res.ok) {
            const txt = await res.text();
            console.error('[CreacionPage] GET /api/creacion no OK:', res.status, txt);
            toast?.error('Error al cargar datos');
            return;
          }

          const json = await res.json();
          setDataState({
            clientes: json.clientes || [],
            cotizaciones: json.cotizaciones || [],
            ordenesCompra: json.ordenesCompra || [],
            ordenesTrabajo: json.ordenesTrabajo || []
          });
          console.log('[CreacionPage] Datos cargados correctamente');
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          console.log('[CreacionPage] Carga de datos cancelada');
        } else if (!cancelled) {
          console.error('[CreacionPage] Error al cargar datos:', error);
          toast?.error('Error al cargar datos');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadData();

    // Cleanup: cancelar request al desmontar o cambiar userKey
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [userKey, toast]);

  // ✅ FIX: saveData con loading state para prevenir guardados concurrentes
  const saveData = useCallback(async (newData) => {
    if (!userKey) {
      console.error('❌ userKey es null/undefined');
      return;
    }

    if (!newData) {
      console.error('❌ newData es null/undefined');
      return;
    }

    // Prevenir guardados múltiples
    if (isSaving) {
      console.log('[SAVE] ⚠️ Guardado ya en progreso, ignorando...');
      return;
    }

    // ✅ Actualizar estructura esperada
    const expectedKeys = ['clientes', 'cotizaciones', 'ordenesCompra', 'ordenesTrabajo'];
    const hasRequired = expectedKeys.every(k => k in newData);
    if (!hasRequired) {
      console.error('❌ newData no tiene la estructura esperada:', newData);
      return;
    }

    setIsSaving(true);
    console.log('═══════════════════════════════════════');
    console.log('📤 FRONTEND - Guardando datos...');
    console.log('📤 userKey:', userKey);
    console.log('═══════════════════════════════════════');

    try {
      const url = `${API_BASE}/api/creacion?key=${encodeURIComponent(userKey)}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newData)
      });

      if (!response.ok) {
        const txt = await response.text();
        console.error('❌ Respuesta no OK:', response.status, txt);
        throw new Error(`Error ${response.status}: ${txt}`);
      }

      const result = await response.json();
      console.log('✅ Datos guardados correctamente');
      toast.success('Datos guardados correctamente');

      // Actualizar estado UI solo con items visibles (filtrar eliminados)
      const dataForUI = {
        clientes: (newData.clientes || []).filter(x => !x.deleted),
        cotizaciones: (newData.cotizaciones || []).filter(x => !x.deleted),
        ordenesCompra: (newData.ordenesCompra || []).filter(x => !x.deleted),
        ordenesTrabajo: (newData.ordenesTrabajo || []).filter(x => !x.deleted)
      };
      setDataState(dataForUI);

    } catch (e) {
      console.error('❌ Error al guardar:', e);
      toast.error(`Error al guardar: ${e.message}`);
    } finally {
      setIsSaving(false);
    }
  }, [userKey, API_BASE, toast, isSaving]);

  return { data, setData: saveData, loading, isSaving };
}

/* ===========================
   Utilidades
   =========================== */
// ✅ FIX: uid() mejorado con timestamp + random + counter para evitar colisiones
let uidCounter = 0;
const uid = () => {
  // Usar crypto API si está disponible (más seguro y único)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback: timestamp + random + counter
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 9);
  const counter = (uidCounter++).toString(36).padStart(3, '0');
  return `${timestamp}-${random}-${counter}`;
};

const todayISO = () => new Date().toISOString().slice(0,10);
const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" });
const fmtMoney = (n) => CLP.format(Math.round(Number(n || 0)));

/**
 * Extrae el valor numérico de un texto que puede contener formato
 * Ejemplos: "(GL) 2.000.000" => 2000000, "Neto: 5.000.000" => 5000000
 * @param {string} texto - El texto de entrada
 * @returns {number} - El valor numérico extraído
 */
const extraerValorNumerico = (texto) => {
  if (typeof texto === 'number') return texto;
  if (!texto) return 0;

  // Convertir a string y eliminar todo excepto dígitos, puntos y comas
  const soloNumeros = String(texto).replace(/[^\d.,]/g, '');

  // Manejar formato chileno: 1.000.000,50 o español: 1.000.000
  // Si hay coma, asumimos que es decimal
  let valorLimpio = soloNumeros;
  if (soloNumeros.includes(',')) {
    // Reemplazar puntos (separadores de miles) y convertir coma a punto decimal
    valorLimpio = soloNumeros.replace(/\./g, '').replace(',', '.');
  } else {
    // Si solo hay puntos, eliminarlos (son separadores de miles)
    valorLimpio = soloNumeros.replace(/\./g, '');
  }

  const numero = parseFloat(valorLimpio);
  return isNaN(numero) ? 0 : numero;
};

/* ===========================
   Configuración de marca por usuario
   =========================== */
const getBrandConfig = (user) => {
  if (user === "myorganic") return {
    primaryColor: "#2563eb",
    accentColor: "#3b82f6",
    logo: "./logo-myorganic.png",
    name: "MyOrganic",
  };
  if (user === "avar") return {
    primaryColor: "#15803d",
    accentColor: "#16a34a",
    logo: "./logo-avar.jpeg",
    name: "AVAR",
  };
  // MEG (default)
  return {
    primaryColor: "#ff6600",
    accentColor: "#ff7a26",
    logo: "./logo-meg.png",
    name: "MEG Industrial",
  };
};

/* ===========================
   Página principal
   =========================== */
export default function CreacionPage() {
  const { user: authUser, isLoading, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("clientes");

  // Redirigir a login si no está autenticado
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate('/');
    }
  }, [isLoading, isAuthenticated, navigate]);

  // Usar el mismo userKey sin sufijo para unificar datos con CotizacionesPage
  const userKey = authUser ? authUser.userKey : undefined;

  // Estados de edición (deben estar antes de useCreacionStore)
  const [nuevoCliente, setNuevoCliente] = useState({
    nombre: "", empresa: "", rut: "", direccion: "", ciudad: "", telefono: "", correo: ""
  });
  const [clienteEnEdicion, setClienteEnEdicion] = useState(null); // ID del cliente que se está editando
  const [editRef, setEditRef] = useState(null);

  // Hook con callback para detectar edición activa
  const { data, setData, loading } = useCreacionStore(userKey, () => {
    // Retorna true si hay alguna edición activa
    return clienteEnEdicion !== null || editRef !== null;
  }, toast);

  // ✅ Filtrar items eliminados solo para mostrar en la UI (memoizado para performance)
  const clientes = useMemo(() => (data.clientes || []).filter(x => !x.deleted), [data.clientes]);
  const cotizaciones = useMemo(() => (data.cotizaciones || []).filter(x => !x.deleted), [data.cotizaciones]);
  const ordenesCompra = useMemo(() => (data.ordenesCompra || []).filter(x => !x.deleted), [data.ordenesCompra]);
  const ordenesTrabajo = useMemo(() => (data.ordenesTrabajo || []).filter(x => !x.deleted), [data.ordenesTrabajo]);

  // Estados de filtros
  const [filtrosCot, setFiltrosCot] = useState({
    cliente: "", rut: "", desde: "", hasta: "",
  });

  const [filtrosOC, setFiltrosOC] = useState({
    cliente: "", rut: "", desde: "", hasta: "",
  });

  // ✅ NUEVO: Filtros para OT
  const [filtrosOT, setFiltrosOT] = useState({
    cliente: "", rut: "", desde: "", hasta: "",
  });

  // Estados de paginación
  const [paginaCot, setPaginaCot] = useState(1);
  const [paginaOC, setPaginaOC] = useState(1);
  const [paginaOT, setPaginaOT] = useState(1); // ✅ NUEVO
  const ITEMS_POR_PAGINA = 9;

  // ✅ Funciones de filtrado
  const filtrarDocumentos = useCallback((documentos, filtros) => {
    return documentos.filter(doc => {
      const clienteNombre = doc.cliente?.nombre?.toLowerCase() || "";
      const clienteEmpresa = doc.cliente?.empresa?.toLowerCase() || "";
      const clienteRUT = doc.cliente?.rut?.toLowerCase() || "";
      const docFecha = doc.fecha || "";

      if (filtros.cliente) {
        const buscar = filtros.cliente.toLowerCase();
        if (!clienteNombre.includes(buscar) && !clienteEmpresa.includes(buscar)) {
          return false;
        }
      }

      if (filtros.rut) {
        if (!clienteRUT.includes(filtros.rut.toLowerCase())) {
          return false;
        }
      }

      if (filtros.desde && docFecha < filtros.desde) {
        return false;
      }

      if (filtros.hasta && docFecha > filtros.hasta) {
        return false;
      }

      return true;
    });
  }, []);

  // ✅ Documentos filtrados memoizados para mejor performance
  const cotizacionesFiltradas = useMemo(() =>
    filtrarDocumentos(cotizaciones, filtrosCot),
    [cotizaciones, filtrosCot, filtrarDocumentos]
  );

  const ordenesCompraFiltradas = useMemo(() =>
    filtrarDocumentos(ordenesCompra, filtrosOC),
    [ordenesCompra, filtrosOC, filtrarDocumentos]
  );

  const ordenesTrabajoFiltradas = useMemo(() =>
    filtrarDocumentos(ordenesTrabajo, filtrosOT),
    [ordenesTrabajo, filtrosOT, filtrarDocumentos]
  );

  const documentoActual = useMemo(() => {
    if (!editRef) return null;
    let list = [];
    if (editRef.tipo === "cotizacion") list = cotizaciones;
    else if (editRef.tipo === "orden_compra") list = ordenesCompra;
    else if (editRef.tipo === "orden_trabajo") list = ordenesTrabajo; // ✅ NUEVO
    return list.find(d => d.id === editRef.id) || null;
  }, [editRef, cotizaciones, ordenesCompra, ordenesTrabajo]);

  /* ===== Acciones clientes ===== */
  const agregarCliente = () => {
    if (!nuevoCliente.nombre || !nuevoCliente.empresa || !nuevoCliente.rut) {
      toast.error("Ingresa nombre, empresa y RUT");
      return;
    }

    // Validar formato de RUT
    if (!validateRUT(nuevoCliente.rut)) {
      toast.error("RUT inválido. Verifica el formato (ej: 12.345.678-9)");
      return;
    }

    if (clienteEnEdicion) {
      // Actualizar cliente existente
      setData({
        ...data,
        clientes: data.clientes.map(c =>
          c.id === clienteEnEdicion ? { ...nuevoCliente, id: c.id, updatedAt: new Date().toISOString() } : c
        )
      });
      toast.success("Proveedor actualizado correctamente");
      setClienteEnEdicion(null);
    } else {
      // Crear nuevo cliente
      const cliente = { ...nuevoCliente, id: uid(), updatedAt: new Date().toISOString() };
      setData({
        ...data,
        clientes: [...data.clientes, cliente]
      });
      toast.success("Proveedor agregado correctamente");
    }

    setNuevoCliente({ nombre: "", empresa: "", rut: "", direccion: "", ciudad: "", telefono: "", correo: "" });
  };

  const eliminarCliente = (id) => {
    // Soft delete: marcar como deleted (mantener PDFs para recuperación)
    setData({
      ...data,
      clientes: data.clientes.map(c =>
        c.id === id
          ? { ...c, deleted: true, updatedAt: new Date().toISOString() }
          : c
      )
    });
  };

  const editarCliente = (cliente) => {
    setNuevoCliente({
      nombre: cliente.nombre,
      empresa: cliente.empresa,
      rut: cliente.rut,
      direccion: cliente.direccion,
      ciudad: cliente.ciudad,
      telefono: cliente.telefono,
      correo: cliente.correo
    });
    setClienteEnEdicion(cliente.id);
    // Scroll al formulario para que el usuario vea que se está editando
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /* ===== Acciones documentos ===== */
  const crearDocumento = (tipo) => {
    const lista = 
      tipo === "cotizacion" ? cotizaciones : 
      tipo === "orden_compra" ? ordenesCompra : 
      ordenesTrabajo;
    
    const prefix = 
      tipo === "cotizacion" ? "COT" : 
      tipo === "orden_compra" ? "OC" : 
      "OT";
    
    const year = new Date().getFullYear();
    
    const numeros = lista
      .map(doc => {
        const match = doc.numero?.match(new RegExp(`${prefix}-${year}-(\\d+)`));
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter(n => n > 0);
    
    const siguienteNumero = numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
    const numeroAutomatico = `${prefix}-${year}-${String(siguienteNumero).padStart(3, '0')}`;

    const documento = {
      id: uid(),
      tipo,
      numero: numeroAutomatico,
      fecha: todayISO(),
      updatedAt: new Date().toISOString(),
      cliente: null,
      items: [{ id: uid(), codigo: "", cantidad: 1, descripcion: "", precioUnitario: 0, precioUnitarioTexto: "", valorTotal: 0 }],
      totalNeto: 0,
      // ✅ NUEVO: Campos personalizables
      incluye: "Precios sin IVA",
      faena: "Interior de planta Generación",
      nota: "4 días hábiles de trabajo y con bloqueos de seguridad requeridos para la faena",
      formaPago: "45 DÍAS HÁBILES CONTRA ORDEN DE COMPRA",
      // ✅ NUEVO: Condiciones comerciales (TODOS los tipos de documento)
      condicionesComerciales: "",
      // ✅ NUEVO: Para OT, referencia a cotización
      cotizacionId: tipo === "orden_trabajo" ? null : undefined,
      // 🔽🔽🔽 NUEVO: Solo para OT
      ocNumero: tipo === "orden_trabajo" ? "" : undefined,
      ocFecha:  tipo === "orden_trabajo" ? todayISO() : undefined,
      ocEmisor: tipo === "orden_trabajo" ? "" : undefined,
      ocMontoNeto: tipo === "orden_trabajo" ? 0 : undefined,
      ocObservacion: tipo === "orden_trabajo" ? "" : undefined,
      // ✅ NUEVO: Facturas de venta asociadas (SOLO para OT) - ahora es un array
      facturasVenta: tipo === "orden_trabajo" ? [] : undefined,
    };
    
    if (tipo === "cotizacion") {
      setData({
        ...data,
        cotizaciones: [...data.cotizaciones, documento]
      });
    } else if (tipo === "orden_compra") {
      setData({
        ...data,
        ordenesCompra: [...data.ordenesCompra, documento]
      });
    } else if (tipo === "orden_trabajo") {
      // ✅ Validar que haya cotizaciones
      if (cotizaciones.length === 0) {
        toast.warning("Primero debes crear al menos una cotización antes de crear una Orden de Trabajo");
        return;
      }
      setData({
        ...data,
        ordenesTrabajo: [...data.ordenesTrabajo, documento]
      });
    }
  };
  
  function guardarDocumentoDesdeEditor(docActualizado) {
    if (!docActualizado || !docActualizado.id || !docActualizado.tipo) return;

    // Añadir updatedAt para sincronización correcta entre PCs
    const docConTimestamp = { ...docActualizado, updatedAt: new Date().toISOString() };

    const nuevasCotizaciones = data.cotizaciones.map(d =>
      d.id === docConTimestamp.id ? docConTimestamp : d
    );
    const nuevasOrdenes = data.ordenesCompra.map(d =>
      d.id === docConTimestamp.id ? docConTimestamp : d
    );
    const nuevasOT = data.ordenesTrabajo.map(d =>
      d.id === docConTimestamp.id ? docConTimestamp : d
    );

    setData({
      ...data,
      cotizaciones: docConTimestamp.tipo === "cotizacion" ? nuevasCotizaciones : data.cotizaciones,
      ordenesCompra: docConTimestamp.tipo === "orden_compra" ? nuevasOrdenes : data.ordenesCompra,
      ordenesTrabajo: docConTimestamp.tipo === "orden_trabajo" ? nuevasOT : data.ordenesTrabajo,
    });
  }

  const eliminarDocumento = (id, tipo) => {
    if (!confirm('¿Estás seguro de eliminar este documento? Esta acción no se puede deshacer.')) {
      return;
    }

    if (tipo === "cotizacion") {
      // Soft delete: marcar como deleted (mantener PDFs para recuperación)
      setData({
        ...data,
        cotizaciones: data.cotizaciones.map(c =>
          c.id === id
            ? { ...c, deleted: true, updatedAt: new Date().toISOString() }
            : c
        )
      });
    } else if (tipo === "orden_compra") {
      // Soft delete: marcar como deleted (mantener PDFs para recuperación)
      setData({
        ...data,
        ordenesCompra: data.ordenesCompra.map(oc =>
          oc.id === id
            ? { ...oc, deleted: true, updatedAt: new Date().toISOString() }
            : oc
        )
      });
    } else if (tipo === "orden_trabajo") {
      // Soft delete: marcar como deleted (mantener PDFs para recuperación)
      setData({
        ...data,
        ordenesTrabajo: data.ordenesTrabajo.map(ot =>
          ot.id === id
            ? { ...ot, deleted: true, updatedAt: new Date().toISOString() }
            : ot
        )
      });
    }
  };

  /* ===== Generar PDF (función compartida) ===== */
  const generarPDF = async (documento) => {
    // Validación de documento
    if (!documento) {
      throw new Error('Documento no válido');
    }
    if (!documento.items || !Array.isArray(documento.items)) {
      console.warn('Documento sin items válidos, usando array vacío');
      documento.items = [];
    }

    const pdfDoc = await PDFDocument.create();

      const A4 = { w: 595.28, h: 841.89 };
      const margin = 50;
      const line = 16;

      // Contadores de seguridad para evitar loops infinitos
      let pageCount = 0;
      let totalPagesCreated = 1; // Contar primera página
      let ensureSpaceDepth = 0;
      const MAX_PAGES = 50;
      const MAX_RECURSION_DEPTH = 5;

      // Flag para detectar si algún texto fue truncado durante la generación
      let wasTruncated = false;

      let page = pdfDoc.addPage([A4.w, A4.h]);
      let { width, height } = page.getSize();
      let y = height - margin;

      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const textWidth = (t, s, f = font) => f.widthOfTextAtSize(String(t ?? ""), s);
      
      const drawRight = (p, txt, xRight, yy, size = 11, f = font, color = rgb(0,0,0)) => {
        const w = textWidth(txt, size, f);
        p.drawText(String(txt ?? ""), { x: xRight - w, y: yy, size, font: f, color });
      };
      
      const wrapText = (txt, maxWidth, size, f = font) => {
        const originalLength = String(txt ?? "").length;
        // Limitar longitud del texto de entrada a 10000 caracteres
        const raw = String(txt ?? "").substring(0, 10000).replace(/\s+/g, " ").trim();
        if (originalLength > 10000) wasTruncated = true;
        if (!raw) return ["—"];
        const words = raw.split(" ");
        const lines = [];
        let cur = "";
        let lineCount = 0;
        const MAX_LINES = 100; // Límite de líneas por campo

        for (const w of words) {
          if (lineCount >= MAX_LINES) {
            wasTruncated = true;
            break;
          }
          const test = cur ? cur + " " + w : w;
          if (textWidth(test, size, f) <= maxWidth) {
            cur = test;
          } else {
            if (cur) {
              lines.push(cur);
              lineCount++;
            }
            cur = w;
          }
        }
        if (cur && lineCount < MAX_LINES) lines.push(cur);
        return lines;
      };

      // Wrapper seguro para crear páginas
      const createNewPage = () => {
        totalPagesCreated++;
        if (totalPagesCreated > MAX_PAGES) {
          console.error(`Máximo de páginas alcanzado: ${totalPagesCreated}`);
          throw new Error(`Documento demasiado grande (>${MAX_PAGES} páginas). Reduce el contenido.`);
        }
        if (totalPagesCreated % 10 === 0) {
          console.log(`Páginas creadas: ${totalPagesCreated}`);
        }
        return pdfDoc.addPage([A4.w, A4.h]);
      };

      const ensureSpace = (h, withTableHeader = false) => {
        // Validar parámetro h
        if (typeof h !== 'number' || isNaN(h) || h < 0) {
          console.warn('ensureSpace llamado con altura inválida:', h);
          return;
        }

        // Validar que h no sea mayor que la altura de página
        if (h > A4.h - margin * 2) {
          console.warn('ensureSpace: altura solicitada muy grande:', h);
          h = A4.h - margin * 2;
        }

        // Protección contra recursión infinita
        ensureSpaceDepth++;
        if (ensureSpaceDepth > MAX_RECURSION_DEPTH) {
          ensureSpaceDepth--;
          throw new Error('Recursión infinita detectada en ensureSpace. Deteniendo generación.');
        }

        try {
          if (y - h < margin + 50) {
            pageCount++;
            if (pageCount > MAX_PAGES) {
              throw new Error(`Máximo de páginas alcanzado (${MAX_PAGES}). Reduce el contenido.`);
            }
            page = createNewPage();
            ({ width, height } = page.getSize());
            y = height - margin;
            drawHeaderBar();
            if (withTableHeader) drawTableHeader();
          }
        } finally {
          ensureSpaceDepth--;
        }
      };

      const userKey = authUser?.userKey;
      const isMyOrganic = userKey === "myorganic";
      const isAvar = userKey === "avar";

      const labelTipo =
        documento.tipo === "cotizacion" ? "Cotización" :
        documento.tipo === "orden_compra" ? "Orden de Compra" :
        "Orden de Trabajo"; // ✅ NUEVO

      const empresaData = isMyOrganic
        ? {
            rut: "78.031.788 - 4",
            direccion: "Andrés de Alcázar 356 OF 603, Edificio Alcázar",
            ciudad: "Rancagua",
            telefono: "+56 9 30782884",
            web: "https://myorganic.cl/",
            logoPath: "./logo-myorganic.png",
          }
        : isAvar
        ? {
            rut: "76.685.962-3",
            direccion: "E. Pinto Lagarrigue 1886, Valle Hermoso",
            ciudad: "San Pedro de la Paz, Bío Bío",
            telefono: "+56 9 3078 2884",
            web: "https://avarmontajes.cl/",
            logoPath: "./logo-avar.jpeg",
          }
        : {
            rut: "77.427.875-3",
            direccion: "Av. Apoquindo 6410",
            ciudad: "Las Condes, Santiago",
            telefono: "+56 9 30782884",
            web: "https://megindustrial.cl/",
            logoPath: "./logo-meg.png",
          };

      let logoImg = null;
      try {
        // Fetch directo con path relativo (funciona en Electron con file://)
        const resp = await fetch(empresaData.logoPath);
        const bytes = await resp.arrayBuffer();
        
        const isPng = empresaData.logoPath.toLowerCase().endsWith('.png');
        logoImg = isPng 
          ? await pdfDoc.embedPng(bytes)
          : await pdfDoc.embedJpg(bytes);
      } catch (e) {
        console.warn("No se pudo cargar el logo:", e);
      }

      const drawHeaderBar = () => {
        const startY = y;
        
        if (logoImg) {
          const maxW = 120;
          const maxH = 60;
          const imgRatio = logoImg.width / logoImg.height;
          
          let wLogo, hLogo;
          if (imgRatio > maxW / maxH) {
            wLogo = maxW;
            hLogo = maxW / imgRatio;
          } else {
            hLogo = maxH;
            wLogo = maxH * imgRatio;
          }
          
          page.drawImage(logoImg, { 
            x: margin, 
            y: y - hLogo + 15,
            width: wLogo, 
            height: hLogo 
          });
        }

        page.drawText(labelTipo, { 
          x: width - margin - textWidth(labelTipo, 18, bold), 
          y: y, 
          size: 18, 
          font: bold,
          color: rgb(0.2, 0.2, 0.2)
        });
        
        y -= line * 1.2;
        
        if (documento.numero) {
          const numText = `N° ${documento.numero}`;
          page.drawText(numText, { 
            x: width - margin - textWidth(numText, 12, bold), 
            y: y, 
            size: 12, 
            font: bold,
            color: rgb(0.4, 0.4, 0.4)
          });
        }
        
        y -= line * 1.5;
        
        page.drawLine({
          start: { x: margin, y },
          end: { x: width - margin, y },
          thickness: 1.5,
          color: rgb(1, 0.4, 0),
        });
        
        y -= line;
      };

      drawHeaderBar();

      

      const small = 10;
      const empresaX = margin;
      const infoY = y;
      
      page.drawText("DATOS DE LA EMPRESA", { 
        x: empresaX, 
        y, 
        size: 11, 
        font: bold,
        color: rgb(0.3, 0.3, 0.3)
      });
      y -= line * 1.2;
      
      page.drawText(`RUT: ${empresaData.rut}`, { x: empresaX, y, size: small, font });
      y -= line;
      page.drawText(`Dirección: ${empresaData.direccion}`, { x: empresaX, y, size: small, font });
      y -= line;
      page.drawText(`Ciudad: ${empresaData.ciudad}`, { x: empresaX, y, size: small, font });
      y -= line;
      page.drawText(`Teléfono: ${empresaData.telefono}`, { x: empresaX, y, size: small, font });
      y -= line;
      page.drawText(`Web: ${empresaData.web}`, { x: empresaX, y, size: small, font, color: rgb(0, 0.4, 0.8) });
      
      const fechaY = infoY;
      page.drawText("FECHA DE EMISIÓN", { 
        x: width - margin - textWidth("FECHA DE EMISIÓN", 11, bold), 
        y: fechaY, 
        size: 11, 
        font: bold,
        color: rgb(0.3, 0.3, 0.3)
      });
      const fechaText = documento.fecha || todayISO();
      page.drawText(fechaText, { 
        x: width - margin - textWidth(fechaText, small, font), 
        y: fechaY - line * 1.2, 
        size: small, 
        font 
      });
      
      y -= line * 2;

      // 📋 SECCIÓN CONSOLIDADA: Info de OT (Cotización + OC + Cliente)
      if (documento.tipo === "orden_trabajo") {
        const cotRelacionada = documento.cotizacionId
          ? cotizaciones.find(c => c.id === documento.cotizacionId)
          : null;

        const hayInfoOC = documento.ocNumero || documento.ocFecha || documento.ocMontoNeto || documento.ocObservacion;
        const hayCliente = documento.cliente;
        // Migración: si existe facturaVenta (objeto antiguo), convertir a array
        let facturasVentaArray = [];
        if (documento.facturasVenta && Array.isArray(documento.facturasVenta)) {
          facturasVentaArray = documento.facturasVenta.filter(f => f.codigo || f.rut || f.monto);
        } else if (documento.facturaVenta && (documento.facturaVenta.codigo || documento.facturaVenta.rut || documento.facturaVenta.monto)) {
          // Migración automática de objeto antiguo a array
          facturasVentaArray = [documento.facturaVenta];
        }
        const hayFacturas = facturasVentaArray.length > 0;

        if (cotRelacionada || hayInfoOC || hayCliente) {
          ensureSpace(line * 13);

          // Título de la sección
          page.drawText("INFORMACIÓN DE LA ORDEN DE TRABAJO", {
            x: margin, y, size: 11, font: bold, color: rgb(0.2, 0.2, 0.2)
          });
          y -= line * 1.8;

          // Rectángulo de fondo para toda la sección
          const boxStartY = y;
          const boxPadding = 12;
          const contentWidth = width - margin * 2;

          // Calcular altura aproximada del contenido
          let estimatedHeight = boxPadding * 2;
          if (cotRelacionada || hayInfoOC) estimatedHeight += line * 4.5;
          if (hayFacturas) estimatedHeight += line * (3 + facturasVentaArray.length * 3.5); // Espacio dinámico según cantidad de facturas
          if (hayCliente) estimatedHeight += line * 6.5;
          if ((documento.ocObservacion || "").trim() !== "") estimatedHeight += line * 3;

          // Dibujar rectángulo de fondo
          page.drawRectangle({
            x: margin,
            y: boxStartY - estimatedHeight,
            width: contentWidth,
            height: estimatedHeight,
            color: rgb(0.97, 0.97, 0.97),
            borderColor: rgb(0.85, 0.85, 0.85),
            borderWidth: 1,
          });

          y -= boxPadding;

          // Datos en formato compacto (2 columnas)
          const col1X = margin + boxPadding;
          const col2X = margin + boxPadding + contentWidth / 2;
          let rowY = y;

          // Columna 1: Cotización + OC + Factura de Venta
          if (cotRelacionada || hayInfoOC) {
            const ocData = [];

            if (cotRelacionada) {
              ocData.push(["Cotización asociada:", cotRelacionada.numero || cotRelacionada.id.slice(0, 6)]);
            }
            if (documento.ocNumero) {
              ocData.push(["OC:", documento.ocNumero]);
            }
            if (documento.ocFecha) {
              ocData.push(["Fecha:", documento.ocFecha]);
            }
            if (documento.ocMontoNeto) {
              ocData.push(["Neto:", fmtMoney(documento.ocMontoNeto)]);
            }

            for (const [lbl, val] of ocData) {
              page.drawText(lbl, { x: col1X, y: rowY, size: 9, font: bold, color: rgb(0.2, 0.2, 0.2) });
              page.drawText(val, { x: col1X + 115, y: rowY, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
              rowY -= line * 1.1;
            }

            // ✅ Facturas de Venta Asociadas (array múltiple)
            if (hayFacturas) {
              // Línea separadora
              rowY -= line * 0.3;
              page.drawLine({
                start: { x: col1X, y: rowY },
                end: { x: col1X + 220, y: rowY },
                thickness: 0.5,
                color: rgb(0.7, 0.7, 0.7),
              });
              rowY -= line * 0.8;

              const tituloFacturas = facturasVentaArray.length === 1 ? "Factura de Venta:" : `Facturas de Venta (${facturasVentaArray.length}):`;
              page.drawText(tituloFacturas, {
                x: col1X,
                y: rowY,
                size: 9,
                font: bold,
                color: rgb(0, 0.5, 0.3)
              });
              rowY -= line * 1.1;

              // Iterar sobre todas las facturas
              facturasVentaArray.forEach((factura, index) => {
                const facturaData = [];
                if (factura.codigo) {
                  facturaData.push(["Código:", factura.codigo]);
                }
                if (factura.rut) {
                  facturaData.push(["RUT:", factura.rut]);
                }
                if (factura.monto) {
                  facturaData.push(["Monto:", fmtMoney(factura.monto)]);
                }

                for (const [lbl, val] of facturaData) {
                  page.drawText(lbl, { x: col1X, y: rowY, size: 8.5, font: bold, color: rgb(0.2, 0.2, 0.2) });
                  page.drawText(val, { x: col1X + 55, y: rowY, size: 8.5, font, color: rgb(0.3, 0.3, 0.3) });
                  rowY -= line * 1.0;
                }

                // Separador entre facturas (si hay más de una)
                if (index < facturasVentaArray.length - 1) {
                  rowY -= line * 0.3;
                }
              });
            }
          }

          // Columna 2: Trabajo para (Cliente)
          let col2Y = y;
          if (hayCliente) {
            page.drawText("Trabajo para:", {
              x: col2X,
              y: col2Y,
              size: 9,
              font: bold,
              color: rgb(0.2, 0.2, 0.2)
            });
            col2Y -= line * 1.1;

            const clienteData = [
              ["Nombre:", documento.cliente.nombre],
              ["Empresa:", documento.cliente.empresa],
              ["RUT:", documento.cliente.rut],
              ["Dirección:", documento.cliente.direccion],
              ["Ciudad:", documento.cliente.ciudad],
              ["Teléfono:", documento.cliente.telefono],
            ];

            for (const [lbl, val] of clienteData) {
              if (val) {
                page.drawText(lbl, { x: col2X, y: col2Y, size: 8.5, font: bold, color: rgb(0.2, 0.2, 0.2) });
                page.drawText(val, { x: col2X + 60, y: col2Y, size: 8.5, font, color: rgb(0.3, 0.3, 0.3) });
                col2Y -= line * 0.95;
              }
            }
          }

          // Ajustar y al final de la sección más larga
          y = Math.min(rowY, col2Y) - line * 0.5;

          // Observaciones (ancho completo, dentro del rectángulo)
          if ((documento.ocObservacion || "").trim() !== "") {
            // Línea separadora
            page.drawLine({
              start: { x: margin + boxPadding, y },
              end: { x: margin + contentWidth - boxPadding, y },
              thickness: 0.5,
              color: rgb(0.8, 0.8, 0.8),
            });
            y -= line * 0.8;

            page.drawText("Observaciones:", {
              x: col1X,
              y,
              size: 9,
              font: bold,
              color: rgb(0.2, 0.2, 0.2)
            });
            y -= line * 1.0;

            const obsLines = wrapText(documento.ocObservacion, contentWidth - boxPadding * 4, 8.5, font);
            for (const l of obsLines) {
              page.drawText(l, {
                x: col1X,
                y,
                size: 8.5,
                font,
                color: rgb(0.4, 0.4, 0.4)
              });
              y -= line * 0.9;
            }
          }

          y -= boxPadding + line;
        }
      }

      // Para Cotizaciones y OC: mantener formato original
      if (documento.tipo !== "orden_trabajo" && documento.cliente) {
        ensureSpace(line * 9);

        page.drawText(
          documento.tipo === "cotizacion" ? "COTIZACIÓN PARA:" : "ENVIAR A:",
          { x: margin, y, size: 11, font: bold, color: rgb(0.3, 0.3, 0.3) }
        );
        y -= line * 1.2;

        const clienteInfo = [
          { label: "Nombre:", value: documento.cliente.nombre },
          { label: "Empresa:", value: documento.cliente.empresa },
          { label: "RUT:", value: documento.cliente.rut },
          { label: "Dirección:", value: documento.cliente.direccion },
          { label: "Ciudad:", value: documento.cliente.ciudad },
          { label: "Teléfono:", value: documento.cliente.telefono },
        ];

        for (const info of clienteInfo) {
          ensureSpace(line);
          page.drawText(info.label, { x: margin, y, size: small, font: bold });
          page.drawText(info.value || "-", {
            x: margin + 70,
            y,
            size: small,
            font,
            color: rgb(0.2, 0.2, 0.2)
          });
          y -= line;
        }

        y -= line;
      }

      y -= line;
      
      const innerW = width - margin * 2;
      const W = { 
        codigo: 65, 
        cant: 50, 
        desc: 210, 
        pUnit: 80, 
        total: 80 
      };
      
      const X = {
        codigo: margin,
        cant: margin + W.codigo,
        desc: margin + W.codigo + W.cant,
        pUnit: margin + W.codigo + W.cant + W.desc,
        total: margin + W.codigo + W.cant + W.desc + W.pUnit,
        right: margin + innerW,
      };

      const drawTableHeader = () => {
        // NO llamar ensureSpace aquí - se asume que ya hay espacio
        // (esta función solo se llama después de crear una nueva página)

        page.drawRectangle({
          x: margin,
          y: y - line - 2,
          width: innerW,
          height: line + 8,
          color: rgb(0.95, 0.95, 0.95),
        });
        
        y -= 4;
        
        page.drawText("Código", { x: X.codigo, y, size: 10, font: bold });
        page.drawText("Cant.", { x: X.cant + 5, y, size: 10, font: bold });
        page.drawText("Descripción", { x: X.desc, y, size: 10, font: bold });
        
        const pUnitText = "Precio Unit.";
        const pUnitW = textWidth(pUnitText, 10, bold);
        page.drawText(pUnitText, { 
          x: X.pUnit + W.pUnit - pUnitW - 5, 
          y, 
          size: 10, 
          font: bold 
        });
        
        const totalText = "Total";
        const totalW = textWidth(totalText, 10, bold);
        page.drawText(totalText, { 
          x: X.total + W.total - totalW - 5, 
          y, 
          size: 10, 
          font: bold 
        });
        
        y -= line;
        
        page.drawLine({
          start: { x: margin, y },
          end: { x: margin + innerW, y },
          thickness: 1,
          color: rgb(0.7, 0.7, 0.7),
        });
        
        y -= 8;
      };

      const drawItemRow = (it, index) => {
        const codigo = it.codigo || "-";
        const cantidad = String(Number(it.cantidad || 0));
        const descLines = wrapText(it.descripcion || "-", W.desc - 10, 9, font);
        // Usar el texto formateado si existe, sino formatear el número
        const precioTxt = it.precioUnitarioTexto || fmtMoney(Number(it.precioUnitario || 0));
        const totalTxt = fmtMoney(Number(it.valorTotal || 0));

        const rowHeight = Math.max(descLines.length * line, line * 1.5);
        
        ensureSpace(rowHeight + 12, true);
        
        if (index % 2 === 0) {
          page.drawRectangle({
            x: margin,
            y: y - rowHeight - 4,
            width: innerW,
            height: rowHeight + 8,
            color: rgb(0.98, 0.98, 0.98),
          });
        }
        
        y -= 4;
        
        const rowStartY = y;
        
        page.drawText(codigo, { x: X.codigo, y: rowStartY, size: 9, font });
        
        const cantW = textWidth(cantidad, 9, font);
        page.drawText(cantidad, { 
          x: X.cant + (W.cant / 2) - (cantW / 2), 
          y: rowStartY, 
          size: 9, 
          font 
        });
        
        let yDesc = rowStartY;
        for (const dl of descLines) {
          page.drawText(dl, { x: X.desc, y: yDesc, size: 9, font });
          yDesc -= line;
        }
        
        drawRight(page, precioTxt, X.pUnit + W.pUnit - 5, rowStartY, 9, font);
        drawRight(page, totalTxt, X.total + W.total - 5, rowStartY, 9, bold);

        y -= rowHeight;
        y -= 8;
      };

      // Asegurar espacio antes de la tabla
      ensureSpace(line * 5);
      drawTableHeader();
      // Limitar a 500 items para evitar loops infinitos
      const items = (documento.items || []).slice(0, 500);
      items.forEach((item, idx) => drawItemRow(item, idx));

      ensureSpace(line * 6);

      y -= line * 1.5;

      page.drawLine({
        start: { x: margin, y },
        end: { x: margin + innerW, y },
        thickness: 2,
        color: rgb(1, 0.4, 0),
      });

      y -= line * 2;

      page.drawRectangle({
        x: X.pUnit - 10,
        y: y - line - 4,
        width: W.pUnit + W.total + 15,
        height: line + 12,
        color: rgb(1, 0.95, 0.9),
      });

      y -= 4;

      page.drawText("VALOR TOTAL NETO", { 
        x: X.desc,
        y, 
        size: 12, 
        font: bold,
        color: rgb(0.2, 0.2, 0.2)
      });

      const totalFinal = fmtMoney(documento.totalNeto || 0);
      drawRight(page, totalFinal, X.right - 10, y, 14, bold, rgb(1, 0.4, 0));

      // ✅ NUEVO: Sección personalizable
      y -= line * 3;

      // ✅ STEP 1: Calcular todas las líneas de texto PRIMERO
      const incluyeLines = wrapText(documento.incluye || "Precios sin IVA", innerW - 20, 9, font);
      const faenaText = `Faena: ${documento.faena || "Interior de planta Generación"}`;
      const faenaLines = wrapText(faenaText, innerW - 20, 9, font);
      const notaText = `Nota: ${documento.nota || "4 días hábiles de trabajo y con bloqueos de seguridad requeridos para la faena"}`;
      const notaLines = wrapText(notaText, innerW - 20, 9, font);
      const formaPagoText = `FORMA DE PAGO: ${documento.formaPago || "45 DÍAS HÁBILES CONTRA ORDEN DE COMPRA"}`;
      const formaPagoLines = wrapText(formaPagoText, innerW - 20, 9, font);

      // ✅ STEP 2: Calcular la altura dinámica basada en el contenido real
      const totalLines =
        1 + // "Incluye:" título
        incluyeLines.length +
        0.2 + // spacing
        faenaLines.length +
        0.2 + // spacing
        notaLines.length +
        0.5 + // spacing
        formaPagoLines.length +
        2; // padding inferior

      const infoBoxHeight = totalLines * line + line * 0.8; // altura dinámica + padding superior

      ensureSpace(infoBoxHeight + line * 2);

      const infoBoxY = y;

      // ✅ STEP 3: Dibujar el rectángulo con altura dinámica
      page.drawRectangle({
        x: margin,
        y: y - infoBoxHeight,
        width: innerW,
        height: infoBoxHeight,
        borderColor: rgb(0.7, 0.7, 0.7),
        borderWidth: 1,
      });

      y -= line * 0.8;

      // ✅ STEP 4: Dibujar el texto (usando las líneas ya calculadas)
      page.drawText("Incluye:", { x: margin + 10, y, size: 10, font: bold });
      y -= line;
      for (let i = 0; i < incluyeLines.length; i++) {
        page.drawText(incluyeLines[i], { x: margin + 10, y, size: 9, font });
        y -= line;
      }

      y -= line * 0.2;
      for (let i = 0; i < faenaLines.length; i++) {
        page.drawText(faenaLines[i], { x: margin + 10, y, size: 9, font: bold });
        y -= line;
      }

      y -= line * 0.2;
      for (let i = 0; i < notaLines.length; i++) {
        page.drawText(notaLines[i], { x: margin + 10, y, size: 9, font });
        y -= line;
      }

      y -= line * 0.5;
      for (let i = 0; i < formaPagoLines.length; i++) {
        page.drawText(formaPagoLines[i], {
          x: margin + 10,
          y,
          size: 9,
          font: bold
        });
        y -= line;
      }

      y -= line * 2;

      // ✅ Separación clara entre el cuadro negro y las condiciones comerciales
      y -= line * 2; // Espacio adicional de separación

      // ✅ NUEVO: Condiciones Comerciales Editables (fuera del cuadro negro)
      if ((documento.condicionesComerciales || "").trim()) {
        // Verificar espacio antes de dibujar el título
        ensureSpace(line * 4);

        const tituloCondiciones = isMyOrganic
          ? "CONDICIONES COMERCIALES – MYORGANIC"
          : isAvar
          ? "CONDICIONES COMERCIALES – AVAR"
          : "CONDICIONES COMERCIALES – MEG MONTAJES";

        // Calcular todas las líneas primero para estimar espacio
        const lineasOriginales = documento.condicionesComerciales.split('\n').slice(0, 100); // Limitar a 100 líneas
        const todasLasLineas = [];

        for (const lineaOriginal of lineasOriginales) {
          if (lineaOriginal.trim() === '') {
            todasLasLineas.push(null); // null = línea vacía
          } else {
            const lineasWrapped = wrapText(lineaOriginal, innerW - 20, 9, font);
            if (lineasWrapped && lineasWrapped.length > 0) {
              todasLasLineas.push(...lineasWrapped);
            }
          }
        }

        page.drawText(tituloCondiciones, {
          x: margin,
          y,
          size: 11,
          font: bold,
          color: rgb(0.2, 0.2, 0.2)
        });

        y -= line * 1.5;

        // Renderizar línea por línea
        for (let i = 0; i < todasLasLineas.length && i < 200; i++) { // Máximo 200 líneas renderizadas
          const linea = todasLasLineas[i];

          // Usar ensureSpace para verificar espacio antes de dibujar
          ensureSpace(line + 10);

          if (linea === null) {
            // Línea vacía
            y -= line;
          } else {
            // Dibujar texto
            page.drawText(linea, {
              x: margin + 10,
              y,
              size: 9,
              font,
              color: rgb(0.2, 0.2, 0.2)
            });
            y -= line;
          }
        }

        y -= line * 0.5;
      }

      y -= line * 2;

      y -= line * 3;

      // Asegurar espacio para el footer usando ensureSpace
      ensureSpace(50);
      
      const footerY = margin - 10;
      page.drawLine({
        start: { x: margin, y: footerY + 20 },
        end: { x: width - margin, y: footerY + 20 },
        thickness: 0.5,
        color: rgb(0.8, 0.8, 0.8),
      });
      
      const footerText = `Documento generado el ${new Date().toLocaleDateString('es-CL')} | ${isMyOrganic ? "MyOrganic" : isAvar ? "AVAR" : "MEG Industrial"}`;
      const footerW = textWidth(footerText, 8, font);
      page.drawText(footerText, {
        x: (width - footerW) / 2,
        y: footerY + 8,
        size: 8,
        font,
        color: rgb(0.6, 0.6, 0.6),
      });

      const pdfBytes = await pdfDoc.save();
      return {
        bytes: pdfBytes,
        nombre: `${labelTipo.toLowerCase().replace(/ /g, '-')}-${documento.numero || Date.now()}.pdf`,
        wasTruncated
      };
  };

  /* ===== Exportar PDF (descargar) ===== */
  const exportarPDF = async (documento) => {
    try {
      // Timeout de seguridad: 60 segundos
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout: La generación del PDF tomó demasiado tiempo (>60s)')), 60000)
      );

      const pdfPromise = generarPDF(documento);
      const { bytes, nombre, wasTruncated } = await Promise.race([pdfPromise, timeoutPromise]);

      const blob = new Blob([bytes], { type: "application/pdf" });
      saveAs(blob, nombre);

      if (wasTruncated) {
        toast.warning('Advertencia: Algunos textos fueron truncados por ser demasiado largos. Revisa el PDF generado.');
      }
    } catch (err) {
      console.error("Error al generar PDF:", err);
      toast.error(`Error al generar el PDF: ${err.message}`);
    }
  };

  /* ===== Vista previa PDF ===== */
  const [pdfPreview, setPdfPreview] = useState(null);

  const abrirVistaPreviaPDF = async (documento) => {
    try {
      // Timeout de seguridad: 60 segundos
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout: La generación del PDF tomó demasiado tiempo (>60s)')), 60000)
      );

      const pdfPromise = generarPDF(documento);
      const { bytes, nombre, wasTruncated } = await Promise.race([pdfPromise, timeoutPromise]);

      if (wasTruncated) {
        toast.warning('Advertencia: Algunos textos fueron truncados por ser demasiado largos. Revisa el PDF generado.');
      }

      if (window.electronAPI) {
        // En Electron: abrir con visor del sistema
        // Convertir bytes a base64 en chunks para evitar stack overflow
        const CHUNK_SIZE = 8192; // Procesar 8KB a la vez
        let binary = '';

        for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
          const chunk = bytes.slice(i, i + CHUNK_SIZE);
          binary += String.fromCharCode.apply(null, chunk);
        }

        const base64 = btoa(binary);
        const dataUrl = `data:application/pdf;base64,${base64}`;

        const result = await window.electronAPI.openPDF({
          name: nombre,
          dataUrl: dataUrl
        });

        if (!result.success) {
          toast.error('Error al abrir el PDF: ' + (result.message || 'Error desconocido'));
        }
      } else {
        // Fallback para navegador: usar el Dialog
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        setPdfPreview({ url, nombre });
      }
    } catch (err) {
      console.error("Error al generar vista previa:", err);
      toast.error(`Error al generar la vista previa: ${err.message}`);
    }
  };

  const cerrarVistaPreviaPDF = () => {
    if (pdfPreview?.url) {
      URL.revokeObjectURL(pdfPreview.url);
    }
    setPdfPreview(null);
  };

  /* ===== Funciones de ordenamiento ===== */
  const ordenarPorFecha = (documentos) => {
    return [...documentos].sort((a, b) => {
      const fechaA = a.fecha || "";
      const fechaB = b.fecha || "";
      
      const comparacionFecha = fechaB.localeCompare(fechaA);
      
      if (comparacionFecha === 0) {
        const numeroA = a.numero || "";
        const numeroB = b.numero || "";
        return numeroB.localeCompare(numeroA);
      }
      
      return comparacionFecha;
    });
  };

  const paginarDocumentos = (documentos, pagina, itemsPorPagina = ITEMS_POR_PAGINA) => {
    const inicio = (pagina - 1) * itemsPorPagina;
    const fin = inicio + itemsPorPagina;
    const paginados = documentos.slice(inicio, fin);
    const totalPaginas = Math.ceil(documentos.length / itemsPorPagina);
    
    return { paginados, totalPaginas, total: documentos.length };
  };

  const brandConfig = getBrandConfig(authUser?.userKey);

  // Mostrar loading mientras carga
  if (isLoading || !isAuthenticated) {
    return <div className="min-h-screen bg-slate-50" />;
  }


  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 text-slate-900">
      <header
        className="sticky top-0 z-20 text-white shadow-soft-lg backdrop-blur-sm animate-fade-in-down"
        style={{
          background: `linear-gradient(135deg, ${brandConfig.primaryColor} 0%, ${brandConfig.accentColor} 100%)`
        }}
      >
        <div className="max-w-7xl mx-auto px-8 py-5">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-4 animate-fade-in">
              <div className="relative group">
                <div className="absolute inset-0 bg-white blur-xl opacity-30 group-hover:opacity-50 transition-opacity duration-300"></div>
                <img
                  src={brandConfig.logo}
                  alt={brandConfig.name}
                  className="relative h-12 w-auto object-contain bg-white rounded-xl px-3 py-2 shadow-lg transform group-hover:scale-105 transition-transform duration-300"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight drop-shadow-lg">
                  {brandConfig.name}
                </h1>
               
              </div>
            </div>

            <div className="flex items-center gap-3 animate-fade-in">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => navigate('/')}
                className="bg-white/20 hover:bg-white/30 text-white border-white/30 backdrop-blur-sm transition-all duration-300 group font-medium"
              >
                <LayoutDashboard className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform duration-300" />
                Volver al Principal
              </Button>
              <span className="px-4 py-2 rounded-xl bg-white/20 backdrop-blur-sm text-sm font-semibold shadow-soft">
                {authUser?.company || 'Usuario'}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  logout();
                  navigate('/');
                }}
                className="text-white hover:bg-red-500/30 transition-all duration-300 group font-medium rounded-xl"
              >
                <LogOut className="w-4 h-4 mr-2 group-hover:translate-x-1 transition-transform duration-300" />
                Cerrar sesión
              </Button>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v)}>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <TabsList className="flex w-full md:w-auto gap-2 bg-white/15 backdrop-blur-md p-1.5 rounded-2xl border border-white/20 shadow-soft">
                <TabsTrigger
                  value="clientes"
                  className="rounded-xl px-5 py-2.5 text-sm text-white/90 font-medium data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-lg transition-all duration-300 data-[state=active]:scale-105"
                >
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    <span>Proveedores</span>
                  </div>
                </TabsTrigger>
                <TabsTrigger
                  value="cotizaciones"
                  className="rounded-xl px-5 py-2.5 text-sm text-white/90 font-medium data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-lg transition-all duration-300 data-[state=active]:scale-105"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    <span>Cotizaciones</span>
                  </div>
                </TabsTrigger>
                <TabsTrigger
                  value="ordenes-compra"
                  className="rounded-xl px-5 py-2.5 text-sm text-white/90 font-medium data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-lg transition-all duration-300 data-[state=active]:scale-105"
                >
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4" />
                    <span>Órdenes de Compra</span>
                  </div>
                </TabsTrigger>
                <TabsTrigger
                  value="ordenes-trabajo"
                  className="rounded-xl px-5 py-2.5 text-sm text-white/90 font-medium data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-lg transition-all duration-300 data-[state=active]:scale-105"
                >
                  <div className="flex items-center gap-2">
                    <Wrench className="w-4 h-4" />
                    <span>Órdenes de Trabajo</span>
                  </div>
                </TabsTrigger>
              </TabsList>
            </div>
          </Tabs>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v)}>
          {/* ===== CLIENTES/PROVEEDORES ===== */}
          <TabsContent value="clientes">
            <div className="grid lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-1 shadow-sm border border-slate-200 bg-white">
                <CardContent className="p-6">
                  <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                    <div 
                      className="w-1 h-6 rounded-full" 
                      style={{ backgroundColor: brandConfig.primaryColor }}
                    />
                    {/* ✅ CAMBIO: Cliente → Proveedor */}
                    Registrar Nuevo Proveedor
                  </h2>
                  <div className="grid grid-cols-1 gap-4 mb-4">
                    <div><Label>Nombre</Label><Input value={nuevoCliente.nombre} onChange={(e) => setNuevoCliente({...nuevoCliente, nombre: e.target.value})} /></div>
                    <div><Label>Empresa</Label><Input value={nuevoCliente.empresa} onChange={(e) => setNuevoCliente({...nuevoCliente, empresa: e.target.value})} /></div>
                    <div><Label>RUT</Label><Input value={nuevoCliente.rut} onChange={(e) => setNuevoCliente({...nuevoCliente, rut: e.target.value})} /></div>
                    <div><Label>Dirección</Label><Input value={nuevoCliente.direccion} onChange={(e) => setNuevoCliente({...nuevoCliente, direccion: e.target.value})} /></div>
                    <div className="grid grid-cols-2 gap-4">
                      <div><Label>Ciudad</Label><Input value={nuevoCliente.ciudad} onChange={(e) => setNuevoCliente({...nuevoCliente, ciudad: e.target.value})} /></div>
                      <div><Label>Teléfono</Label><Input value={nuevoCliente.telefono} onChange={(e) => setNuevoCliente({...nuevoCliente, telefono: e.target.value})} /></div>
                    </div>
                    <div><Label>Correo (opcional)</Label><Input value={nuevoCliente.correo} onChange={(e) => setNuevoCliente({...nuevoCliente, correo: e.target.value})} /></div>
                  </div>
                  <div className="flex justify-end gap-2">
                    {clienteEnEdicion && (
                      <Button
                        type="button"
                        onClick={() => {
                          setClienteEnEdicion(null);
                          setNuevoCliente({ nombre: "", empresa: "", rut: "", direccion: "", ciudad: "", telefono: "", correo: "" });
                        }}
                        variant="outline"
                      >
                        Cancelar
                      </Button>
                    )}
                    <Button
                      type="button"
                      onClick={agregarCliente}
                      style={{ backgroundColor: brandConfig.primaryColor }}
                      className="text-white hover:opacity-90"
                    >
                      {clienteEnEdicion ? "Actualizar Proveedor" : "Agregar Proveedor"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2 shadow-sm border border-slate-200 bg-white">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                      <div 
                        className="w-1 h-6 rounded-full" 
                        style={{ backgroundColor: brandConfig.primaryColor }}
                      />
                      Lista de Proveedores
                    </h2>
                    {loading && <span className="text-xs px-2 py-1 rounded bg-slate-100 border">Cargando…</span>}
                  </div>
                  <div className="overflow-x-auto">
                    <Table className="min-w-[720px]">
                      <TableHeader className="sticky top-0 bg-slate-50">
                        <TableRow>
                          <TableHead>Nombre</TableHead>
                          <TableHead>Empresa</TableHead>
                          <TableHead>RUT</TableHead>
                          <TableHead>Dirección</TableHead>
                          <TableHead>Ciudad</TableHead>
                          <TableHead>Teléfono</TableHead>
                          <TableHead>Correo</TableHead>
                          <TableHead>Acciones</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {clientes.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={8} className="text-center text-slate-500 py-8">Sin proveedores registrados</TableCell>
                          </TableRow>
                        ) : clientes.map(cliente => (
                          <TableRow key={cliente.id} className="hover:bg-slate-50">
                            <TableCell className="font-medium">{cliente.nombre}</TableCell>
                            <TableCell>{cliente.empresa}</TableCell>
                            <TableCell>{cliente.rut}</TableCell>
                            <TableCell>{cliente.direccion}</TableCell>
                            <TableCell>{cliente.ciudad}</TableCell>
                            <TableCell>{cliente.telefono}</TableCell>
                            <TableCell className="truncate max-w-[180px]">{cliente.correo}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex gap-1 justify-end">
                                <Button type="button" variant="ghost" size="sm" onClick={() => editarCliente(cliente)}>
                                  <Pencil size={16} className="text-blue-500" />
                                </Button>
                                <Button type="button" variant="ghost" size="sm" onClick={() => eliminarCliente(cliente.id)}>
                                  <Trash2 size={16} className="text-red-500" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ===== COTIZACIONES ===== */}
          <TabsContent value="cotizaciones">
            <div className="flex justify-between mb-6">
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <div 
                  className="w-1.5 h-8 rounded-full" 
                  style={{ backgroundColor: brandConfig.primaryColor }}
                />
                Cotizaciones
              </h2>
              <Button 
                type="button" 
                onClick={() => crearDocumento("cotizacion")}
                style={{ backgroundColor: brandConfig.primaryColor }}
                className="text-white hover:opacity-90"
              >
                + Nueva Cotización
              </Button>
            </div>

            <Card className="mb-6 shadow-sm border border-slate-200 bg-white">
              <CardContent className="p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <div 
                    className="w-1 h-5 rounded-full" 
                    style={{ backgroundColor: brandConfig.primaryColor }}
                  />
                  Filtros
                </h3>
                <div className="grid md:grid-cols-4 gap-4">
                  <div>
                    <Label>Proveedor/Empresa</Label>
                    <Input
                      placeholder="Buscar..."
                      value={filtrosCot.cliente}
                      onChange={(e) => setFiltrosCot({ ...filtrosCot, cliente: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>RUT</Label>
                    <Input
                      placeholder="12.345.678-9"
                      value={filtrosCot.rut}
                      onChange={(e) => setFiltrosCot({ ...filtrosCot, rut: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Desde</Label>
                    <Input
                      type="date"
                      value={filtrosCot.desde}
                      onChange={(e) => setFiltrosCot({ ...filtrosCot, desde: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Hasta</Label>
                    <Input
                      type="date"
                      value={filtrosCot.hasta}
                      onChange={(e) => setFiltrosCot({ ...filtrosCot, hasta: e.target.value })}
                    />
                  </div>
                </div>
                {(filtrosCot.cliente || filtrosCot.rut || filtrosCot.desde || filtrosCot.hasta) && (
                  <div className="mt-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setFiltrosCot({ cliente: "", rut: "", desde: "", hasta: "" })}
                    >
                      Limpiar filtros
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {(() => {
              const ordenadas = ordenarPorFecha(cotizacionesFiltradas);
              const { paginados, totalPaginas, total } = paginarDocumentos(ordenadas, paginaCot);

              if (ordenadas.length === 0) {
                return (
                  <Card className="shadow-sm border border-slate-200 bg-white">
                    <CardContent className="p-12 text-center">
                      <p className="text-slate-500 text-lg">No hay cotizaciones que coincidan con los filtros</p>
                    </CardContent>
                  </Card>
                );
              }

              return (
                <>
                  <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {paginados.map(cot => (
                      <Card key={cot.id} className="shadow-sm border border-slate-200 bg-white hover:shadow-md transition-all hover:border-slate-300">
                        <CardContent className="p-5">
                          <div className="flex justify-between items-start gap-4 mb-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <div 
                                  className="w-1 h-5 rounded-full" 
                                  style={{ backgroundColor: brandConfig.primaryColor }}
                                />
                                <h3 className="font-semibold text-lg">
                                  {cot.numero || `Cotización #${cot.id.slice(0, 4)}`}
                                </h3>
                              </div>
                              <p className="text-sm text-slate-500">📅 {cot.fecha}</p>
                            </div>
                          </div>
                          <div className="text-sm space-y-2 mb-4 p-3 bg-slate-50 rounded-lg">
                            <p><span className="font-medium text-slate-600">Proveedor:</span> {cot.cliente?.nombre || "—"}</p>
                            <p><span className="font-medium text-slate-600">Empresa:</span> {cot.cliente?.empresa || "—"}</p>
                            <p className="text-base font-bold" style={{ color: brandConfig.primaryColor }}>
                              Total: {fmtMoney(cot.totalNeto)}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => setEditRef({ id: cot.id, tipo: "cotizacion" })}
                              className="flex-1"
                            >
                              ✏️ Editar
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => abrirVistaPreviaPDF(cot)}
                              className="flex-1"
                              style={{
                                borderColor: brandConfig.primaryColor,
                                color: brandConfig.primaryColor
                              }}
                            >
                              👁️ Vista previa
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => exportarPDF(cot)}
                              className="flex-1"
                              style={{
                                borderColor: brandConfig.primaryColor,
                                color: brandConfig.primaryColor
                              }}
                            >
                              📄 Descargar
                            </Button>
                            <Button 
                              type="button" 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => eliminarDocumento(cot.id, "cotizacion")}
                              className="text-red-500 hover:bg-red-50"
                            >
                              <Trash2 size={16} />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {totalPaginas > 1 && (
                    <Card className="mt-6 shadow-sm border border-slate-200 bg-white">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-slate-600">
                            Mostrando {((paginaCot - 1) * ITEMS_POR_PAGINA) + 1} - {Math.min(paginaCot * ITEMS_POR_PAGINA, total)} de {total} cotizaciones
                          </p>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setPaginaCot(p => Math.max(1, p - 1))}
                              disabled={paginaCot === 1}
                            >
                              ← Anterior
                            </Button>
                            
                            <div className="flex gap-1">
                              {Array.from({ length: totalPaginas }, (_, i) => i + 1).map(num => (
                                <Button
                                  key={num}
                                  type="button"
                                  variant={paginaCot === num ? "default" : "outline"}
                                  size="sm"
                                  onClick={() => setPaginaCot(num)}
                                  style={paginaCot === num ? { backgroundColor: brandConfig.primaryColor } : {}}
                                  className={paginaCot === num ? "text-white" : ""}
                                >
                                  {num}
                                </Button>
                              ))}
                            </div>

                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setPaginaCot(p => Math.min(totalPaginas, p + 1))}
                              disabled={paginaCot === totalPaginas}
                            >
                              Siguiente →
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              );
            })()}
          </TabsContent>

          {/* ===== ÓRDENES DE COMPRA ===== */}
          <TabsContent value="ordenes-compra">
            <div className="flex justify-between mb-6">
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <div 
                  className="w-1.5 h-8 rounded-full" 
                  style={{ backgroundColor: brandConfig.primaryColor }}
                />
                Órdenes de Compra
              </h2>
              <Button 
                type="button" 
                onClick={() => crearDocumento("orden_compra")}
                style={{ backgroundColor: brandConfig.primaryColor }}
                className="text-white hover:opacity-90"
              >
                + Nueva Orden de Compra
              </Button>
            </div>

            <Card className="mb-6 shadow-sm border border-slate-200 bg-white">
              <CardContent className="p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <div 
                    className="w-1 h-5 rounded-full" 
                    style={{ backgroundColor: brandConfig.primaryColor }}
                  />
                  Filtros
                </h3>
                <div className="grid md:grid-cols-4 gap-4">
                  <div>
                    <Label>Proveedor/Empresa</Label>
                    <Input
                      placeholder="Buscar..."
                      value={filtrosOC.cliente}
                      onChange={(e) => setFiltrosOC({ ...filtrosOC, cliente: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>RUT</Label>
                    <Input
                      placeholder="12.345.678-9"
                      value={filtrosOC.rut}
                      onChange={(e) => setFiltrosOC({ ...filtrosOC, rut: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Desde</Label>
                    <Input
                      type="date"
                      value={filtrosOC.desde}
                      onChange={(e) => setFiltrosOC({ ...filtrosOC, desde: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Hasta</Label>
                    <Input
                      type="date"
                      value={filtrosOC.hasta}
                      onChange={(e) => setFiltrosOC({ ...filtrosOC, hasta: e.target.value })}
                    />
                  </div>
                </div>
                {(filtrosOC.cliente || filtrosOC.rut || filtrosOC.desde || filtrosOC.hasta) && (
                  <div className="mt-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setFiltrosOC({ cliente: "", rut: "", desde: "", hasta: "" })}
                    >
                      Limpiar filtros
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {(() => {
              const ordenadas = ordenarPorFecha(ordenesCompraFiltradas);
              const { paginados, totalPaginas, total } = paginarDocumentos(ordenadas, paginaOC);

              if (ordenadas.length === 0) {
                return (
                  <Card className="shadow-sm border border-slate-200 bg-white">
                    <CardContent className="p-12 text-center">
                      <p className="text-slate-500 text-lg">No hay órdenes de compra que coincidan con los filtros</p>
                    </CardContent>
                  </Card>
                );
              }

              return (
                <>
                  <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {paginados.map(oc => (
                      <Card key={oc.id} className="shadow-sm border border-slate-200 bg-white hover:shadow-md transition-all hover:border-slate-300">
                        <CardContent className="p-5">
                          <div className="flex justify-between items-start gap-4 mb-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <div 
                                  className="w-1 h-5 rounded-full" 
                                  style={{ backgroundColor: brandConfig.primaryColor }}
                                />
                                <h3 className="font-semibold text-lg">
                                  {oc.numero || `Orden de Compra #${oc.id.slice(0, 4)}`}
                                </h3>
                              </div>
                              <p className="text-sm text-slate-500">📅 {oc.fecha}</p>
                            </div>
                          </div>
                          <div className="text-sm space-y-2 mb-4 p-3 bg-slate-50 rounded-lg">
                            <p><span className="font-medium text-slate-600">Proveedor:</span> {oc.cliente?.nombre || "—"}</p>
                            <p><span className="font-medium text-slate-600">Empresa:</span> {oc.cliente?.empresa || "—"}</p>
                            <p className="text-base font-bold" style={{ color: brandConfig.primaryColor }}>
                              Total: {fmtMoney(oc.totalNeto)}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => setEditRef({ id: oc.id, tipo: "orden_compra" })}
                              className="flex-1"
                            >
                              ✏️ Editar
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => abrirVistaPreviaPDF(oc)}
                              className="flex-1"
                              style={{
                                borderColor: brandConfig.primaryColor,
                                color: brandConfig.primaryColor
                              }}
                            >
                              👁️ Vista previa
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => exportarPDF(oc)}
                              className="flex-1"
                              style={{
                                borderColor: brandConfig.primaryColor,
                                color: brandConfig.primaryColor
                              }}
                            >
                              📄 Descargar
                            </Button>
                            <Button 
                              type="button" 
                              variant="ghost" 
                              size="sm" 
                              onClick={() => eliminarDocumento(oc.id, "orden_compra")}
                              className="text-red-500 hover:bg-red-50"
                            >
                              <Trash2 size={16} />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {totalPaginas > 1 && (
                    <Card className="mt-6 shadow-sm border border-slate-200 bg-white">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-slate-600">
                            Mostrando {((paginaOC - 1) * ITEMS_POR_PAGINA) + 1} - {Math.min(paginaOC * ITEMS_POR_PAGINA, total)} de {total} órdenes
                          </p>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setPaginaOC(p => Math.max(1, p - 1))}
                              disabled={paginaOC === 1}
                            >
                              ← Anterior
                            </Button>
                            
                            <div className="flex gap-1">
                              {Array.from({ length: totalPaginas }, (_, i) => i + 1).map(num => (
                                <Button
                                  key={num}
                                  type="button"
                                  variant={paginaOC === num ? "default" : "outline"}
                                  size="sm"
                                  onClick={() => setPaginaOC(num)}
                                  style={paginaOC === num ? { backgroundColor: brandConfig.primaryColor } : {}}
                                  className={paginaOC === num ? "text-white" : ""}
                                >
                                  {num}
                                </Button>
                              ))}
                            </div>

                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setPaginaOC(p => Math.min(totalPaginas, p + 1))}
                              disabled={paginaOC === totalPaginas}
                            >
                              Siguiente →
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              );
            })()}
          </TabsContent>

          {/* ✅ NUEVO: ÓRDENES DE TRABAJO */}
          <TabsContent value="ordenes-trabajo">
            <div className="flex justify-between mb-6">
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <div 
                  className="w-1.5 h-8 rounded-full" 
                  style={{ backgroundColor: brandConfig.primaryColor }}
                />
                Órdenes de Trabajo
              </h2>
              <Button 
                type="button" 
                onClick={() => crearDocumento("orden_trabajo")}
                style={{ backgroundColor: brandConfig.primaryColor }}
                className="text-white hover:opacity-90"
              >
                + Nueva Orden de Trabajo
              </Button>
            </div>

            <Card className="mb-6 shadow-sm border border-slate-200 bg-white">
              <CardContent className="p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <div 
                    className="w-1 h-5 rounded-full" 
                    style={{ backgroundColor: brandConfig.primaryColor }}
                  />
                  Filtros
                </h3>
                <div className="grid md:grid-cols-4 gap-4">
                  <div>
                    <Label>Proveedor/Empresa</Label>
                    <Input
                      placeholder="Buscar..."
                      value={filtrosOT.cliente}
                      onChange={(e) => setFiltrosOT({ ...filtrosOT, cliente: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>RUT</Label>
                    <Input
                      placeholder="12.345.678-9"
                      value={filtrosOT.rut}
                      onChange={(e) => setFiltrosOT({ ...filtrosOT, rut: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Desde</Label>
                    <Input
                      type="date"
                      value={filtrosOT.desde}
                      onChange={(e) => setFiltrosOT({ ...filtrosOT, desde: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Hasta</Label>
                    <Input
                      type="date"
                      value={filtrosOT.hasta}
                      onChange={(e) => setFiltrosOT({ ...filtrosOT, hasta: e.target.value })}
                    />
                  </div>
                </div>
                {(filtrosOT.cliente || filtrosOT.rut || filtrosOT.desde || filtrosOT.hasta) && (
                  <div className="mt-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setFiltrosOT({ cliente: "", rut: "", desde: "", hasta: "" })}
                    >
                      Limpiar filtros
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {(() => {
              const ordenadas = ordenarPorFecha(ordenesTrabajoFiltradas);
              const { paginados, totalPaginas, total } = paginarDocumentos(ordenadas, paginaOT);

              if (ordenadas.length === 0) {
                return (
                  <Card className="shadow-sm border border-slate-200 bg-white">
                    <CardContent className="p-12 text-center">
                      <p className="text-slate-500 text-lg">No hay órdenes de trabajo que coincidan con los filtros</p>
                    </CardContent>
                  </Card>
                );
              }

              return (
                <>
                  <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {paginados.map(ot => {
                      const cotRelacionada = ot.cotizacionId ? cotizaciones.find(c => c.id === ot.cotizacionId) : null;
                      
                      return (
                        <Card key={ot.id} className="shadow-sm border border-slate-200 bg-white hover:shadow-md transition-all hover:border-slate-300">
                          <CardContent className="p-5">
                            <div className="flex justify-between items-start gap-4 mb-3">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <div 
                                    className="w-1 h-5 rounded-full" 
                                    style={{ backgroundColor: brandConfig.primaryColor }}
                                  />
                                  <h3 className="font-semibold text-lg">
                                    {ot.numero || `Orden de Trabajo #${ot.id.slice(0, 4)}`}
                                  </h3>
                                </div>
                                <p className="text-sm text-slate-500">📅 {ot.fecha}</p>
                                {cotRelacionada && (
                                  <p className="text-xs text-slate-400 mt-1">
                                    📋 Basada en: {cotRelacionada.numero}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="text-sm space-y-2 mb-4 p-3 bg-slate-50 rounded-lg">
                              <p><span className="font-medium text-slate-600">Proveedor:</span> {ot.cliente?.nombre || "—"}</p>
                              <p><span className="font-medium text-slate-600">Empresa:</span> {ot.cliente?.empresa || "—"}</p>
                              <p className="text-base font-bold" style={{ color: brandConfig.primaryColor }}>
                                Total: {fmtMoney(ot.totalNeto)}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => setEditRef({ id: ot.id, tipo: "orden_trabajo" })}
                                className="flex-1"
                              >
                                ✏️ Editar
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => abrirVistaPreviaPDF(ot)}
                                className="flex-1"
                                style={{
                                  borderColor: brandConfig.primaryColor,
                                  color: brandConfig.primaryColor
                                }}
                              >
                                👁️ Vista previa
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => exportarPDF(ot)}
                                className="flex-1"
                                style={{
                                  borderColor: brandConfig.primaryColor,
                                  color: brandConfig.primaryColor
                                }}
                              >
                                📄 Descargar
                              </Button>
                              <Button 
                                type="button" 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => eliminarDocumento(ot.id, "orden_trabajo")}
                                className="text-red-500 hover:bg-red-50"
                              >
                                <Trash2 size={16} />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>

                  {totalPaginas > 1 && (
                    <Card className="mt-6 shadow-sm border border-slate-200 bg-white">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-slate-600">
                            Mostrando {((paginaOT - 1) * ITEMS_POR_PAGINA) + 1} - {Math.min(paginaOT * ITEMS_POR_PAGINA, total)} de {total} órdenes de trabajo
                          </p>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setPaginaOT(p => Math.max(1, p - 1))}
                              disabled={paginaOT === 1}
                            >
                              ← Anterior
                            </Button>
                            
                            <div className="flex gap-1">
                              {Array.from({ length: totalPaginas }, (_, i) => i + 1).map(num => (
                                <Button
                                  key={num}
                                  type="button"
                                  variant={paginaOT === num ? "default" : "outline"}
                                  size="sm"
                                  onClick={() => setPaginaOT(num)}
                                  style={paginaOT === num ? { backgroundColor: brandConfig.primaryColor } : {}}
                                  className={paginaOT === num ? "text-white" : ""}
                                >
                                  {num}
                                </Button>
                              ))}
                            </div>

                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setPaginaOT(p => Math.min(totalPaginas, p + 1))}
                              disabled={paginaOT === totalPaginas}
                            >
                              Siguiente →
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              );
            })()}
          </TabsContent>
        </Tabs>
      </main>

      {/* Modal Editor */}
      {documentoActual && editRef && (
        <DocumentoEditor
          documento={documentoActual}
          clientes={clientes}
          cotizaciones={cotizaciones}
          onSave={guardarDocumentoDesdeEditor}
          onClose={() => setEditRef(null)}
          brandConfig={brandConfig}
        />
      )}

      {/* Modal de Vista Previa PDF */}
      {pdfPreview && (
        <Dialog open={!!pdfPreview} onOpenChange={cerrarVistaPreviaPDF}>
          <DialogContent className="max-w-6xl h-[90vh] p-0">
            <DialogHeader className="p-4 border-b">
              <div className="flex items-center justify-between">
                <DialogTitle>Vista Previa - {pdfPreview.nombre}</DialogTitle>
                <Button
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = pdfPreview.url;
                    link.download = pdfPreview.nombre;
                    link.click();
                  }}
                  style={{ backgroundColor: brandConfig.primaryColor }}
                  className="text-white hover:opacity-90"
                >
                  📥 Descargar PDF
                </Button>
              </div>
            </DialogHeader>
            <div className="flex-1 overflow-auto p-4 bg-slate-100">
              <iframe
                src={pdfPreview.url}
                className="w-full h-full min-h-[70vh] rounded border-2 border-slate-300 bg-white"
                title="Vista previa del PDF"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/* ===========================
   Componente: DocumentoEditor
   =========================== */
function DocumentoEditor({ documento, clientes, cotizaciones, onSave, onClose, brandConfig }) {
  // Función de migración: convierte facturaVenta (objeto antiguo) a facturasVenta (array)
  const migrarDocumento = (doc) => {
    const migrado = JSON.parse(JSON.stringify(doc));

    // Migración para Orden de Trabajo: facturaVenta → facturasVenta
    if (migrado.tipo === "orden_trabajo") {
      // Si ya tiene facturasVenta (array), no hacer nada
      if (!migrado.facturasVenta || !Array.isArray(migrado.facturasVenta)) {
        // Si tiene facturaVenta (objeto antiguo), convertir a array
        if (migrado.facturaVenta && (migrado.facturaVenta.codigo || migrado.facturaVenta.rut || migrado.facturaVenta.monto)) {
          migrado.facturasVenta = [{ ...migrado.facturaVenta, id: uid() }];
          delete migrado.facturaVenta; // Eliminar el campo antiguo
        } else {
          // Inicializar como array vacío
          migrado.facturasVenta = [];
        }
      } else {
        // Asegurar que cada factura tenga un ID
        migrado.facturasVenta = migrado.facturasVenta.map(f => ({ ...f, id: f.id || uid() }));
      }
    }

    // Migración de items: agregar precioUnitarioTexto si no existe
    if (migrado.items && Array.isArray(migrado.items)) {
      migrado.items = migrado.items.map(item => {
        // Si el item no tiene precioUnitarioTexto, inicializarlo vacío
        if (!('precioUnitarioTexto' in item)) {
          return {
            ...item,
            precioUnitarioTexto: ""
          };
        }
        return item;
      });
    }

    return migrado;
  };

  const [draft, setDraft] = useState(() => migrarDocumento(documento));

  useEffect(() => {
    setDraft(migrarDocumento(documento));
  }, [documento]);

  const [showPicker, setShowPicker] = useState(false);

  // Estado para el diálogo de gestión de plantillas
  const [showPlantillasDialog, setShowPlantillasDialog] = useState(false);
  const [plantillas, setPlantillas] = useState(getCondicionesPlantillas());
  const [plantillaEditando, setPlantillaEditando] = useState(null);
  const [nuevaPlantillaNombre, setNuevaPlantillaNombre] = useState("");
  const [nuevaPlantillaContenido, setNuevaPlantillaContenido] = useState("");

  const recomputeTotals = (items) => items.reduce((s, it) => s + (Number(it.valorTotal) || 0), 0);

  const setClientePorId = (id) => {
    const cli = clientes.find(c => c.id === id) || null;
    setDraft(d => ({ ...d, cliente: cli }));
  };


  // ✅ NUEVO: Setters para campos personalizables
  const setIncluye = (txt) => setDraft(d => ({ ...d, incluye: txt }));
  const setFaena = (txt) => setDraft(d => ({ ...d, faena: txt }));
  const setNota = (txt) => setDraft(d => ({ ...d, nota: txt }));
  const setFormaPago = (txt) => setDraft(d => ({ ...d, formaPago: txt }));
  const setCondicionesComerciales = (txt) => setDraft(d => ({ ...d, condicionesComerciales: txt }));



  // ✅ NUEVO: Setter para cotización relacionada (solo OT)
  const setCotizacionId = (id) => setDraft(d => ({ ...d, cotizacionId: id || null }));
   // 🧾 Setters de Orden de Compra (solo OT)
  const setOCNumero =  (v) => setDraft(d => ({ ...d, ocNumero: v }));
  const setOCFecha  =  (v) => setDraft(d => ({ ...d, ocFecha: v }));
  const setOCEmisor =  (v) => setDraft(d => ({ ...d, ocEmisor: v }));
  const setOCMonto  =  (v) => setDraft(d => ({ ...d, ocMontoNeto: Number(v) || 0 }));
  const setOCObs    =  (v) => setDraft(d => ({ ...d, ocObservacion: v }));
  // 🧾 Setters de Facturas de Venta (array múltiple - solo OT)
  const addFacturaVenta = () => {
    setDraft(d => ({
      ...d,
      facturasVenta: [...(d.facturasVenta || []), { id: uid(), codigo: "", rut: "", monto: 0 }]
    }));
  };
  const updateFacturaVenta = (id, field, value) => {
    setDraft(d => ({
      ...d,
      facturasVenta: (d.facturasVenta || []).map(f =>
        f.id === id ? { ...f, [field]: field === 'monto' ? (Number(value) || 0) : value } : f
      )
    }));
  };
  const deleteFacturaVenta = (id) => {
    setDraft(d => ({
      ...d,
      facturasVenta: (d.facturasVenta || []).filter(f => f.id !== id)
    }));
  };

  const addItem = () => {
    setDraft(d => {
      const nuevo = { id: uid(), codigo: "", cantidad: 1, descripcion: "", precioUnitario: 0, precioUnitarioTexto: "", valorTotal: 0, valorTotalTexto: "", valorTotalManual: false };
      const items = [...d.items, nuevo];
      return { ...d, items, totalNeto: recomputeTotals(items) };
    });
  };

  const delItem = (itemId) => {
    setDraft(d => {
      const items = d.items.filter(i => i.id !== itemId);
      return { ...d, items, totalNeto: recomputeTotals(items) };
    });
  };

  const updItem = (itemId, campo, valor) => {
    setDraft(d => {
      const items = d.items.map(it => {
        if (it.id !== itemId) return it;

        // Manejar actualización de campos
        let next = { ...it };

        if (campo === 'cantidad') {
          next.cantidad = Number(valor || 0);
        } else if (campo === 'precioUnitarioTexto') {
          // Guardar el texto ingresado
          next.precioUnitarioTexto = valor;
          // Extraer y guardar el valor numérico para cálculos
          next.precioUnitario = extraerValorNumerico(valor);
        } else if (campo === 'valorTotalTexto') {
          // ✅ NUEVO: Cuando se edita manualmente el valor total
          next.valorTotalTexto = valor;
          next.valorTotal = extraerValorNumerico(valor);
          next.valorTotalManual = true; // Flag para indicar que fue editado manualmente
        } else if (campo === 'precioUnitario') {
          // Compatibilidad con código antiguo (por si acaso)
          next.precioUnitario = Number(valor || 0);
          next.precioUnitarioTexto = String(valor || "");
        } else {
          next[campo] = valor;
        }

        // ✅ MODIFICADO: Solo recalcular si NO fue editado manualmente
        if (campo !== 'valorTotalTexto' && !next.valorTotalManual) {
          const cantidad = Number(next.cantidad || 0);
          const precio = Number(next.precioUnitario || 0);
          next.valorTotal = cantidad * precio;
          // Si el valor es numérico, sincronizar el texto
          if (next.valorTotal > 0) {
            next.valorTotalTexto = String(next.valorTotal);
          }
        }

        return next;
      });
      return { ...d, items, totalNeto: recomputeTotals(items) };
    });
  };

  const handleGuardar = () => {
    onSave(draft);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-none max-w-none w-[98vw] lg:w-[1250px] h-[85vh] overflow-y-auto p-0">
        <DialogHeader className="sticky top-0 bg-white/80 backdrop-blur z-10 border-b p-6">
          <DialogTitle className="text-xl">
            {draft.tipo === "cotizacion" ? "Editar Cotización" : 
             draft.tipo === "orden_compra" ? "Editar Orden de Compra" :
             "Editar Orden de Trabajo"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 p-6">
          <div>
            <Label className="block mb-2">Número / Nombre del Documento</Label>
            <Input
              value={draft.numero || ""}
              onChange={(e) => setDraft(d => ({ ...d, numero: e.target.value }))}
              placeholder={
                draft.tipo === "cotizacion" ? "Ej: COT-2025-001" : 
                draft.tipo === "orden_compra" ? "Ej: OC-2025-001" :
                "Ej: OT-2025-001"
              }
            />
          </div>

                  {/* 🔎 Basado en cotización + 🧾 Orden de Compra (solo OT) */}
          {draft.tipo === "orden_trabajo" && (
            <div className="space-y-4">
              <div>
                <Label className="block mb-2">Basado en Cotización (opcional)</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    readOnly
                    value={(cotizaciones.find(c => c.id === draft.cotizacionId)?.numero) || "— sin seleccionar —"}
                    className="bg-white"
                  />
                  <Button type="button" variant="secondary" onClick={() => setShowPicker(true)}>
                    Buscar cotización…
                  </Button>
                  {draft.cotizacionId && (
                    <Button type="button" variant="outline" onClick={() => setCotizacionId(null)}>
                      Limpiar
                    </Button>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Busca por N° de cotización, empresa, RUT o monto; ordena por fecha (desc) y selecciona “Usar”.
                </p>
              </div>

              {/* 🧾 Bloque Orden de Compra del Cliente */}
              <div className="mt-2 rounded-xl border p-4 bg-slate-50">
                <h3 className="font-semibold mb-3">Orden de Compra del Cliente</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label>Número de OC</Label>
                    <Input value={draft.ocNumero || ""} onChange={e => setOCNumero(e.target.value)} placeholder="OC-1234" />
                  </div>
                  <div>
                    <Label>Fecha de OC</Label>
                    <Input type="date" value={draft.ocFecha || ""} onChange={e => setOCFecha(e.target.value)} />
                  </div>
                  <div>
                    <Label>Emisor (cliente)</Label>
                    <Input value={draft.ocEmisor || ""} onChange={e => setOCEmisor(e.target.value)} placeholder="Nombre/Razón social" />
                  </div>
                  <div>
                    <Label>Monto aprobado (neto)</Label>
                    <MoneyInput
                      valueNumber={draft.ocMontoNeto || 0}
                      onValueNumberChange={(num) => setOCMonto(num)}
                      placeholder="0"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label>Observación</Label>
                    <Textarea rows={3} value={draft.ocObservacion || ""} onChange={e => setOCObs(e.target.value)} placeholder="Notas relevantes de la OC..." />
                  </div>
                </div>
              </div>

              {/* 🧾 Bloque Facturas de Venta Asociadas (múltiples) */}
              <div className="mt-2 rounded-xl border p-4 bg-green-50 border-green-200">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-green-900">Facturas de Venta Asociadas</h3>
                  <Button type="button" onClick={addFacturaVenta} size="sm" className="bg-green-600 hover:bg-green-700">
                    + Agregar Factura
                  </Button>
                </div>

                {(draft.facturasVenta || []).length === 0 ? (
                  <p className="text-sm text-green-700 italic">No hay facturas de venta asociadas. Haz clic en "Agregar Factura" para añadir una.</p>
                ) : (
                  <div className="space-y-3">
                    {(draft.facturasVenta || []).map((factura, idx) => (
                      <div key={factura.id} className="grid md:grid-cols-[1fr_1fr_1fr_auto] gap-3 p-3 bg-white rounded-lg border border-green-200">
                        <div>
                          <Label className="text-xs">Código de Factura</Label>
                          <Input
                            value={factura.codigo || ""}
                            onChange={e => updateFacturaVenta(factura.id, 'codigo', e.target.value)}
                            placeholder="Ej: FV-2025-001"
                            className="h-9"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">RUT</Label>
                          <Input
                            value={factura.rut || ""}
                            onChange={e => updateFacturaVenta(factura.id, 'rut', e.target.value)}
                            placeholder="Ej: 12.345.678-9"
                            className="h-9"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Monto Total</Label>
                          <MoneyInput
                            valueNumber={factura.monto || 0}
                            onValueNumberChange={(num) => updateFacturaVenta(factura.id, 'monto', num)}
                            placeholder="0"
                            className="h-9"
                          />
                        </div>
                        <div className="flex items-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteFacturaVenta(factura.id)}
                            className="h-9 text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}


          <div>
            <Label className="block mb-2">Seleccionar Proveedor</Label>
            <select
              value={draft.cliente?.id || ""}
              onChange={(e) => setClientePorId(e.target.value)}
              className="w-full p-2 border rounded bg-white"
            >
              <option value="">-- Seleccionar --</option>
              {clientes.map(c => (
                <option key={c.id} value={c.id}>{c.nombre} - {c.empresa}</option>
              ))}
            </select>
          </div>

          {draft.cliente && (
            <div className="grid md:grid-cols-2 gap-4 p-4 bg-slate-50 rounded border">  
              <div><strong>Nombre:</strong> {draft.cliente.nombre}</div>
              <div><strong>Empresa:</strong> {draft.cliente.empresa}</div>
              <div><strong>RUT:</strong> {draft.cliente.rut}</div>
              <div><strong>Dirección:</strong> {draft.cliente.direccion}</div>
              <div><strong>Ciudad:</strong> {draft.cliente.ciudad}</div>
              <div><strong>Teléfono:</strong> {draft.cliente.telefono}</div>
            </div>
          )}

          {/* ✅ NUEVO: Campos personalizables */}
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-4 space-y-4">
              <h3 className="font-semibold text-blue-900 mb-2">Información del Documento (aparecerá en el PDF)</h3>
              
              <div>
                <Label>Incluye</Label>
                <Input
                  value={draft.incluye || ""}
                  onChange={(e) => setIncluye(e.target.value)}
                  placeholder="Ej: Precios sin IVA"
                />
              </div>

              <div>
                <Label>Faena</Label>
                <Input
                  value={draft.faena || ""}
                  onChange={(e) => setFaena(e.target.value)}
                  placeholder="Ej: Interior de planta Generación"
                />
              </div>

              <div>
                <Label>Nota</Label>
                <Textarea
                  value={draft.nota || ""}
                  onChange={(e) => setNota(e.target.value)}
                  placeholder="Ej: 4 días hábiles de trabajo y con bloqueos de seguridad requeridos para la faena"
                  className="min-h-[60px]"
                />
              </div>

              <div>
                <Label>Forma de Pago</Label>
                <Input
                  value={draft.formaPago || ""}
                  onChange={(e) => setFormaPago(e.target.value)}
                  placeholder="Ej: 45 DÍAS HÁBILES CONTRA ORDEN DE COMPRA"
                />
              </div>

              <div>
                <Label>Condiciones Comerciales</Label>
                <div className="flex gap-2 mb-2">
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors"
                    onChange={(e) => {
                      if (e.target.value) {
                        const plantilla = plantillas.find(p => p.nombre === e.target.value);
                        if (plantilla) setCondicionesComerciales(plantilla.contenido);
                      }
                    }}
                    value=""
                  >
                    <option value="">Seleccionar plantilla...</option>
                    {plantillas.map(p => (
                      <option key={p.nombre} value={p.nombre}>{p.nombre}</option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowPlantillasDialog(true);
                      setPlantillas(getCondicionesPlantillas());
                    }}
                  >
                    ⚙️ Gestionar
                  </Button>
                </div>
                <Textarea
                  value={draft.condicionesComerciales || ""}
                  onChange={(e) => setCondicionesComerciales(e.target.value)}
                  placeholder="Escribe las condiciones comerciales o selecciona una plantilla..."
                  className="min-h-[80px]"
                />
              </div>
            </CardContent>
          </Card>

          <div>
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold">Ítems</h3>
              <Button type="button" onClick={addItem}>+ Agregar Ítem</Button>
            </div>

            <div className="overflow-auto rounded border bg-white max-h-[62vh]">
              <Table className="min-w-[1400px]">
                <TableHeader className="sticky top-0 bg-white">
                  <TableRow>
                    <TableHead className="w-48">Código</TableHead>
                    <TableHead className="w-28">Cantidad</TableHead>
                    <TableHead className="w-[48rem]">Descripción</TableHead>
                    <TableHead className="w-48">Precio Unitario Neto</TableHead>
                    <TableHead className="w-48">Valor Total Neto</TableHead>
                    <TableHead className="w-24 text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {draft.items.map(item => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Input
                          value={item.codigo}
                          onChange={(e) => updItem(item.id, 'codigo', e.target.value)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={item.cantidad}
                          onChange={(e) => updItem(item.id, 'cantidad', e.target.value)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={item.descripcion}
                          onChange={(e) => updItem(item.id, 'descripcion', e.target.value)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="text"
                          value={item.precioUnitarioTexto || ""}
                          onChange={(e) => updItem(item.id, 'precioUnitarioTexto', e.target.value)}
                          placeholder="Ej: (GL) 2.000.000 o 5.000.000"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="text"
                          value={item.valorTotalTexto || ""}
                          onChange={(e) => updItem(item.id, 'valorTotalTexto', e.target.value)}
                          placeholder="Ej: 5.000.000"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button type="button" variant="ghost" size="sm" onClick={() => delItem(item.id)}>
                          <Trash2 size={16} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="flex justify-end">
            <div className="text-right">
              <div className="text-sm text-slate-500">Valor Total Neto</div>
              <div className="text-2xl font-bold">{fmtMoney(draft.totalNeto || 0)}</div>
            </div>
          </div>

          <div className="sticky bottom-0 bg-white/80 backdrop-blur pt-2 border-t flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button 
              type="button" 
              onClick={handleGuardar}
              style={{ backgroundColor: brandConfig.primaryColor }}
              className="text-white hover:opacity-90"
            >
              💾 Guardar
            </Button>
          </div>

          {/* ⬇️ Diálogo de Gestión de Plantillas */}
          <Dialog open={showPlantillasDialog} onOpenChange={setShowPlantillasDialog}>
            <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
              <DialogHeader>
                <DialogTitle>Gestionar Plantillas de Condiciones Comerciales</DialogTitle>
              </DialogHeader>

              <div className="flex-1 overflow-auto space-y-4 p-4">
                {/* Crear Nueva Plantilla */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-semibold text-blue-900 mb-3">Crear Nueva Plantilla</h3>
                  <div className="space-y-3">
                    <div>
                      <Label>Nombre de la plantilla</Label>
                      <Input
                        value={nuevaPlantillaNombre}
                        onChange={(e) => setNuevaPlantillaNombre(e.target.value)}
                        placeholder="Ej: Condiciones Estándar"
                      />
                    </div>
                    <div>
                      <Label>Contenido</Label>
                      <Textarea
                        value={nuevaPlantillaContenido}
                        onChange={(e) => setNuevaPlantillaContenido(e.target.value)}
                        placeholder="Escribe las condiciones comerciales..."
                        className="min-h-[100px]"
                      />
                    </div>
                    <Button
                      onClick={() => {
                        if (!nuevaPlantillaNombre.trim()) {
                          alert('Ingresa un nombre para la plantilla');
                          return;
                        }
                        if (!nuevaPlantillaContenido.trim()) {
                          alert('Ingresa el contenido de la plantilla');
                          return;
                        }
                        if (saveCondicionesPlantilla(nuevaPlantillaNombre.trim(), nuevaPlantillaContenido.trim())) {
                          setPlantillas(getCondicionesPlantillas());
                          setNuevaPlantillaNombre("");
                          setNuevaPlantillaContenido("");
                          alert('Plantilla guardada exitosamente');
                        }
                      }}
                      className="w-full"
                    >
                      💾 Guardar Nueva Plantilla
                    </Button>
                  </div>
                </div>

                {/* Lista de Plantillas Existentes */}
                <div>
                  <h3 className="font-semibold mb-3">Plantillas Guardadas</h3>
                  {plantillas.length === 0 ? (
                    <p className="text-slate-500 text-center py-8">No hay plantillas guardadas</p>
                  ) : (
                    <div className="space-y-3">
                      {plantillas.map((plantilla) => (
                        <div key={plantilla.nombre} className="border rounded-lg p-4 bg-slate-50">
                          {plantillaEditando === plantilla.nombre ? (
                            // Modo Edición
                            <div className="space-y-3">
                              <div>
                                <Label>Nombre</Label>
                                <Input
                                  value={plantilla.nombre}
                                  disabled
                                  className="bg-slate-100"
                                />
                              </div>
                              <div>
                                <Label>Contenido</Label>
                                <Textarea
                                  value={plantilla.contenido}
                                  onChange={(e) => {
                                    const updated = plantillas.map(p =>
                                      p.nombre === plantilla.nombre
                                        ? { ...p, contenido: e.target.value }
                                        : p
                                    );
                                    setPlantillas(updated);
                                  }}
                                  className="min-h-[100px]"
                                />
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    saveCondicionesPlantilla(plantilla.nombre, plantilla.contenido);
                                    setPlantillaEditando(null);
                                    alert('Plantilla actualizada');
                                  }}
                                  className="flex-1"
                                >
                                  ✓ Guardar Cambios
                                </Button>
                                <Button
                                  variant="secondary"
                                  onClick={() => {
                                    setPlantillas(getCondicionesPlantillas());
                                    setPlantillaEditando(null);
                                  }}
                                  className="flex-1"
                                >
                                  ✕ Cancelar
                                </Button>
                              </div>
                            </div>
                          ) : (
                            // Modo Vista
                            <div className="space-y-2">
                              <div className="flex justify-between items-start">
                                <h4 className="font-semibold text-lg">{plantilla.nombre}</h4>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setPlantillaEditando(plantilla.nombre)}
                                  >
                                    ✏️ Editar
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => {
                                      if (confirm(`¿Eliminar la plantilla "${plantilla.nombre}"?`)) {
                                        deleteCondicionesPlantilla(plantilla.nombre);
                                        setPlantillas(getCondicionesPlantillas());
                                      }
                                    }}
                                  >
                                    🗑️ Eliminar
                                  </Button>
                                </div>
                              </div>
                              <p className="text-sm text-slate-600 whitespace-pre-wrap">{plantilla.contenido}</p>
                              <p className="text-xs text-slate-400">
                                {plantilla.fecha ? new Date(plantilla.fecha).toLocaleString('es-CL') : ''}
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t pt-4">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowPlantillasDialog(false);
                    setPlantillaEditando(null);
                  }}
                  className="w-full"
                >
                  Cerrar
                </Button>
              </div>
            </DialogContent>
          </Dialog>

                    {/* ⬇️ Modal de búsqueda de cotizaciones */}
          <CotizacionPicker
            open={showPicker}
            onClose={() => setShowPicker(false)}
            cotizaciones={cotizaciones}
            onPick={(id) => {
              setCotizacionId(id);
              setShowPicker(false);
            }}
          />



          
        </div>

        
      </DialogContent>
    </Dialog>
  );
}


/* ===========================
   Componente: CotizacionPicker
   =========================== */
function CotizacionPicker({ open, onClose, cotizaciones, onPick }) {
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const PAGE = 10;

  const fil = React.useMemo(() => {
    const norm = (s) => (s || "").toString().toLowerCase();
    const arr = [...(cotizaciones || [])].sort((a, b) =>
      (b.fecha || "").localeCompare(a.fecha || "")
    );
    return arr.filter((c) => {
      if (!q) return true;
      const campos = [
        c.numero,
        c.cliente?.empresa,
        c.cliente?.nombre,
        c.cliente?.rut,
        (c.totalNeto ?? 0).toString(),
      ]
        .map(norm)
        .join(" ");
      return campos.includes(norm(q));
    });
  }, [cotizaciones, q]);

  const totalPages = Math.max(1, Math.ceil(fil.length / PAGE));
  const view = fil.slice((page - 1) * PAGE, page * PAGE);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Buscar cotización</DialogTitle>
        </DialogHeader>

        <div className="mb-3">
          <Input
            placeholder="N° cotización, empresa, RUT o monto…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <div className="max-h-[420px] overflow-auto rounded border">
          <Table className="min-w-[740px]">
            <TableHeader>
              <TableRow>
                <TableHead>N°</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>RUT</TableHead>
                <TableHead className="text-right">Total Neto</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.numero || c.id.slice(0, 6)}</TableCell>
                  <TableCell>{c.fecha || "—"}</TableCell>
                  <TableCell>{c.cliente?.nombre || "—"}</TableCell>
                  <TableCell>{c.cliente?.empresa || "—"}</TableCell>
                  <TableCell className="text-xs text-slate-600">{c.cliente?.rut || "—"}</TableCell>
                  <TableCell className="text-right font-semibold">
                    {fmtMoney?.(c.totalNeto ?? 0)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" onClick={() => onPick?.(c.id)}>
                      Usar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {view.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center text-slate-500 py-6"
                  >
                    Sin resultados
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex justify-between items-center mt-3">
          <span className="text-sm text-slate-500">Resultados: {fil.length}</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ←
            </Button>
            <span className="text-sm">
              Página {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              →
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
