import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/Toast";
import { RUTInput } from "@/components/RUTInput";
import { validateRUT } from "@/utils/rut";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Upload, Trash2, FileText } from "lucide-react";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, CartesianGrid,
  LineChart, Line, AreaChart, Area, Brush, ReferenceLine, LabelList
} from "recharts";

import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

/********************
 * UTILIDADES
 *******************/
// API Base URL - Siempre localhost:3001 porque Express corre localmente en Electron
const API_BASE = 'http://localhost:3001';

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const fmtMoney = (n) => CLP.format(Math.round(n || 0));
const uid = () => Math.random().toString(36).slice(2, 9);
const todayISO = () => new Date().toISOString().slice(0,10);
const deepClone = (obj) => JSON.parse(JSON.stringify(obj));
// Helper para manejar cliente como objeto o string
const getClienteNombre = (cotizacion) => typeof cotizacion.cliente === 'object' && cotizacion.cliente !== null ? (cotizacion.cliente.nombre || cotizacion.cliente.empresa || "—") : (cotizacion.cliente || "—");
const getClienteRut = (cotizacion) => typeof cotizacion.cliente === 'object' && cotizacion.cliente !== null ? (cotizacion.cliente.rut || "—") : (cotizacion.rut || "—");
const readFileAsDataURL = (file) => new Promise((resolve, reject) => {
  const MAX_MB = 20;
  if (file.size > MAX_MB * 1024 * 1024) {
    reject(new Error(`El archivo supera ${MAX_MB}MB`));
    return;
  }
  const reader = new FileReader();
  reader.onload = () => resolve({
    name: file.name, size: file.size, type: file.type,
    dataUrl: String(reader.result), id: uid(), addedAt: new Date().toISOString()
  });
  reader.onerror = reject;
  reader.readAsDataURL(file);



});

// Devuelve true si dateStr (YYYY-MM-DD) cae entre [desde, hasta] (inclusive).
const inRange = (dateStr, desde, hasta) => {
  if (!dateStr) return true; // si la fila no tiene fecha, no la excluimos
  try {
    const d = new Date(dateStr + "T00:00:00");
    if (desde) {
      const dDesde = new Date(desde + "T00:00:00");
      if (d < dDesde) return false;
    }
    if (hasta) {
      const dHasta = new Date(hasta + "T23:59:59");
      if (d > dHasta) return false;
    }
    return true;
  } catch {
    return true;
  }
};


/********************
 * FORMATEO DE MONTOS (CLP) + <MoneyInput/>
 *******************/
const CLP_INT = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
const onlyDigits = (s = "") => s.replace(/\D+/g, "");
const toInt = (s = "") => {
  const d = onlyDigits(s);
  return d ? parseInt(d, 10) : 0;
};

/** <MoneyInput/> muestra 1.500.000 pero entrega números (p.ej. 1500000) al padre */
function MoneyInput({
  valueNumber = 0,
  onValueNumberChange,
  placeholder,
  ...props
}) {
  const [text, setText] = React.useState(
    valueNumber ? CLP_INT.format(Math.round(valueNumber)) : ""
  );

  // Si el valor externo cambia, sincroniza el texto
  useEffect(() => {
    const cur = toInt(text);
    if ((valueNumber || 0) !== cur) {
      setText(valueNumber ? CLP_INT.format(Math.round(valueNumber)) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueNumber]);

  const handleChange = (e) => {
    const raw = e.target.value ?? "";
    const num = toInt(raw);
    setText(raw === "" ? "" : CLP_INT.format(num));
    onValueNumberChange?.(num);
  };

  const handleBlur = () => {
    const num = toInt(text);
    setText(num ? CLP_INT.format(num) : "");
  };

  const handleFocus = (e) => e.target.select();

  return (
    <Input
      inputMode="numeric"
      value={text}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
      placeholder={placeholder ?? "0"}
      {...props}
    />
  );
}


/********************
 * ESTILO DASHBOARD (colores + tooltip)
 *******************/
/********************
 * ESTILO DASHBOARD (colores + tooltip)
 *******************/
const COLORS = {
  // paleta corporativa refinada (azules + acentos cálidos)
  ingresos: "#2563eb",       // blue-600
  ingresosSoft: "#93c5fd",   // blue-300
  costos: "#ef4444",         // red-500
  costosSoft: "#fca5a5",     // red-300
  utilidad: "#10b981",       // emerald-500
  utilidadSoft: "#86efac",   // emerald-300
  grid: "#e5e7eb",           // slate-200
};

function Dot({ color }) {
  return (
    <span
      style={{ background: color }}
      className="inline-block w-2 h-2 rounded-full shadow-[0_0_0_2px_rgba(0,0,0,0.04)]"
    />
  );
}

function MoneyTooltip({ active, payload, label, title }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/95 backdrop-blur-sm px-3 py-2 text-xs shadow-lg shadow-slate-200/60">
      <div className="mb-1 font-semibold text-slate-800 tracking-tight">
        {title ?? label}
      </div>
      <div className="space-y-1">
        {payload.map((p) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-slate-600">
              <Dot color={p.fill || p.color || "#000"} />
              {p.name}
            </span>
            <span className="font-semibold text-slate-900">{fmtMoney(p.value || 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}


/********************
 * PERSISTENCIA
 *******************/
function useStore(userKey, toast, isEditing) {
  const [data, setData] = useState({ cotizaciones: [] });
  const [loading, setLoading] = useState(true);

  // Función de carga de datos (extraída para poder reutilizarla)
  const loadData = useCallback(async () => {
    try {
      console.log('[CotizacionesPage] Cargando datos desde /api/data...');
      const res = await fetch(`${API_BASE}/api/data?key=${userKey}`);
      if (res.ok) {
        const json = await res.json();
        // Usar el endpoint /api/data para el apartado principal (registro manual)
        // Filtrar cotizaciones eliminadas (soft delete)
        const cotizaciones = Array.isArray(json?.cotizaciones) ? json.cotizaciones : [];
        setData({
          cotizaciones: cotizaciones.filter(x => !x.deleted)
        });
        console.log('[CotizacionesPage] Datos cargados:', json.cotizaciones?.length || 0, 'cotizaciones');
      }
    } catch (e) {
      console.error('Error al cargar datos:', e);
    } finally {
      setLoading(false);
    }
  }, [userKey, API_BASE]);

  // Carga inicial de datos
  useEffect(() => {
    loadData();
  }, [loadData]);

  const saveData = async (newData) => {
    try {
      console.log('[SAVE] 💾 Guardando datos...');
      console.log('[SAVE] 📊 Datos a guardar - Total:', newData.cotizaciones?.length);
      console.log('[SAVE] 📊 Datos a guardar - Visibles:', newData.cotizaciones?.filter(x => !x.deleted).length);
      console.log('[SAVE] 📊 Datos a guardar - Eliminadas:', newData.cotizaciones?.filter(x => x.deleted).length);

      // 1. Obtener datos completos actuales
      const getCurrentDataRes = await fetch(`${API_BASE}/api/data?key=${userKey}`);
      let fullData = {
        cotizaciones: []
      };

      if (getCurrentDataRes.ok) {
        fullData = await getCurrentDataRes.json();
      }

      // 2. Actualizar cotizaciones (ya vienen todas, incluyendo las marcadas como deleted: true)
      fullData.cotizaciones = newData.cotizaciones || [];

      // 3. Guardar en /api/data (apartado principal - registro manual)
      const response = await fetch(`${API_BASE}/api/data?key=${userKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullData), // ✅ Enviar estructura plana {cotizaciones: [...]}
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Error al guardar:', response.status, errorText);
        toast.error('Error al guardar los datos en el servidor');
        return;
      }

      console.log('[SAVE] ✅ Datos guardados en backend');
      // Actualizar estado UI solo con cotizaciones visibles (filtrar eliminadas)
      const dataForUI = {
        ...newData,
        cotizaciones: (newData.cotizaciones || []).filter(x => !x.deleted)
      };
      console.log('[SAVE] 📊 Actualizando UI con', dataForUI.cotizaciones.length, 'cotizaciones visibles');
      setData(dataForUI);
    } catch (e) {
      toast.error('Error al conectar con el servidor. Verifica que la aplicación esté activa.');
      console.error(e);
    }
  };
  return { data, setData: saveData, loading };
}

/********************
 * MODELO & CÁLCULOS
 * - Facturas múltiples por cotización (normalización retrocompatible)
 * - Impuestos por servicio (fila): IVA 19% y/o otro impuesto (% con nombre)
 *******************/

/** Normaliza facturas: si viene `factura` (antiguo) la convierte a `facturas`
 *  y asegura campos nuevos: clienteNombre y clienteRUT (fallback al de la cotización)
 */
function getFacturasArray(cot) {
  if (Array.isArray(cot?.facturas)) {
    return cot.facturas.map(f => ({
      id: f.id || uid(),
      fecha: f.fecha || cot.fecha || todayISO(),
      total: Number(f.total || 0),
      descripcion: f.descripcion || "",
      comentarios: f.comentarios || "",                 // <- preserva comentarios
      pdfs: Array.isArray(f.pdfs) ? f.pdfs : [],
      clienteNombre: f.clienteNombre || cot?.cliente || "",
      clienteRUT: f.clienteRUT || cot?.rut || "",
    }));
  }
  if (cot?.factura) {
    const f = cot.factura;
    return [{
      id: f.id || uid(),
      fecha: f.fecha || cot.fecha || todayISO(),
      total: Number(f.total || 0),
      descripcion: f.descripcion || "",
      comentarios: f.comentarios || "",                 // <- preserva comentarios
      pdfs: Array.isArray(f.pdfs) ? f.pdfs : [],
      clienteNombre: f.clienteNombre || cot?.cliente || "",
      clienteRUT: f.clienteRUT || cot?.rut || "",
    }];
  }
  return [];
}


/** BASE del servicio: cantidad * costo */
function itemBase(it) {
  const qty = Number(it.cantidad || 0);
  const cost = Number(it.costo || 0);
  return qty * cost;
}

/** IVA por servicio: 19% del BASE si `conIVA` está activo */
function itemIVA(it) {
  return it?.conIVA ? itemBase(it) * 0.19 : 0;
}

/** Otro impuesto por servicio (porcentaje sobre el BASE) si está activo */
function itemOtro(it) {
  if (!it?.otroActivo) return 0;
  const pct = Number(it?.otroPorcentaje || 0);
  return itemBase(it) * (pct / 100);
}

/** Subtotal del servicio = base + IVA + otro */
function itemSubtotal(it) {
  return itemBase(it) + itemIVA(it) + itemOtro(it);
}

/** Total OT = suma de subtotales de cada servicio */
function calcOTTotal(ot) {
  const items = (ot?.items || []);
  return items.reduce((s, it) => s + itemSubtotal(it), 0);
}

/** Suma de facturas (neto o bruto según flag) */
function sumFacturas(cot, usarNetoSinIVA) {
  const arr = getFacturasArray(cot);
  return arr.reduce((s, f) => {
    const bruto = Number(f?.total || 0);
    const val = usarNetoSinIVA ? (bruto / 1.19) : bruto;
    return s + val;
  }, 0);
}

/** Conteo total de facturas en todo el dataset (para KPI) */
function countAllFacturas(data) {
  return (data?.cotizaciones || []).reduce((acc, c) => acc + getFacturasArray(c).length, 0);
}




function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const result = await login(username, password);

    if (!result.success) {
      setError(result.error || "Usuario o contraseña incorrectos");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-md p-6 space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-800">Sistema de Cotizaciones</h1>
          <p className="text-slate-600">Inicia sesión para continuar</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="username" className="text-slate-700">Usuario</Label>
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ej: meg_2025"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="password" className="text-slate-700">Contraseña</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="mt-1"
            />
          </div>
          {error && (
            <div className="text-red-500 text-sm">{error}</div>
          )}
          <Button type="submit" className="w-full">
            Iniciar sesión
          </Button>
        </form>
        <div className="text-xs text-slate-500 text-center mt-4">
          <p>MEG Industrial: <code className="bg-slate-100 px-1 rounded">meg_2025</code></p>
          <p>MyOrganic: <code className="bg-slate-100 px-1 rounded">myorganic_2025</code></p>
        </div>
      </div>
    </div>
  );
}
/********************
 * APP PRINCIPAL — BRAND NARANJO
 *******************/
export default function App() {
  const { user, isLoading, logout, isAuthenticated } = useAuth();

  // Mientras se determina el estado de login, no renderizamos nada
  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return <MainApp user={user} company={user.company} onLogout={logout} />;
}

function MainApp({ user, company, onLogout }) {
  const navigate = useNavigate();
  const toast = useToast();

  // Estado de modal de edición (levantado para detectar edición activa)
  const [sel, setSel] = useState(null); // cotización seleccionada (para modal)

  // Hook con callback para detectar edición activa
  const { data, setData } = useStore(user, toast, () => {
    // Retorna true si hay modal de edición abierto
    return sel !== null;
  });

  const [tab, setTab] = useState("dashboard");
  const [usarNetoSinIVA, setUsarNetoSinIVA] = useState(true);
  const [filtros, setFiltros] = useState({
    numero: "",
    cliente: "",
    rut: "",
    solicitud: "",
    desde: "",
    hasta: "",
  });


  const [paginaActual, setPaginaActual] = useState(1);
  const ITEMS_POR_PAGINA = 10; // Ajusta según prefieras (10, 15, 20, etc.)





  const COLORS = useMemo(() => {
  if (user === 'myorganic') {
    return {
      ingresos: "#3b82f6",       // blue-500
      ingresosSoft: "#93c5fd",   // blue-300
      costos: "#ef4444",         // red-500
      costosSoft: "#fca5a5",     // red-300
      utilidad: "#10b981",       // emerald-500
      utilidadSoft: "#86efac",   // emerald-300
      grid: "#e5e7eb",
    };
  }
  return {
    ingresos: "#2563eb",         // blue-600
    ingresosSoft: "#93c5fd",     // blue-300
    costos: "#ef4444",           // red-500
    costosSoft: "#fca5a5",       // red-300
    utilidad: "#10b981",         // emerald-500
    utilidadSoft: "#86efac",     // emerald-300
    grid: "#e5e7eb",
  };
}, [user]);


  // KPIs globales (ingresos por facturas; costos por OT con impuestos por servicio)
  const totales = useMemo(()=>{
    let ingresos = 0, costos = 0;
    const cotizaciones = data?.cotizaciones || [];
    for (const c of cotizaciones) {
      const factSum = sumFacturas(c, usarNetoSinIVA);
      const otTotal = calcOTTotal(c?.ot);
      ingresos += factSum;
      costos += otTotal;
    }
    return { ingresos, costos, utilidad: Math.max(ingresos - costos, 0) };
  }, [data?.cotizaciones, usarNetoSinIVA]);

  // Series mensualizadas (ingresos por fecha de cada factura; costos por fecha de OT)
  const monthly = useMemo(()=>{
    const map = {};
    const cotizaciones = data?.cotizaciones || [];
    for (const c of cotizaciones) {
      // ingresos por cada factura
      for (const f of getFacturasArray(c)) {
        const mF = (f?.fecha || c?.fecha || todayISO()).slice(0,7);
        const bruto = Number(f?.total || 0);
        const factCalc = usarNetoSinIVA ? (bruto/1.19) : bruto;
        map[mF] ??= { mes:mF, ingresos:0, costos:0 };
        map[mF].ingresos += factCalc;
      }
      // costos por fecha de OT
      const oFecha = c?.ot?.fecha || c?.fecha || todayISO();
      const mO = oFecha.slice(0,7);
      map[mO] ??= { mes:mO, ingresos:0, costos:0 };
      map[mO].costos += calcOTTotal(c?.ot);
    }
    return Object.values(map).sort((a,b)=> a.mes.localeCompare(b.mes));
  }, [data?.cotizaciones, usarNetoSinIVA]);


  // Utilidad mensual + delta vs mes previo + media móvil 3m
const monthlyUtilidad = useMemo(() => {
  const arr = monthly.map((m, i, src) => {
    const utilidad = Math.max(m.ingresos - m.costos, 0);
    const prevU = i > 0 ? Math.max(src[i - 1].ingresos - src[i - 1].costos, 0) : null;
    const deltaUtil = prevU != null ? (utilidad - prevU) : null;
    const pctUtil = prevU > 0 ? (deltaUtil / prevU) * 100 : null;

    // media móvil simple 3 meses (si hay menos, promedia lo disponible)
    const start = Math.max(0, i - 2);
    const win = src.slice(start, i + 1);
    const ma = win.reduce((s, x) => s + Math.max(x.ingresos - x.costos, 0), 0) / win.length;

    return { ...m, utilidad, utilMA: ma, deltaUtil, pctUtil };
  });
  return arr;
}, [monthly]);

// Donut de composición (ingresos vs costos)
const compData = useMemo(() => ([
  { name: "Ingresos", value: totales.ingresos, color: COLORS.ingresos },
  { name: "Costos",   value: totales.costos,   color: COLORS.costos },
]), [totales]);


  // Utilidad por cliente (ingresos por facturas – costos por OT)
  const utilPorCliente = useMemo(()=>{
    const byCli = {};
    const cotizaciones = data?.cotizaciones || [];
    for (const c of cotizaciones) {
      // Soporte para cliente como objeto o string
      const cli = typeof c.cliente === 'object' && c.cliente !== null
        ? (c.cliente.nombre || c.cliente.empresa || "Sin cliente")
        : (c.cliente || "Sin cliente");
      const factSum = sumFacturas(c, usarNetoSinIVA);
      const otTotal = calcOTTotal(c?.ot);
      byCli[cli] ??= { ingresos:0, costos:0 };
      byCli[cli].ingresos += factSum;
      byCli[cli].costos += otTotal;
    }
    return Object.entries(byCli)
      .map(([name, v]) => ({ name, value: Math.max(v.ingresos - v.costos, 0) }))
      .filter(x=>x.value>0);
  }, [data?.cotizaciones, usarNetoSinIVA]);

  // Exportar / Importar (apartado actual)
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${user}-apartado-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Apartado exportado exitosamente");
  };

  const importJSON = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        setData(parsed);
        toast.success("Apartado importado exitosamente");
      } catch(e){
        toast.error("Archivo inválido. Verifica que sea un archivo JSON válido.");
      }
    };
    reader.readAsText(file);
  };

  // Backup Completo (TODOS los apartados)
  const exportBackupCompleto = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/backup/export-all`);
      if (!res.ok) {
        toast.error('Error al exportar backup completo');
        return;
      }

      const backup = await res.json();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `MEG-Sistema-COMPLETO-${todayISO()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Backup completo exportado exitosamente");
    } catch (e) {
      console.error('Error exportando backup completo:', e);
      toast.error('Error al exportar backup completo');
    }
  };

  const importBackupCompleto = (file) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const backup = JSON.parse(String(reader.result));

        if (!backup.data) {
          toast.error("Formato de backup inválido");
          return;
        }

        const res = await fetch(`${API_BASE}/api/backup/import-all`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(backup)
        });

        if (!res.ok) {
          toast.error('Error al importar backup completo');
          return;
        }

        const result = await res.json();
        toast.success(`Backup restaurado: ${result.imported} apartados`);

        // Recargar página para reflejar cambios
        setTimeout(() => window.location.reload(), 1500);
      } catch(e){
        console.error('Error importando backup:', e);
        toast.error("Error al importar backup completo");
      }
    };
    reader.readAsText(file);
  };

  // Duplicar cotización
const duplicarCotizacion = async (c) => {
  try {
    // ✅ Obtener TODAS las cotizaciones del backend (incluyendo eliminadas)
    const res = await fetch(`${API_BASE}/api/data?key=${encodeURIComponent(user)}`);
    if (!res.ok) {
      toast.error('Error al cargar datos del servidor');
      return;
    }
    const fullData = await res.json();
    const todasLasCotizaciones = fullData?.cotizaciones || [];

    const copia = deepClone(c);
    copia.id = uid();
    copia.numero = c.numero + "-COPY";
    copia.fecha = todayISO();
    const nuevasCotizaciones = [copia, ...todasLasCotizaciones];
    setData({ ...data, cotizaciones: nuevasCotizaciones });
    toast.success("Cotización duplicada exitosamente");
  } catch (e) {
    console.error('Error al duplicar cotización:', e);
    toast.error('Error al duplicar la cotización');
  }
};


const exportToExcel = () => {
  const cotizaciones = data?.cotizaciones || [];
  if (cotizaciones.length === 0) {
    toast.warning("No hay cotizaciones para exportar");
    return;
  }

  // Aplanar los datos para Excel (orden lógico y legible)
  const rows = cotizaciones.flatMap(cot => {
    const base = {
      "1. Codigo Cotización": cot.numero || "",
      "2. Fecha Cotización": cot.fecha || "",
      "3. Cliente": getClienteNombre(cot) === "—" ? "" : getClienteNombre(cot),
      "4. RUT Cliente": getClienteRut(cot) === "—" ? "" : getClienteRut(cot),
      "5. Solicitud/Proyecto": cot.solicitud || "",
      "6. Comentarios Cotización": cot.comentarios || "",
      "7. Monto Cotización (CLP)": cot.monto ? fmtMoney(cot.monto) : "",
    };

    const oc = {
      "8. OC Cliente - Empresa": (cot.oc?.clienteNombre) || "",
      "9. OC Cliente - RUT": (cot.oc?.clienteRUT) || "",
      "10. OC Cliente - Código": (cot.oc?.codigo) || "",
      "11. OC Cliente - Monto (CLP)": (cot.oc?.monto) ? fmtMoney(cot.oc.monto) : "",
      "12. OC Cliente - Descripción": (cot.oc?.descripcion) || "",
      "13. OC Cliente - Comentarios": (cot.oc?.comentarios) || "",
      "14. OC Cliente - PDFs": (cot.oc?.pdfs?.length || 0),
    };

    const financiamiento = {
      "15. Financiamiento - Banco/Cliente": (cot.financiamiento?.cliente) || "",
      "16. Financiamiento - N° Documento": (cot.financiamiento?.numeroDocumento) || "",
      "17. Financiamiento - RUT": (cot.financiamiento?.rut) || "",
      "18. Financiamiento - Monto (CLP)": (cot.financiamiento?.monto) ? fmtMoney(cot.financiamiento.monto) : "",
      "19. Financiamiento - Comentarios": (cot.financiamiento?.comentarios) || "",
      "20. Financiamiento - PDFs": (cot.financiamiento?.pdfs?.length || 0),
    };

    // Si no hay OT, devolver una sola fila
    if (!cot.ot || !cot.ot.items || cot.ot.items.length === 0) {
      return [{ ...base, ...oc, ...financiamiento }];
    }

    // Si hay OT, una fila por servicio
    return cot.ot.items.map((item, idx) => ({
      ...base,
      ...oc,
      ...financiamiento,
      "21. OT - N°": cot.ot.numero || "",
      "22. OT - Fecha": cot.ot.fecha || "",
      "23. Servicio - Ítem": idx + 1,
      "24. Servicio - Descripción": item.descripcion || "",
      "25. Servicio - Cantidad": item.cantidad || 0,
      "26. Servicio - Costo Unitario (CLP)": item.costo ? fmtMoney(item.costo) : "",
      "27. Servicio - Con IVA (19%)": item.conIVA ? "Sí" : "No",
      "28. Servicio - Otro Impuesto": item.otroActivo ? `${item.otroNombre || ""} (${item.otroPorcentaje || 0}%)` : "",
      "29. Servicio - Comentarios": item.comentarios || "",
      "30. Servicio - PDFs": item.pdfs?.length || 0,
    }));
  });

  // Crear hoja de Excel
  const ws = XLSX.utils.json_to_sheet(rows);
  
  // Ajustar ancho de columnas para mejor legibilidad
  const colWidths = rows.length > 0 
    ? Object.keys(rows[0]).map(key => ({ wch: Math.min(25, key.length + 2) }))
    : [];
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cotizaciones");

  // Generar y descargar archivo
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, `cotizaciones-${todayISO()}.xlsx`);
};
  return (
<div className="min-h-screen w-full bg-slate-50 text-slate-900 flex">
  {/* SIDEBAR IZQUIERDO */}
  <aside className={`w-64 h-screen ${company === 'MyOrganic' ? 'bg-gradient-to-b from-blue-900 to-blue-800' : 'bg-gradient-to-b from-orange-800 to-orange-900'} text-white fixed left-0 top-0 flex flex-col justify-between p-6 shadow-xl z-30`}>
    <div className="space-y-8">
      {/* Logo grande */}
      <div className="flex flex-col items-center justify-center mt-6 mb-4">
        {company === 'MyOrganic' ? (
          <img src="./logo-myorganic.png" alt="MyOrganic" className="h-20 mb-3" />
        ) : (
          <img src="./logo-meg.png" alt="MEG Industrial" className="h-20 mb-3" />
        )}
        <h1 className="text-xl font-bold tracking-tight text-center text-white/90">
          {company}
        </h1>
      </div>
    </div>

{/* Acciones en el footer del sidebar */}
<div className="space-y-3">
  <Button
    variant="ghost"
    onClick={() => navigate('/creacion')}
    className="w-full justify-start gap-3 text-white/80 hover:text-white hover:bg-white/10"
  >
    <span>Creación</span>
  </Button>

  {/* Separador */}
  <div className="border-t border-white/20 my-2"></div>

  {/* Backup del Sistema Completo */}
  <div className="text-white/60 text-xs font-semibold px-2 py-1">RESPALDO DEL SISTEMA</div>
  <Button
    variant="ghost"
    onClick={exportBackupCompleto}
    className="w-full justify-start gap-3 text-white/80 hover:text-white hover:bg-white/10"
  >
    <span>💾 Exportar Backup</span>
  </Button>
  <label className="cursor-pointer inline-flex items-center w-full justify-start gap-3 text-white/80 hover:text-white hover:bg-white/10 p-2 rounded">
    <span>📥 Restaurar Backup</span>
    <input
      type="file"
      accept="application/json"
      className="hidden"
      onChange={(e) => { const f = e.target.files?.[0]; if (f) importBackupCompleto(f); }}
    />
  </label>

  {/* Separador */}
  <div className="border-t border-white/20 my-2"></div>

  <Button
    variant="ghost"
    onClick={onLogout}
    className="w-full justify-start gap-3 text-white/80 hover:text-white hover:bg-white/10"
  >
    <span>Cerrar sesión</span>
  </Button>


  
</div>
  </aside>

  {/* MAIN CONTENT (derecho) */}
  <main className="ml-64 w-full flex flex-col min-h-screen">
    <div className="flex-1 max-w-7xl mx-auto px-6 py-8 w-full">
      <Tabs value={tab} onValueChange={setTab}>
        {/* Pestañas en el header superior */}
        <header className="sticky top-0 z-20 bg-white/95 border-b border-slate-200 shadow-sm mb-6">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <TabsList className="flex w-full md:w-auto gap-2 bg-slate-100/60 p-1 rounded-full border border-slate-200 shadow-sm">
                <TabsTrigger value="dashboard" className="rounded-full px-4 py-2 text-sm data-[state=active]:bg-white data-[state=active]:shadow data-[state=active]:text-slate-900 bg-transparent text-slate-700">
                  Dashboard
                </TabsTrigger>
                <TabsTrigger value="cotizaciones" className="rounded-full px-4 py-2 text-sm data-[state=active]:bg-white data-[state=active]:shadow data-[state=active]:text-slate-900 bg-transparent text-slate-700">
                  Cotizaciones
                </TabsTrigger>
                <TabsTrigger value="nueva" className="rounded-full px-4 py-2 text-sm data-[state=active]:bg-white data-[state=active]:shadow data-[state=active]:text-slate-900 bg-transparent text-slate-700">
                  Nueva cotización
                </TabsTrigger>
              </TabsList>
            </div>
          </div>
        </header>

        {/* DASHBOARD */}
        <TabsContent value="dashboard" className="mt-0 space-y-6">
          <div className="flex items-center gap-3 text-sm px-3 py-2 rounded-lg bg-white/80 border border-slate-200 shadow-sm w-fit">
            <input
              id="neto"
              type="checkbox"
              checked={usarNetoSinIVA}
              onChange={(e) => setUsarNetoSinIVA(e.target.checked)}
              className="h-4 w-4 accent-emerald-600"
            />
            <label htmlFor="neto" className="text-slate-700">
              Calcular Ingresos sin IVA (recomendado para utilidad)
            </label>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <KPICard
              title="Ingresos"
              value={fmtMoney(totales.ingresos)}
              subtitle={`${countAllFacturas(data)} factura(s) ${usarNetoSinIVA ? "· neto" : "· bruto"}`}
            />
            <KPICard
              title="Costos (OT)"
              value={fmtMoney(totales.costos)}
              subtitle={`${totOTCount(data)} cot(s) con OT`}
            />
            <KPICard title="Utilidad" value={fmtMoney(totales.utilidad)} highlight />
          </div>

          {/* Fila 1 */}
          <div className="grid lg:grid-cols-3 gap-4">
            {/* Ingresos vs Costos por mes */}
            <Card className="lg:col-span-2 bg-white border-0 shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">Ingresos vs Costos por mes</h3>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="inline-flex items-center gap-1 text-slate-600">
                      <Dot color={COLORS.ingresos} /> Ingresos
                    </span>
                    <span className="inline-flex items-center gap-1 text-slate-600">
                      <Dot color={COLORS.costos} /> Costos
                    </span>
                  </div>
                </div>

                <div className="h-[380px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={monthly}
                      margin={{ top: 20, right: 30, bottom: 70, left: 20 }}
                      barCategoryGap={8}
                      barSize={24}
                    >
                      <defs>
                        <linearGradient id="gIngresos" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLORS.ingresos} stopOpacity={0.8} />
                          <stop offset="100%" stopColor={COLORS.ingresos} stopOpacity={1} />
                        </linearGradient>
                        <linearGradient id="gCostos" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLORS.costos} stopOpacity={0.8} />
                          <stop offset="100%" stopColor={COLORS.costos} stopOpacity={1} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="4 4" stroke="#f1f5f9" vertical={false} />
                      <XAxis
                        dataKey="mes"
                        interval={0}
                        tick={{ fontSize: 13, fontWeight: 500, fill: '#475569' }}
                        angle={-45}
                        textAnchor="end"
                        height={60}
                        tickMargin={10}
                      />
                      <YAxis
                        width={90}
                        tickFormatter={(v) => CLP.format(v)}
                        tick={{ fontSize: 12, fontWeight: 500, fill: '#475569' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        content={<MoneyTooltip title="Detalle mensual" />}
                        cursor={{ fill: '#f8fafc', opacity: 0.6 }}
                      />
                      <Legend
                        verticalAlign="top"
                        height={40}
                        wrapperStyle={{ fontSize: 13, fontWeight: 600 }}
                      />
                      <Bar
                        dataKey="ingresos"
                        name="Ingresos"
                        fill="url(#gIngresos)"
                        radius={[6, 6, 0, 0]}
                        animationDuration={800}
                      />
                      <Bar
                        dataKey="costos"
                        name="Costos"
                        fill="url(#gCostos)"
                        radius={[6, 6, 0, 0]}
                        animationDuration={800}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Utilidad por cliente */}
            <Card className="bg-white/95 border-0 shadow-sm ring-1 ring-slate-100 backdrop-blur supports-[backdrop-filter]:backdrop-blur">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">Utilidad por cliente</h3>
                  <span className="text-xs text-slate-500">Top 10 + “Otros”</span>
                </div>
                {(() => {
                  const sorted = [...utilPorCliente].sort((a, b) => b.value - a.value);
                  const top = sorted.slice(0, 10);
                  if (sorted.length > 10) {
                    const otros = sorted.slice(10).reduce((s, x) => s + x.value, 0);
                    top.push({ name: "Otros", value: otros });
                  }
                  if (top.length === 0) {
                    return <div className="text-sm text-slate-500">Aún no hay utilidades positivas por cliente.</div>;
                  }
                  const height = Math.min(460, 44 * top.length + 80);
                  return (
                    <div style={{ height }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={top}
                          layout="vertical"
                          margin={{ top: 20, right: 70, bottom: 20, left: -80 }}
                          barSize={36}
                          maxBarSize={40}
                        >
                          <defs>
                            <linearGradient id="gUtilidad" x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor={COLORS.utilidad} stopOpacity={0.8} />
                              <stop offset="100%" stopColor={COLORS.utilidad} stopOpacity={1} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="4 4" stroke="#f1f5f9" horizontal={false} />
                          <XAxis
                            type="number"
                            tickFormatter={(v) => CLP.format(v)}
                            tick={{ fontSize: 12, fontWeight: 500, fill: '#475569' }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            type="category"
                            dataKey="name"
                            width={150}
                            tick={{ fontSize: 12, fontWeight: 600, fill: '#1e293b' }}
                            axisLine={false}
                            tickLine={false}
                            tickMargin={8}
                          />
                          <Tooltip
                            content={<MoneyTooltip title="Utilidad por cliente" />}
                            cursor={{ fill: COLORS.utilidad, opacity: 0.1 }}
                          />
                          <Bar
                            dataKey="value"
                            name="Utilidad"
                            fill="url(#gUtilidad)"
                            radius={[0, 8, 8, 0]}
                            animationDuration={900}
                          >
                            <LabelList
                              dataKey="value"
                              position="right"
                              formatter={(v) => fmtMoney(v)}
                              offset={16}
                              className="text-sm font-bold fill-slate-800"
                            />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </div>

          {/* Fila 2 */}
          <div className="grid lg:grid-cols-3 gap-4">
            {/* Ingresos (histórico) */}
            <Card className="lg:col-span-2 bg-white border-0 shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">Ingresos (histórico)</h3>
                  <span className="text-xs text-slate-500">Desliza para ver meses anteriores</span>
                </div>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={monthly}
                      margin={{ top: 20, right: 20, left: 20, bottom: 80 }}
                    >
                      <defs>
                        <linearGradient id="areaIngresos" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COLORS.ingresos} stopOpacity={0.4} />
                          <stop offset="100%" stopColor={COLORS.ingresos} stopOpacity={0.08} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="4 4" stroke="#f1f5f9" vertical={false} />
                      <XAxis
                        dataKey="mes"
                        interval={0}
                        tick={{ fontSize: 12, fontWeight: 500, fill: '#475569' }}
                        angle={-45}
                        textAnchor="end"
                        height={60}
                        tickMargin={15}
                      />
                      <YAxis
                        width={90}
                        tickFormatter={(v) => CLP.format(v)}
                        tick={{ fontSize: 12, fontWeight: 500, fill: '#475569' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        content={<MoneyTooltip title="Ingresos mensuales" />}
                        cursor={{ fill: COLORS.ingresos, opacity: 0.1 }}
                      />
                      <Area
                        type="monotone"
                        dataKey="ingresos"
                        stroke={COLORS.ingresos}
                        strokeWidth={3}
                        fill="url(#areaIngresos)"
                        fillOpacity={1}
                        animationDuration={1000}
                      />
                      <Brush
                        dataKey="mes"
                        height={24}
                        stroke={COLORS.ingresos}
                        travellerWidth={12}
                        fill="#f8fafc"
                        fillOpacity={0.6}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Composición Ingresos vs Costos */}
            <Card className="bg-white/95 border-0 shadow-sm ring-1 ring-slate-100 backdrop-blur supports-[backdrop-filter]:backdrop-blur">
              <CardContent className="p-5">
                <h3 className="font-semibold mb-3">Composición</h3>
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip
                        content={<MoneyTooltip title="Composición financiera" />}
                        cursor={{ fill: '#f8fafc', opacity: 0.6 }}
                      />
                      <Legend
                        verticalAlign="bottom"
                        height={40}
                        iconType="circle"
                        formatter={(value) => (
                          <span className="text-sm font-medium text-slate-700">{value}</span>
                        )}
                      />
                      <Pie
                        data={compData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={4}
                        labelLine={false}
                        label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
                        animationDuration={1000}
                      >
                        {compData.map((e, i) => (
                          <Cell key={i} fill={e.color} stroke="none" />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Comparativa de ganancias mensuales */}
          <Card className="bg-white/95 border-0 shadow-sm ring-1 ring-slate-100 backdrop-blur supports-[backdrop-filter]:backdrop-blur">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Ganancias mensuales (utilidad)</h3>
                {monthlyUtilidad.length > 1 && (
                  (() => {
                    const last = monthlyUtilidad[monthlyUtilidad.length - 1];
                    const sign = (last.deltaUtil || 0) >= 0 ? "+" : "";
                    return (
                      <span className="text-xs text-slate-600">
                        Último mes: {fmtMoney(last.utilidad)} ({sign}{Math.round((last.pctUtil || 0))}% vs mes previo)
                      </span>
                    );
                  })()
                )}
              </div>
              <div className="h-[340px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={monthlyUtilidad}
                    margin={{ top: 20, right: 30, bottom: 80, left: 20 }}
                    barSize={28}
                  >
                    <defs>
                      <linearGradient id="gUtilMes" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLORS.utilidad} stopOpacity={0.7} />
                        <stop offset="100%" stopColor={COLORS.utilidad} stopOpacity={1} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="4 4" stroke="#f1f5f9" vertical={false} />
                    <XAxis
                      dataKey="mes"
                      interval={0}
                      tick={{ fontSize: 13, fontWeight: 500, fill: '#475569' }}
                      angle={-45}
                      textAnchor="end"
                      height={70}
                      tickMargin={15}
                    />
                    <YAxis
                      width={90}
                      tickFormatter={(v) => CLP.format(v)}
                      tick={{ fontSize: 12, fontWeight: 500, fill: '#475569' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      content={<MoneyTooltip title="Utilidad mensual" />}
                      cursor={{ fill: COLORS.utilidad, opacity: 0.1 }}
                    />
                    <Bar
                      dataKey="utilidad"
                      name="Utilidad"
                      fill="url(#gUtilMes)"
                      radius={[6, 6, 0, 0]}
                      animationDuration={900}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

  {/* COTIZACIONES */}
<TabsContent value="cotizaciones" className="mt-0 space-y-4">
  {/* Botón de exportación a Excel */}
  <div className="flex justify-end mb-2">
    <Button variant="default" onClick={exportToExcel} className="gap-2">
      <FileText size={16} />
      Exportar a Excel
    </Button>
  </div>

  <Card className="bg-white/95 border-0 shadow-sm ring-1 ring-slate-100 backdrop-blur supports-[backdrop-filter]:backdrop-blur">
    <CardContent className="p-4 space-y-3">
      <h3 className="font-semibold">Filtros</h3>
      <FiltrosCotizaciones filtros={filtros} onChange={setFiltros} setPaginaActual={setPaginaActual} />
    </CardContent>
  </Card>

<ListadoCotizaciones
  cotizaciones={data?.cotizaciones || []}
  usarNetoSinIVA={usarNetoSinIVA}
  filtros={filtros}
  paginaActual={paginaActual}
  setPaginaActual={setPaginaActual}
  ITEMS_POR_PAGINA={ITEMS_POR_PAGINA}
  sel={sel}
  setSel={setSel}
  onDuplicar={duplicarCotizacion}
  onSaveCotizacion={async (updated) => {
    try {
      // ✅ Obtener TODAS las cotizaciones del backend (incluyendo eliminadas)
      const res = await fetch(`${API_BASE}/api/data?key=${encodeURIComponent(user)}`);
      if (!res.ok) {
        toast.error('Error al cargar datos del servidor');
        return;
      }
      const fullData = await res.json();
      const todasLasCotizaciones = fullData?.cotizaciones || [];

      const nuevasCotizaciones = todasLasCotizaciones.map(x =>
        x.id === updated.id ? { ...updated, updatedAt: new Date().toISOString() } : x
      );
      setData({ ...data, cotizaciones: nuevasCotizaciones });
    } catch (e) {
      console.error('Error al guardar cotización:', e);
      toast.error('Error al guardar la cotización');
    }
  }}
  onDeleteCotizacion={async (id) => {
    try {
      console.log('[DELETE] 🗑️ Eliminando cotización con ID:', id);

      // ✅ Obtener TODAS las cotizaciones del backend (incluyendo eliminadas)
      const res = await fetch(`${API_BASE}/api/data?key=${encodeURIComponent(user)}`);
      if (!res.ok) {
        toast.error('Error al cargar datos del servidor');
        return;
      }
      const fullData = await res.json();
      const todasLasCotizaciones = fullData?.cotizaciones || [];

      console.log('[DELETE] 📊 Total de cotizaciones en backend:', todasLasCotizaciones.length);
      console.log('[DELETE] 📊 Cotizaciones visibles:', todasLasCotizaciones.filter(x => !x.deleted).length);
      console.log('[DELETE] 📊 Cotizaciones eliminadas:', todasLasCotizaciones.filter(x => x.deleted).length);

      // Soft delete: marcar como deleted y eliminar PDFs para ahorrar espacio
      const nuevasCotizaciones = todasLasCotizaciones.map(x => {
        if (x.id !== id) return x;

        console.log('[DELETE] ✅ Marcando como eliminada:', x.numero || x.id);

        // Eliminar PDFs de la cotización y sus sub-entidades para reducir tamaño
        const cleaned = {
          ...x,
          deleted: true,
          updatedAt: new Date().toISOString(),
          pdfs: [], // Eliminar PDFs raíz
          oc: x.oc ? { ...x.oc, pdfs: [] } : x.oc, // Eliminar PDFs de OC
          ot: x.ot ? {
            ...x.ot,
            pdfs: [], // Eliminar PDFs de OT
            items: (x.ot.items || []).map(item => ({ ...item, pdfs: [] })) // Eliminar PDFs de items
          } : x.ot,
          facturas: (x.facturas || []).map(f => ({ ...f, pdfs: [] })), // Eliminar PDFs de facturas
          financiamiento: x.financiamiento ? { ...x.financiamiento, pdfs: [] } : x.financiamiento
        };

        return cleaned;
      });

      console.log('[DELETE] 📊 Después de marcar eliminada:');
      console.log('[DELETE] 📊   Total:', nuevasCotizaciones.length);
      console.log('[DELETE] 📊   Visibles:', nuevasCotizaciones.filter(x => !x.deleted).length);
      console.log('[DELETE] 📊   Eliminadas:', nuevasCotizaciones.filter(x => x.deleted).length);

      // ✅ Enviar TODAS las cotizaciones (incluyendo eliminadas con deleted: true) para sincronización correcta
      setData({ ...data, cotizaciones: nuevasCotizaciones });
    } catch (e) {
      console.error('Error al eliminar cotización:', e);
      toast.error('Error al eliminar la cotización');
    }
  }}
/>
        </TabsContent>

        {/* NUEVA COTIZACIÓN */}
        <TabsContent value="nueva" className="mt-0">
          <Card className="bg-white/95 border-0 shadow-sm ring-1 ring-slate-100 backdrop-blur supports-[backdrop-filter]:backdrop-blur">
            <CardContent className="p-6 space-y-6">
              <h3 className="text-xl font-semibold">Crear Cotización</h3>
              <CotizacionForm
                onSave={async (c) => {
                  try {
                    // ✅ Obtener TODAS las cotizaciones del backend (incluyendo eliminadas)
                    const res = await fetch(`${API_BASE}/api/data?key=${encodeURIComponent(user)}`);
                    if (!res.ok) {
                      toast.error('Error al cargar datos del servidor');
                      return;
                    }
                    const fullData = await res.json();
                    const todasLasCotizaciones = fullData?.cotizaciones || [];

                    const nuevasCotizaciones = [c, ...todasLasCotizaciones];
                    setData({ ...data, cotizaciones: nuevasCotizaciones });
                  } catch (e) {
                    console.error('Error al crear cotización:', e);
                    toast.error('Error al crear la cotización');
                  }
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>

    {/* FOOTER */}
    <footer className="mt-8 bg-gradient-to-r from-slate-900 to-slate-800 text-white">
      <div className="max-w-7xl mx-auto px-6 py-4 text-sm flex items-center justify-center">
        <span>© {new Date().getFullYear()} {user === 'myorganic' ? 'MyOrganic' : 'MEG Industrial'}. Todos los derechos reservados.</span>
      </div>
    </footer>
  </main>
</div>

);

}

/********************
 * HELPERS UI
 *******************/

const totOTCount = (data) => (data?.cotizaciones || []).filter(c=> (c?.ot?.items||[]).length>0).length;

function KPICard({ title, value, subtitle, highlight }) {
  const accent = highlight ? COLORS.utilidad : COLORS.ingresos;
  return (
    <Card className="border-0 shadow-sm bg-white/95 backdrop-blur supports-[backdrop-filter]:backdrop-blur ring-1 ring-slate-100">
      <CardContent className="p-5 relative">
        <div
          className="absolute left-0 top-0 h-full w-1.5 rounded-l-xl"
          style={{ background: accent }}
        />
        <div className="text-[13px] text-slate-500">{title}</div>
        <div className="text-3xl font-semibold tracking-tight mt-1">{value}</div>
        {subtitle && <div className="text-xs text-slate-500 mt-1">{subtitle}</div>}
      </CardContent>
    </Card>
  );
}



function Field({ label, children, className }){
  return (
    <div className={className}>
      <Label className="text-slate-700">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function SumBox({ title, value, highlight }) {
  return (
    <div className={`p-5 rounded-xl shadow-sm ${highlight ? "bg-emerald-50" : "bg-white"} border-0`}>
      <div className="text-[13px] text-slate-500">{title}</div>
      <div className="text-xl font-semibold tracking-tight mt-1">{value}</div>
    </div>
  );
}
/********************
 * ADMIN DE PDFs (con visor embebido)
 *******************/
function PDFManager({ label, files = [], onChange }){
  const toast = useToast();
  const addInputRef = React.useRef(null);
  const replaceRefs = React.useRef({});
  const [preview, setPreview] = useState(null);

  const addFiles = async (fileList) => {
    try{
      const arr = Array.from(fileList || []);
      if (arr.length === 0) return;
      const loaded = await Promise.all(arr.map(readFileAsDataURL));
      onChange([...(files||[]), ...loaded]);
    }catch(e){
      toast.error(e.message || "No se pudo cargar el archivo");
    }
  };

  const onClickAdd = () => addInputRef.current?.click();
  const onReplace = (id) => replaceRefs.current[id]?.click();

  const handleReplace = async (id, file) => {
    if (!file) return;
    try{
      const loaded = await readFileAsDataURL(file);
      onChange((files||[]).map(f=> f.id===id ? loaded : f));
    }catch(e){
      toast.error(e.message || "No se pudo reemplazar el archivo");
    }
  };

  const removeFile = (id) => onChange((files||[]).filter(f=>f.id!==id));

  const onDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-slate-700">{label}</div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" className="gap-2" onClick={onClickAdd}><Upload size={16}/> Agregar PDF</Button>
          <input
            ref={addInputRef}
            type="file" accept="application/pdf" multiple className="hidden"
            onChange={e=>{
              if (e.target.files) addFiles(e.target.files);
              e.target.value="";
            }}
          />
        </div>
      </div>

      <div
  className="rounded-xl border border-dashed border-slate-300/80 bg-slate-50/70 p-3 text-center text-slate-500
             hover:bg-slate-50 transition-colors"
  onDragOver={(e)=>e.preventDefault()}
  onDrop={onDrop}
>
  Arrastra y suelta PDF(s) aquí, o usa “Agregar PDF”.
</div>


      <Card className="bg-white/95 border-0 shadow-sm ring-1 ring-slate-100 backdrop-blur supports-[backdrop-filter]:backdrop-blur">

        <CardContent className="p-0">
          <Table className="text-sm
  [&_thead_th]:text-slate-600 [&_thead_th]:font-semibold [&_thead_th]:bg-slate-50/80
  [&_thead_th]:backdrop-blur [&_thead_th]:border-b [&_thead_th]:border-slate-200
  [&_tbody_tr]:hover:bg-slate-50
  [&_tbody_tr:nth-child(even)]:bg-white [&_tbody_tr:nth-child(odd)]:bg-slate-50/40
  [&_td]:align-top"
>

            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead className="w-32">Tamaño</TableHead>
                <TableHead className="w-40">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(files||[]).length===0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-neutral-500 py-4">Sin PDFs</TableCell></TableRow>
              )}
              {(files||[]).map(f=>(
                <TableRow key={f.id} className="hover:bg-neutral-50">
                  <TableCell><FileText size={16}/></TableCell>
                  <TableCell className="truncate">{f.name || "Documento.pdf"}</TableCell>
                  <TableCell>{Math.round((f.size||0)/1024)} KB</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
  size="sm"
  variant="secondary"
  onClick={async () => {
    if (window.electronAPI) {
      const result = await window.electronAPI.openPDF({
        name: f.name || 'documento.pdf',
        dataUrl: f.dataUrl
      });
      if (!result.success) {
        toast.error('Error al abrir el PDF: ' + (result.message || 'Error desconocido'));
      }
    } else {
      // Fallback para desarrollo en navegador
      window.open(f.dataUrl, '_blank');
    }
  }}
>
  Ver
</Button>
                      <Button size="sm" variant="secondary" onClick={()=>onReplace(f.id)}>Reemplazar</Button>
                      <input
                        ref={el=>{ if (el) replaceRefs.current[f.id] = el; }}
                        type="file" accept="application/pdf" className="hidden"
                        onChange={e=>{
                          const file = e.target.files?.[0];
                          handleReplace(f.id, file);
                          e.target.value="";
                        }}
                      />
                      <Button size="sm" variant="ghost" onClick={()=>removeFile(f.id)}><Trash2 size={16}/></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!preview} onOpenChange={(o)=>{ if(!o) setPreview(null); }}>
        <DialogContent className="max-w-5xl h-[80vh] overflow-hidden border-0 shadow-2xl bg-white rounded-2xl"
>
          <DialogHeader><DialogTitle>{preview?.name || "Vista de PDF"}</DialogTitle></DialogHeader>
          {preview && (
            <iframe title="pdf" src={preview.dataUrl} className="w-full h-full rounded-lg border" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/********************
 * FORMULARIO — COTIZACIÓN (NUEVA)
 * - Cliente + RUT
 * - OC con Cliente/Empresa + RUT propios
 * - OT: por servicio -> Con IVA 19%, Otro impuesto (% + nombre), PDFs por servicio
 * - Facturas múltiples con PDFs
 *******************/
function CotizacionForm({ onSave }){
  const toast = useToast();
  const { user } = useAuth();

  // Cargar datos del apartado de creación para autocompletado
  const [datosCreacion, setDatosCreacion] = useState({ cotizaciones: [], ordenesCompra: [] });
  const [cargandoCreacion, setCargandoCreacion] = useState(true);

  // Estados de búsqueda para filtrar opciones
  const [busquedaCot, setBusquedaCot] = useState("");
  const [busquedaOC, setBusquedaOC] = useState("");

  // Datos clave
  const [numero, setNumero] = useState(
    "CTZ-" + new Date().toISOString().slice(2,10).replaceAll("-","") + "-" + (1+Math.floor(Math.random()*99)).toString().padStart(2,"0")
  );
  const [fecha, setFecha] = useState(todayISO());
  const [cliente, setCliente] = useState("");
  const [rut, setRUT] = useState("");                      // NUEVO: RUT del cliente
  const [solicitud, setSolicitud] = useState("");
  const [montoCot, setMontoCot] = useState(0);
  const [cotPDFs, setCotPDFs] = useState([]);

  // OC
  const [ocClienteNombre, setOCClienteNombre] = useState(""); // NUEVO
  const [ocClienteRUT, setOCClienteRUT] = useState("");       // NUEVO
  const [ocCodigo, setOCCodigo] = useState("");
  const [ocDescripcion, setOCDescripcion] = useState("");
  const [ocMonto, setOCMonto] = useState(0);
  const [ocPDFs, setOCPDFs] = useState([]);

  // OT
  const [otNumero, setOTNumero] = useState("");
  const [otFecha, setOTFecha] = useState(todayISO());
  const [otPDFs, setOTPDFs] = useState([]);

  const [otItems, setOTItems] = useState([ // cada servicio con impuestos propios + PDFs
    { id:uid(), descripcion:"Servicio", cantidad:1, costo:0, conIVA:false, otroActivo:false, otroNombre:"", otroPorcentaje:0, pdfs:[] }
  ]);

  // Comentarios
  const [comentarios, setComentarios] = useState("");
  const [ocComentarios, setOCComentarios] = useState("");
  const [otComentarios, setOTComentarios] = useState("");

  // Facturas (múltiples)
   const [facturas, setFacturas] = useState([
  { id: uid(), fecha: todayISO(), total: 0, descripcion: "", comentarios: "", pdfs: [], clienteNombre: cliente || "", clienteRUT: rut || "" }
  ]);

  // FINANCIAMIENTO (registro)
   const [finCliente, setFinCliente] = useState("");
   const [finNumeroDocumento, setFinNumeroDocumento] = useState("");
   const [finRUT, setFinRUT] = useState("");
   const [finMonto, setFinMonto] = useState(0);
   const [finPDFs, setFinPDFs] = useState([]);



  // Helpers OT (items)
  const addOTItem = () =>
    setOTItems(prev => [...prev, { id:uid(), descripcion:"", cantidad:1, costo:0, conIVA:false, otroActivo:false, otroNombre:"", otroPorcentaje:0, pdfs:[] }]);

  const rmOTItem  = (id) => setOTItems(prev => prev.filter(i=>i.id!==id));
  const upOTItem  = (id, patch) => setOTItems(prev => prev.map(i=> i.id===id ? { ...i, ...patch } : i));

  // Totales OT (usa helpers globales)
  const otTotal = otItems.reduce((s,i)=> s + itemSubtotal(i), 0);

  // Facturas helpers
  const addFactura = () => setFacturas(prev => ([
  ...prev,
  { id: uid(), fecha: todayISO(), total: 0, descripcion: "", comentarios: "", pdfs: [], clienteNombre: cliente || "", clienteRUT: rut || "" }
]));

  const rmFactura  = (id) => setFacturas(prev => prev.filter(f=>f.id!==id));
  const upFactura  = (id, patch) => setFacturas(prev => prev.map(f=> f.id===id ? { ...f, ...patch } : f));

  const factSumBruto = facturas.reduce((s,f)=> s + Number(f.total||0), 0);
  const utilidadRef  = Math.max(factSumBruto - otTotal, 0);

  // Cargar datos del apartado de creación
  useEffect(() => {
    const cargarDatosCreacion = async () => {
      try {
        const res = await fetch(`http://localhost:3001/api/creacion?key=${encodeURIComponent(user)}`);
        if (res.ok) {
          const json = await res.json();
          setDatosCreacion({
            cotizaciones: (json.cotizaciones || []).filter(x => !x.deleted),
            ordenesCompra: (json.ordenesCompra || []).filter(x => !x.deleted)
          });
        }
      } catch (e) {
        console.error('Error al cargar datos de creación:', e);
      } finally {
        setCargandoCreacion(false);
      }
    };
    cargarDatosCreacion();
  }, [user]);

  // Autocompletar desde cotización del apartado de creación
  const autocompletarDesdeCotizacion = (cotizacionId) => {
    const cotSeleccionada = datosCreacion.cotizaciones.find(c => c.id === cotizacionId);
    if (!cotSeleccionada) return;

    // Actualizar campos
    if (cotSeleccionada.cliente) {
      const nombreCliente = typeof cotSeleccionada.cliente === 'object'
        ? (cotSeleccionada.cliente.nombre || cotSeleccionada.cliente.empresa || '')
        : cotSeleccionada.cliente;
      setCliente(nombreCliente);
    }
    if (cotSeleccionada.cliente?.rut) setRUT(cotSeleccionada.cliente.rut);
    if (cotSeleccionada.solicitud) setSolicitud(cotSeleccionada.solicitud);
    if (cotSeleccionada.comentarios) setComentarios(cotSeleccionada.comentarios);
    if (cotSeleccionada.fecha) setFecha(cotSeleccionada.fecha);
    if (cotSeleccionada.monto != null) setMontoCot(Number(cotSeleccionada.monto) || 0);
    if (cotSeleccionada.pdfs) setCotPDFs([...cotSeleccionada.pdfs]);

    setBusquedaCot(""); // Limpiar búsqueda
    toast.success('Datos autocompletados desde cotización de creación');
  };

  // Autocompletar desde OC del apartado de creación
  const autocompletarDesdeOC = (ocId) => {
    const ocSeleccionada = datosCreacion.ordenesCompra.find(oc => oc.id === ocId);
    if (!ocSeleccionada) return;

    // Actualizar campos de OC
    if (ocSeleccionada.clienteNombre) setOCClienteNombre(ocSeleccionada.clienteNombre);
    if (ocSeleccionada.clienteRUT) setOCClienteRUT(ocSeleccionada.clienteRUT);
    if (ocSeleccionada.codigo) setOCCodigo(ocSeleccionada.codigo);
    if (ocSeleccionada.monto != null) setOCMonto(Number(ocSeleccionada.monto) || 0);
    if (ocSeleccionada.descripcion) setOCDescripcion(ocSeleccionada.descripcion);
    if (ocSeleccionada.comentarios) setOCComentarios(ocSeleccionada.comentarios);
    if (ocSeleccionada.pdfs) setOCPDFs([...ocSeleccionada.pdfs]);

    setBusquedaOC(""); // Limpiar búsqueda
    toast.success('Datos de OC autocompletados desde creación');
  };

  const save = () => {
    if (!cliente) { toast.error("Ingresa el cliente/empresa"); return; }
    if (!rut) { toast.error("Ingresa el RUT del cliente/empresa"); return; }


const c = {
  id: uid(),
  numero,
  fecha,
  cliente,
  rut,
  solicitud,
  monto: Number(montoCot||0),
  comentarios,                      // ya agregado en el paso anterior
  pdfs: cotPDFs,
  updatedAt: new Date().toISOString(), // Para sincronización

  oc: {
    clienteNombre: ocClienteNombre,
    clienteRUT: ocClienteRUT,
    codigo: ocCodigo,
    descripcion: ocDescripcion,
    monto: Number(ocMonto||0),
    comentarios: ocComentarios,     // ya agregado en el paso anterior
    pdfs: ocPDFs
  },

  ot: {
    numero: otNumero,
    fecha: otFecha,
    comentarios: otComentarios,     // ya agregado en el paso anterior
    items: otItems,
    pdfs: otPDFs
  },

  facturas: facturas.map(f => ({
    id: f.id || uid(),
    fecha: f.fecha || todayISO(),
    total: Number(f.total || 0),
    descripcion: f.descripcion || "",
    comentarios: f.comentarios || "",
    pdfs: Array.isArray(f.pdfs) ? f.pdfs : [],
    clienteNombre: f.clienteNombre || cliente || "",
    clienteRUT: f.clienteRUT || rut || "",
  })),

  // NUEVO: FINANCIAMIENTO
  financiamiento: {
    cliente: finCliente || "",
    numeroDocumento: finNumeroDocumento || "",
    rut: finRUT || "",
    monto: Number(finMonto || 0),
    pdfs: finPDFs || []
  }
};



    onSave(c);
    toast.success("Cotización guardada exitosamente");
  };

  return (
    <div className="space-y-8">
      {/* Autocompletado desde apartado de creación */}
      {!cargandoCreacion && (datosCreacion.cotizaciones.length > 0 || datosCreacion.ordenesCompra.length > 0) && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h5 className="text-sm font-semibold text-blue-900 mb-3">Autocompletar desde Apartado de Creación</h5>
          <div className="grid md:grid-cols-2 gap-4">
            {datosCreacion.cotizaciones.length > 0 && (
              <div className="space-y-2">
                <Field label="Buscar Cotización (opcional)">
                  <Input
                    value={busquedaCot}
                    onChange={e => setBusquedaCot(e.target.value)}
                    placeholder="Escribe para filtrar..."
                    className="w-full"
                  />
                </Field>
                {busquedaCot && (
                  <div className="max-h-48 overflow-y-auto border border-slate-300 rounded-md bg-white">
                    {datosCreacion.cotizaciones
                      .filter(c => {
                        const numero = c.numero || '';
                        const cliente = typeof c.cliente === 'object'
                          ? (c.cliente?.nombre || c.cliente?.empresa || '')
                          : (c.cliente || '');
                        const search = busquedaCot.toLowerCase();
                        return numero.toLowerCase().includes(search) ||
                               cliente.toLowerCase().includes(search);
                      })
                      .map(c => (
                        <button
                          key={c.id}
                          onClick={() => autocompletarDesdeCotizacion(c.id)}
                          className="w-full text-left px-3 py-2 hover:bg-blue-100 text-sm border-b border-slate-200 last:border-b-0"
                        >
                          <div className="font-medium text-slate-900">{c.numero || 'Sin número'}</div>
                          <div className="text-xs text-slate-600">
                            {typeof c.cliente === 'object' ? (c.cliente?.nombre || c.cliente?.empresa) : c.cliente || 'Sin cliente'}
                            {c.monto ? ` • ${fmtMoney(c.monto)}` : ''}
                          </div>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}
            {datosCreacion.ordenesCompra.length > 0 && (
              <div className="space-y-2">
                <Field label="Buscar OC (opcional)">
                  <Input
                    value={busquedaOC}
                    onChange={e => setBusquedaOC(e.target.value)}
                    placeholder="Escribe para filtrar..."
                    className="w-full"
                  />
                </Field>
                {busquedaOC && (
                  <div className="max-h-48 overflow-y-auto border border-slate-300 rounded-md bg-white">
                    {datosCreacion.ordenesCompra
                      .filter(oc => {
                        const codigo = oc.codigo || oc.numero || '';
                        const cliente = oc.clienteNombre || '';
                        const search = busquedaOC.toLowerCase();
                        return codigo.toLowerCase().includes(search) ||
                               cliente.toLowerCase().includes(search);
                      })
                      .map(oc => (
                        <button
                          key={oc.id}
                          onClick={() => autocompletarDesdeOC(oc.id)}
                          className="w-full text-left px-3 py-2 hover:bg-blue-100 text-sm border-b border-slate-200 last:border-b-0"
                        >
                          <div className="font-medium text-slate-900">{oc.codigo || oc.numero || 'Sin código'}</div>
                          <div className="text-xs text-slate-600">
                            {oc.clienteNombre || 'Sin cliente'}
                            {oc.monto ? ` • ${fmtMoney(oc.monto)}` : ''}
                          </div>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Datos clave */}
    <section className="grid md:grid-cols-3 gap-4">
  <Field label="Codigo Cotización"><Input value={numero} onChange={e=>setNumero(e.target.value)} /></Field>
  <Field label="Fecha"><Input type="date" value={fecha} onChange={e=>setFecha(e.target.value)} /></Field>
  <Field label="Monto Cotización (registro)">
  <MoneyInput valueNumber={montoCot} onValueNumberChange={setMontoCot} placeholder="0" />
</Field>


  <Field label="Cliente / Empresa"><Input value={cliente} onChange={e=>setCliente(e.target.value)} placeholder="Razón social o nombre" /></Field>
  <Field label="RUT"><Input value={rut} onChange={e=>setRUT(e.target.value)} placeholder="76.123.456-7" /></Field>
  <Field label="Solicitud / Proyecto"><Input value={solicitud} onChange={e=>setSolicitud(e.target.value)} placeholder="Detalle del proyecto/servicio" /></Field>

  {/* NUEVO: Comentarios de la cotización */}
  <div className="md:col-span-3">
    <Field label="Comentarios de la cotización">
      <textarea
        value={comentarios}
        onChange={e=>setComentarios(e.target.value)}
        className="w-full min-h-[90px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        placeholder="Notas internas, consideraciones, etc."
      />
    </Field>
  </div>
</section>


      <PDFManager label="PDF(s) de la Cotización" files={cotPDFs} onChange={setCotPDFs} />

      {/* OC del Cliente */}
{/* OC del Cliente */}
<section className="grid md:grid-cols-3 gap-4">
  <Field label="Cliente/Empresa (OC)"><Input value={ocClienteNombre} onChange={e=>setOCClienteNombre(e.target.value)} placeholder="Nombre OC" /></Field>
  <Field label="RUT (OC)"><Input value={ocClienteRUT} onChange={e=>setOCClienteRUT(e.target.value)} placeholder="76.123.456-7" /></Field>
  <Field label="OC (código)"><Input value={ocCodigo} onChange={e=>setOCCodigo(e.target.value)} placeholder="OC-1234 / referencia" /></Field>

  <Field label="Monto OC (registro)"><MoneyInput valueNumber={ocMonto} onValueNumberChange={setOCMonto} placeholder="0" /></Field>
  <Field label="Descripción OC" className="md:col-span-2">
    <Input value={ocDescripcion} onChange={e=>setOCDescripcion(e.target.value)} placeholder="Detalle o alcance de la OC" />
  </Field>

  {/* NUEVO: Comentarios OC */}
  <div className="md:col-span-3">
    <Field label="Comentarios OC">
      <textarea
        value={ocComentarios}
        onChange={e=>setOCComentarios(e.target.value)}
        className="w-full min-h-[90px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        placeholder="Notas de la Orden de Compra del cliente"
      />
    </Field>
  </div>
</section>

      <PDFManager label="PDF(s) de la OC del Cliente" files={ocPDFs} onChange={setOCPDFs} />

      {/* OT */}
      <section className="space-y-3">
        <div className="grid md:grid-cols-3 gap-4">
          <Field label="Codigo OT"><Input value={otNumero} onChange={e=>setOTNumero(e.target.value)} placeholder="OT-0001 / ref interna" /></Field>
          <Field label="Fecha OT"><Input type="date" value={otFecha} onChange={e=>setOTFecha(e.target.value)} /></Field>
        </div>

        <Card className="bg-white/95 border-0 shadow-sm ring-1 ring-slate-100 backdrop-blur supports-[backdrop-filter]:backdrop-blur">

          <CardContent className="p-0">
            <Table className="text-sm
  [&_thead_th]:text-slate-600 [&_thead_th]:font-semibold [&_thead_th]:bg-slate-50/80
  [&_thead_th]:backdrop-blur [&_thead_th]:border-b [&_thead_th]:border-slate-200
  [&_tbody_tr]:hover:bg-slate-50
  [&_tbody_tr:nth-child(even)]:bg-white [&_tbody_tr:nth-child(odd)]:bg-slate-50/40
  [&_td]:align-top"
>

              <TableHeader>
                <TableRow>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="w-20 text-right">Cantidad</TableHead>
                  <TableHead className="w-32 text-right">Costo Unit.</TableHead>
                  <TableHead className="w-28 text-center">Con IVA</TableHead>
                  <TableHead className="w-[320px]">Otro impuesto</TableHead>
                  <TableHead className="w-32 text-right">Subtotal</TableHead>
                  <TableHead className="w-44 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {otItems.map(it => {
                  const base = Number(it.cantidad||0) * Number(it.costo||0);
                  const subtotal = itemSubtotal(it);
                  return (
                    <TableRow key={it.id} className="hover:bg-neutral-50 align-top">
                      <TableCell className="min-w-[220px]">
                        <Input value={it.descripcion} onChange={e=>upOTItem(it.id, { descripcion:e.target.value })} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input type="number" value={it.cantidad} onChange={e=>upOTItem(it.id, { cantidad:Number(e.target.value) })} />
                      </TableCell>
                      <TableCell className="text-right">
                        <MoneyInput valueNumber={it.costo} onValueNumberChange={(val)=>upOTItem(it.id, { costo: val })} placeholder="0" />
                      </TableCell>

                      {/* Con IVA 19% */}
                      <TableCell className="text-center">
                        <input
                          type="checkbox"
                          checked={!!it.conIVA}
                          onChange={e=>upOTItem(it.id, { conIVA: e.target.checked })}
                        />
                        <div className="text-[11px] text-neutral-500 mt-1">19%</div>
                      </TableCell>

                      {/* Otro impuesto */}
                      <TableCell>
                        <div className="flex flex-col gap-2">
                          <label className="inline-flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={!!it.otroActivo}
                              onChange={e=>upOTItem(it.id, { otroActivo: e.target.checked })}
                            />
                            <span className="text-neutral-700">Activar</span>
                          </label>
                          {it.otroActivo && (
                            <div className="grid grid-cols-5 gap-2">
                              <div className="col-span-3">
                                <Input
                                  placeholder="Nombre impuesto"
                                  value={it.otroNombre}
                                  onChange={e=>upOTItem(it.id, { otroNombre: e.target.value })}
                                />
                              </div>
                              <div className="col-span-2">
                                <Input
                                  type="number"
                                  placeholder="%"
                                  value={it.otroPorcentaje}
                                  onChange={e=>upOTItem(it.id, { otroPorcentaje: Number(e.target.value) })}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="text-right font-medium align-middle">{fmtMoney(subtotal)}</TableCell>

                      {/* Acciones: PDFs + eliminar */}
                      <TableCell className="text-right">
                        <div className="flex flex-col gap-2">
                          <div className="flex justify-end gap-2">
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button size="sm" variant="secondary">PDFs ({(it.pdfs||[]).length})</Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                                <DialogHeader><DialogTitle>PDF(s) del servicio</DialogTitle></DialogHeader>
                                <PDFManager
                                  label="Adjuntos del servicio"
                                  files={it.pdfs || []}
                                  onChange={(arr)=> upOTItem(it.id, { pdfs: arr })}
                                />
                              </DialogContent>
                            </Dialog>

                            <Button size="sm" variant="ghost" onClick={()=>rmOTItem(it.id)}><Trash2 size={16}/></Button>
                          </div>
                        </div>
                        <div className="text-[11px] text-neutral-500 mt-1">
                          Base: {fmtMoney(base)}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow>
                  <TableCell colSpan={7} className="text-right py-3">
                    <Button variant="secondary" className="gap-2" onClick={addOTItem}><Plus size={16}/> Agregar Servicio</Button>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={5} className="text-right font-medium">Total OT (servicios + impuestos)</TableCell>
                  <TableCell className="text-right font-semibold">{fmtMoney(otTotal)}</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="mt-3">
          <PDFManager label="PDF(s) de la OT (generales)" files={otPDFs} onChange={setOTPDFs} />
        </div>

        <div>
    <Field label="Comentarios OT">
      <textarea
        value={otComentarios}
        onChange={e=>setOTComentarios(e.target.value)}
        className="w-full min-h-[90px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        placeholder="Notas generales de la OT"
      />
    </Field>
  </div>
      </section>

      {/* Facturas múltiples */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-lg font-semibold">Facturas de Venta</h4>
          <Button variant="secondary" className="gap-2" onClick={addFactura}><Plus size={16}/> Agregar Factura</Button>
        </div>

        <Card className="bg-white/95 border-0 shadow-sm ring-1 ring-slate-100 backdrop-blur supports-[backdrop-filter]:backdrop-blur">

          <CardContent className="p-0">
            <Table className="text-sm
  [&_thead_th]:text-slate-600 [&_thead_th]:font-semibold [&_thead_th]:bg-slate-50/80
  [&_thead_th]:backdrop-blur [&_thead_th]:border-b [&_thead_th]:border-slate-200
  [&_tbody_tr]:hover:bg-slate-50
  [&_tbody_tr:nth-child(even)]:bg-white [&_tbody_tr:nth-child(odd)]:bg-slate-50/40
  [&_td]:align-top"
>

              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="w-40 text-right">Total (con IVA)</TableHead>
                  <TableHead>Cliente / Empresa</TableHead>
                  <TableHead className="w-40">RUT</TableHead>
                  <TableHead>Descripción</TableHead>
                  
                  <TableHead>Comentarios</TableHead>
                  <TableHead className="w-48 text-right">Adjuntos</TableHead>
                  <TableHead className="w-14 text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
            {facturas.length===0 && (
  <TableRow><TableCell colSpan={7} className="text-center text-neutral-500 py-4">Sin facturas</TableCell></TableRow>
)}
{facturas.map(f => (
  <TableRow key={f.id} className="hover:bg-neutral-50">
    <TableCell className="w-40">
      <Input type="date" value={f.fecha} onChange={e=>upFactura(f.id, { fecha:e.target.value })} />
    </TableCell>
    <TableCell className="text-right">
      <MoneyInput valueNumber={f.total} onValueNumberChange={(val)=>upFactura(f.id, { total: val })} placeholder="0" />
    </TableCell>
    <TableCell>
      <Input value={f.clienteNombre || ""} onChange={e=>upFactura(f.id, { clienteNombre: e.target.value })} placeholder="Razón social o nombre" />
    </TableCell>
    <TableCell>
      <Input value={f.clienteRUT || ""} onChange={e=>upFactura(f.id, { clienteRUT: e.target.value })} placeholder="76.123.456-7" />
    </TableCell>
    <TableCell>
      <Input value={f.descripcion || ""} onChange={e=>upFactura(f.id, { descripcion: e.target.value })} placeholder="Glosa / detalle" />
    </TableCell>
    <TableCell>
  <textarea
    value={f.comentarios || ""}
    onChange={e=>upFactura(f.id, { comentarios: e.target.value })}
    className="w-full min-h-[60px] rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
    placeholder="Notas de la factura"
  />
</TableCell>

    <TableCell className="text-right">
      <Dialog>
        <DialogTrigger asChild>
          <Button size="sm" variant="secondary">PDFs ({(f.pdfs||[]).length})</Button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>PDF(s) de la factura</DialogTitle></DialogHeader>
          <PDFManager
            label="Adjuntos de la factura"
            files={f.pdfs || []}
            onChange={(arr)=> upFactura(f.id, { pdfs: arr })}
          />
        </DialogContent>
      </Dialog>
    </TableCell>
    <TableCell className="text-right">
      <Button size="sm" variant="ghost" onClick={()=>rmFactura(f.id)}><Trash2 size={16}/></Button>
    </TableCell>

    
  </TableRow>
))}

                <TableRow>
                 <TableCell colSpan={6} className="text-right font-medium">Total Facturas (bruto)</TableCell>
                <TableCell className="text-right font-semibold">{fmtMoney(factSumBruto)}</TableCell>
                <TableCell></TableCell>
                </TableRow>

              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-3 gap-2">
          <SumBox title="Total OT" value={fmtMoney(otTotal)} />
          <SumBox title="Total Facturas (bruto)" value={fmtMoney(factSumBruto)} />
          <SumBox title="Utilidad de referencia (Bruto − OT)" value={fmtMoney(utilidadRef)} highlight />
        </div>
      </section>

      {/* FINANCIAMIENTO (no afecta cálculos) */}
<section className="space-y-3">
  <h4 className="text-lg font-semibold">Financiamiento</h4>

  <div className="grid md:grid-cols-4 gap-4">
    <Field label="Cliente / Banco">
      <Input value={finCliente} onChange={e=>setFinCliente(e.target.value)} placeholder="Banco/Entidad o cliente" />
    </Field>
    <Field label="N° Documento">
      <Input value={finNumeroDocumento} onChange={e=>setFinNumeroDocumento(e.target.value)} placeholder="N° crédito / pagaré / doc." />
    </Field>
    <Field label="RUT">
      <Input value={finRUT} onChange={e=>setFinRUT(e.target.value)} placeholder="76.123.456-7" />
    </Field>
    <Field label="Monto financiado">
      <MoneyInput valueNumber={finMonto} onValueNumberChange={setFinMonto} placeholder="0" />
    </Field>
  </div>

  <PDFManager label="PDF(s) de Financiamiento" files={finPDFs} onChange={setFinPDFs} />
</section>


      <div className="flex gap-2">
        <Button className="rounded-lg" onClick={save}>Guardar cotización</Button>

      </div>
    </div>
  );
}

/********************
 * VIEWER DE PDFs (sólo lectura, sin subir/borrar)
 *******************/
function PDFListViewer({ label, files = [] }){
  const toast = useToast();
  const [preview, setPreview] = useState(null);
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-slate-700">{label}</div>

      <Card className="bg-white/95 border-0 shadow-sm ring-1 ring-slate-100 backdrop-blur supports-[backdrop-filter]:backdrop-blur">

        <CardContent className="p-0">
          <Table className="text-sm
  [&_thead_th]:text-slate-600 [&_thead_th]:font-semibold [&_thead_th]:bg-slate-50/80
  [&_thead_th]:backdrop-blur [&_thead_th]:border-b [&_thead_th]:border-slate-200
  [&_tbody_tr]:hover:bg-slate-50
  [&_tbody_tr:nth-child(even)]:bg-white [&_tbody_tr:nth-child(odd)]:bg-slate-50/40
  [&_td]:align-top"
>

            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead className="w-32">Tamaño</TableHead>
                <TableHead className="w-28 text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(files||[]).length===0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-neutral-500 py-4">Sin PDFs</TableCell></TableRow>
              )}
              {(files||[]).map(f=>(
                <TableRow key={f.id} className="hover:bg-neutral-50">
                  <TableCell>📄</TableCell>
                  <TableCell className="truncate">{f.name || "Documento.pdf"}</TableCell>
                  <TableCell>{Math.round((f.size||0)/1024)} KB</TableCell>
                  <TableCell className="text-right">
                   <Button
  size="sm"
  variant="secondary"
  onClick={async () => {
    if (window.electronAPI) {
      const result = await window.electronAPI.openPDF({
        name: f.name || 'documento.pdf',
        dataUrl: f.dataUrl
      });
      if (!result.success) {
        toast.error('Error al abrir el PDF: ' + (result.message || 'Error desconocido'));
      }
    } else {
      // Fallback para desarrollo en navegador
      window.open(f.dataUrl, '_blank');
    }
  }}
>
  Ver
</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!preview} onOpenChange={(o)=>{ if(!o) setPreview(null); }}>
        <DialogContent className="max-w-5xl h-[80vh] overflow-hidden">
          <DialogHeader><DialogTitle>{preview?.name || "Vista de PDF"}</DialogTitle></DialogHeader>
          {preview && <iframe title="pdf" src={preview.dataUrl} className="w-full h-full rounded-lg border" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/********************
 * FILTROS LISTADO (N°, Cliente/Empresa, RUT, Solicitud)
 * Controlado por props + persistencia en sessionStorage
 *******************/
/********************
 * FILTROS LISTADO (N°, Cliente/Empresa, RUT, Solicitud, Fecha desde/hasta)
 * Controlado por props + persistencia en sessionStorage
 *******************/
function FiltrosCotizaciones({ filtros, onChange, setPaginaActual }){
  const { numero, cliente, rut, solicitud, desde, hasta } = filtros;

  // Persistencia por campo
  useEffect(()=>{
    sessionStorage.setItem("filtro-numero", numero);
    sessionStorage.setItem("filtro-cliente", cliente);
    sessionStorage.setItem("filtro-rut", rut);
    sessionStorage.setItem("filtro-solicitud", solicitud);
    sessionStorage.setItem("filtro-desde", desde);
    sessionStorage.setItem("filtro-hasta", hasta);
  }, [numero, cliente, rut, solicitud, desde, hasta]);

  // Carga inicial desde sessionStorage
  useEffect(()=>{
    onChange({
      numero: sessionStorage.getItem("filtro-numero") || "",
      cliente: sessionStorage.getItem("filtro-cliente") || "",
      rut: sessionStorage.getItem("filtro-rut") || "",
      solicitud: sessionStorage.getItem("filtro-solicitud") || "",
      desde: sessionStorage.getItem("filtro-desde") || "",
      hasta: sessionStorage.getItem("filtro-hasta") || "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid md:grid-cols-6 gap-3">
      <Field label="Código / N°">
        <Input
          value={numero}
          onChange={(e)=>{
            onChange({ ...filtros, numero: e.target.value });
            setPaginaActual(1);
          }}
          placeholder="CTZ-..."
        />
      </Field>

      <Field label="Cliente / Empresa">
        <Input
          value={cliente}
          onChange={(e)=>{
            onChange({ ...filtros, cliente: e.target.value });
            setPaginaActual(1);
          }}
          placeholder="Razón social o nombre"
        />
      </Field>

      <Field label="RUT">
        <Input
          value={rut}
          onChange={(e)=>{
            onChange({ ...filtros, rut: e.target.value });
            setPaginaActual(1);
          }}
          placeholder="76.123.456-7"
        />
      </Field>

      <Field label="Solicitud / Proyecto">
        <Input
          value={solicitud}
          onChange={(e)=>{
            onChange({ ...filtros, solicitud: e.target.value });
            setPaginaActual(1);
          }}
          placeholder="Detalle o palabra clave"
        />
      </Field>

      <Field label="Desde (fecha)">
        <Input
          type="date"
          value={desde}
          onChange={(e)=>{
            onChange({ ...filtros, desde: e.target.value });
            setPaginaActual(1);
          }}
        />
      </Field>

      <Field label="Hasta (fecha)">
        <Input
          type="date"
          value={hasta}
          onChange={(e)=>{
            onChange({ ...filtros, hasta: e.target.value });
            setPaginaActual(1);
          }}
        />
      </Field>
    </div>
  );
}


/********************
 * DETALLE (Vista — sin edición) [opcional, no usado en la tabla actual]
 *******************/
function DetalleCotizacionVista({ cot, usarNetoSinIVA }){
  const facturasArr = getFacturasArray(cot);
  const factSum     = sumFacturas(cot, usarNetoSinIVA);
  const otTotal     = calcOTTotal(cot?.ot);
  const utilidad    = Math.max(factSum - otTotal, 0);

  return (
    <div className="space-y-6 text-sm">
      {/* Datos base */}
      <div className="grid md:grid-cols-3 gap-4">
        <Field label="Codigo Cotización"><div>{cot.numero}</div></Field>
        <Field label="Fecha"><div>{cot.fecha}</div></Field>
        <Field label="Monto Cot. (registro)"><div>{fmtMoney(Number(cot.monto||0))}</div></Field>

        <Field label="Cliente / Empresa"><div>{getClienteNombre(cot)}</div></Field>
        <Field label="RUT"><div>{getClienteRut(cot)}</div></Field>
        <Field label="Solicitud / Proyecto" className="md:col-span-1"><div>{cot.solicitud || "—"}</div></Field>
      </div>



      <PDFListViewer label="PDF(s) de la Cotización" files={cot.pdfs || []} />

      {/* OC */}
      <div className="space-y-2">
        <h4 className="font-semibold">OC del Cliente</h4>
        <div className="grid md:grid-cols-3 gap-4">
          <Field label="Cliente/Empresa (OC)"><div>{cot?.oc?.clienteNombre || "—"}</div></Field>
          <Field label="RUT (OC)"><div>{cot?.oc?.clienteRUT || "—"}</div></Field>
          <Field label="Código"><div>{cot?.oc?.codigo || "—"}</div></Field>

          <Field label="Monto (registro)"><div>{fmtMoney(Number(cot?.oc?.monto||0))}</div></Field>
          <Field label="Descripción" className="md:col-span-2"><div>{cot?.oc?.descripcion || "—"}</div></Field>
        </div>
        <PDFListViewer label="PDF(s) de la OC del Cliente" files={cot?.oc?.pdfs || []} />
      </div>
      <div className="mt-2">
  <Field label="Comentarios OC"><div>{cot?.oc?.comentarios || "—"}</div></Field>
</div>


      {/* OT */}
      <div>
        <h4 className="font-semibold mb-2">Orden de Trabajo (OT)</h4>
        <div className="grid md:grid-cols-3 gap-4 mb-2">
          <Field label="Codigo OT"><div>{cot?.ot?.numero || "—"}</div></Field>
          <Field label="Fecha OT"><div>{cot?.ot?.fecha || "—"}</div></Field>
        </div>

        <Card className="bg-white/95 border-0 shadow-sm ring-1 ring-slate-100 backdrop-blur supports-[backdrop-filter]:backdrop-blur">

          <CardContent className="p-0">
            <Table className="text-sm
  [&_thead_th]:text-slate-600 [&_thead_th]:font-semibold [&_thead_th]:bg-slate-50/80
  [&_thead_th]:backdrop-blur [&_thead_th]:border-b [&_thead_th]:border-slate-200
  [&_tbody_tr]:hover:bg-slate-50
  [&_tbody_tr:nth-child(even)]:bg-white [&_tbody_tr:nth-child(odd)]:bg-slate-50/40
  [&_td]:align-top"
>

              <TableHeader>
                <TableRow>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="w-20 text-right">Cant.</TableHead>
                  <TableHead className="w-28 text-right">Costo Unit.</TableHead>
                  <TableHead className="w-24 text-center">IVA 19%</TableHead>
                  <TableHead className="w-[260px]">Otro impuesto</TableHead>
                  <TableHead className="w-28 text-right">Subtotal</TableHead>
                  <TableHead className="w-32 text-right">Adjuntos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(cot?.ot?.items||[]).map(it => {
                  const base     = itemBase(it);
                  const ivaMonto = itemIVA(it);
                  const otro     = itemOtro(it);
                  const sub      = itemSubtotal(it);
                  return (
                    <TableRow key={it.id} className="hover:bg-neutral-50 align-top">
                      <TableCell className="min-w-[220px]">{it.descripcion || "—"}</TableCell>
                      <TableCell className="text-right">{Number(it.cantidad||0)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(Number(it.costo||0))}</TableCell>
                      <TableCell className="text-center">{it?.conIVA ? `Sí (${fmtMoney(ivaMonto)})` : "No"}</TableCell>
                      <TableCell>
                        {it?.otroActivo
                          ? (<div className="space-y-1">
                              <div className="text-neutral-700">{it.otroNombre || "Otro"}</div>
                              <div className="text-neutral-600 text-xs">{Number(it.otroPorcentaje||0)}% ({fmtMoney(otro)})</div>
                            </div>)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium">{fmtMoney(sub)}</TableCell>
                      <TableCell className="text-right">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="secondary">PDFs ({(it.pdfs||[]).length})</Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                            <DialogHeader><DialogTitle>PDF(s) del servicio</DialogTitle></DialogHeader>
                            <PDFListViewer label="Adjuntos del servicio" files={it.pdfs || []} />
                          </DialogContent>
                        </Dialog>
                        <div className="text-[11px] text-neutral-500 mt-1">Base: {fmtMoney(base)}</div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow>
                  <TableCell colSpan={5} className="text-right font-medium">Total OT</TableCell>
                  <TableCell className="text-right font-semibold">{fmtMoney(calcOTTotal(cot?.ot))}</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="mt-3">
          <PDFListViewer label="PDF(s) de la OT (generales)" files={cot?.ot?.pdfs || []} />
        </div>

        <div className="mt-2">
  <Field label="Comentarios OT"><div>{cot?.ot?.comentarios || "—"}</div></Field>
</div>

      </div>

{/* Facturas múltiples (VISTA) */}
<div>
  <h4 className="font-semibold mb-2">Facturas de Venta</h4>
  <Card className="bg-white/95 border-0 shadow-sm ring-1 ring-slate-100 backdrop-blur supports-[backdrop-filter]:backdrop-blur">
    <CardContent className="p-0">
      <Table className="text-sm
        [&_thead_th]:text-slate-600 [&_thead_th]:font-semibold [&_thead_th]:bg-slate-50/80
        [&_thead_th]:backdrop-blur [&_thead_th]:border-b [&_thead_th]:border-slate-200
        [&_tbody_tr]:hover:bg-slate-50
        [&_tbody_tr:nth-child(even)]:bg-white [&_tbody_tr:nth-child(odd)]:bg-slate-50/40
        [&_td]:align-top">
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead className="w-32 text-right">Total (bruto)</TableHead>
            <TableHead className="w-40">Cliente / Empresa</TableHead>
            <TableHead className="w-36">RUT</TableHead>
            <TableHead className="w-32 text-right">{`Total (${usarNetoSinIVA ? "neto" : "bruto"} usado)`}</TableHead>
            <TableHead>Descripción</TableHead>
            <TableHead>Comentarios</TableHead>
            <TableHead className="w-32 text-right">Adjuntos</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {getFacturasArray(cot).length===0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-neutral-500 py-4">Sin facturas</TableCell>
            </TableRow>
          )}

          {getFacturasArray(cot).map(f => {
            const bruto = Number(f.total||0);
            const used  = usarNetoSinIVA ? (bruto/1.19) : bruto;
            return (
              <TableRow key={f.id} className="hover:bg-neutral-50">
                <TableCell>{f.fecha || "—"}</TableCell>
                <TableCell className="text-right">{fmtMoney(bruto)}</TableCell>
                <TableCell className="max-w-[220px] truncate">{f.clienteNombre || "—"}</TableCell>
                <TableCell className="max-w-[160px] truncate">{f.clienteRUT || "—"}</TableCell>
                <TableCell className="text-right">{fmtMoney(used)}</TableCell>
                <TableCell className="max-w-[300px] truncate">{f.descripcion || "—"}</TableCell>
                <TableCell className="max-w-[300px] truncate">{f.comentarios || "—"}</TableCell>
                <TableCell className="text-right">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="secondary">PDFs ({(f.pdfs||[]).length})</Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                      <DialogHeader><DialogTitle>PDF(s) de la factura</DialogTitle></DialogHeader>
                      <PDFListViewer label="Adjuntos de la factura" files={f.pdfs || []} />
                    </DialogContent>
                  </Dialog>
                </TableCell>
              </TableRow>
            );
          })}

          <TableRow>
            <TableCell colSpan={4} className="text-right font-medium">Total facturas usado</TableCell>
            <TableCell className="text-right font-semibold">{fmtMoney(sumFacturas(cot, usarNetoSinIVA))}</TableCell>
            <TableCell colSpan={3}></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </CardContent>
  </Card>
</div>

{/* Financiamiento (VISTA) */}
<section className="mt-4">
  <h4 className="font-semibold mb-2">Financiamiento</h4>
  <div className="grid md:grid-cols-4 gap-4">
    <Field label="Cliente / Banco"><div>{cot?.financiamiento?.cliente || "—"}</div></Field>
    <Field label="N° Documento"><div>{cot?.financiamiento?.numeroDocumento || "—"}</div></Field>
    <Field label="RUT"><div>{cot?.financiamiento?.rut || "—"}</div></Field>
    <Field label="Monto financiado"><div>{fmtMoney(Number(cot?.financiamiento?.monto||0))}</div></Field>
  </div>
  <div className="mt-3">
    <PDFListViewer label="PDF(s) de Financiamiento" files={cot?.financiamiento?.pdfs || []} />
  </div>
</section>

{/* Comentarios de la cotización (VISTA) */}
<section className="mt-4">
  <Field label="Comentarios de la cotización"><div>{cot.comentarios || "—"}</div></Field>
</section>




      {/* Totales finales */}
      <div className="grid md:grid-cols-3 gap-2">
        <SumBox title="Total OT" value={fmtMoney(calcOTTotal(cot?.ot))} />
        <SumBox title={`Total Facturas (${usarNetoSinIVA?"neto":"bruto"})`} value={fmtMoney(sumFacturas(cot, usarNetoSinIVA))} />
        <SumBox title="Utilidad" value={fmtMoney(Math.max(sumFacturas(cot, usarNetoSinIVA) - calcOTTotal(cot?.ot), 0))} highlight />
      </div>
    </div>
  );
}

/********************
 * LISTADO (ascendente) + MODAL de Detalle (EDICIÓN)
 *******************/
function ListadoCotizaciones({
  cotizaciones,
  usarNetoSinIVA,
  filtros,
  paginaActual,
  setPaginaActual,
  ITEMS_POR_PAGINA,
  onDuplicar,
  onSaveCotizacion,
  onDeleteCotizacion,
  sel,        // ← Ahora recibido como prop desde MainApp
  setSel,     // ← Ahora recibido como prop desde MainApp
}){

// Filtrar y ordenar
const rowsAll = (cotizaciones || [])
  .filter(c => {
    // Soporte para cliente como objeto o string
    const clienteStr = typeof c.cliente === 'object' && c.cliente !== null
      ? `${c.cliente.nombre || ''} ${c.cliente.empresa || ''}`.toLowerCase()
      : (c.cliente || "").toLowerCase();
    const rutStr = typeof c.cliente === 'object' && c.cliente !== null
      ? (c.cliente.rut || "").toLowerCase()
      : (c.rut || "").toLowerCase();

    return (
      (filtros.numero ? (c.numero || "").toLowerCase().includes(filtros.numero.toLowerCase()) : true) &&
      (filtros.cliente ? clienteStr.includes(filtros.cliente.toLowerCase()) : true) &&
      (filtros.rut ? rutStr.includes(filtros.rut.toLowerCase()) : true) &&
      (filtros.solicitud ? (c.solicitud || "").toLowerCase().includes(filtros.solicitud.toLowerCase()) : true) &&
      inRange(c.fecha, filtros.desde, filtros.hasta)
    );
  })
  .sort((a, b) => {
    const fechaA = a.fecha || "0000-00-00";
    const fechaB = b.fecha || "0000-00-00";
    if (fechaA !== fechaB) {
      return fechaB.localeCompare(fechaA);
    }
    return (b.numero || "").localeCompare(a.numero || "");
  });

// Calcular paginación
const totalPaginas = Math.ceil(rowsAll.length / ITEMS_POR_PAGINA);
const inicio = (paginaActual - 1) * ITEMS_POR_PAGINA;
const fin = inicio + ITEMS_POR_PAGINA;
const rowsPaginadas = rowsAll.slice(inicio, fin);
return (
    <>
      <Card className="bg-white/95 border-0 shadow-sm ring-1 ring-slate-100 backdrop-blur supports-[backdrop-filter]:backdrop-blur">
        <CardContent className="p-4 space-y-3">
          <Table className="text-sm
    [&_thead_th]:text-slate-600 [&_thead_th]:font-semibold [&_thead_th]:bg-slate-50/80
    [&_thead_th]:backdrop-blur [&_thead_th]:border-b [&_thead_th]:border-slate-200
    [&_tbody_tr]:hover:bg-slate-50
    [&_tbody_tr:nth-child(even)]:bg-white [&_tbody_tr:nth-child(odd)]:bg-slate-50/40
    [&_td]:align-top">
            <TableHeader>
              <TableRow>
                <TableHead>N°</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente / Empresa</TableHead>
                <TableHead>RUT</TableHead>
                <TableHead>Solicitud</TableHead>
                <TableHead>OC Cliente</TableHead>
                <TableHead>OC RUT</TableHead>
                <TableHead>OC Código</TableHead>
                <TableHead className="text-right">Monto Cot.</TableHead>
                <TableHead className="text-right">Facturas (#)</TableHead>
                <TableHead className="text-right">Total OT</TableHead>
                <TableHead className="text-right">Utilidad</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {rowsPaginadas.length===0 && (
                <TableRow><TableCell colSpan={13} className="text-center text-neutral-500 py-6">Sin resultados</TableCell></TableRow>
              )}

              {rowsPaginadas.map(c => {
                const facturasArr = getFacturasArray(c);
                const factCount   = facturasArr.length;
                const factSum     = sumFacturas(c, usarNetoSinIVA);
                const otTotal     = calcOTTotal(c?.ot);
                const utilidad    = Math.max(factSum - otTotal, 0);

                return (
                  <TableRow key={c.id} className="hover:bg-neutral-50">
                    <TableCell>{c.numero}</TableCell>
                    <TableCell>{c.fecha}</TableCell>
                    <TableCell className="max-w-[220px] truncate">{getClienteNombre(c)}</TableCell>
                    <TableCell className="max-w-[140px] truncate">{getClienteRut(c)}</TableCell>
                    <TableCell className="max-w-[220px] truncate">{c.solicitud || "—"}</TableCell>

                    <TableCell className="max-w-[200px] truncate">{c?.oc?.clienteNombre || "—"}</TableCell>
                    <TableCell className="max-w-[140px] truncate">{c?.oc?.clienteRUT || "—"}</TableCell>
                    <TableCell className="max-w-[160px] truncate">{c?.oc?.codigo || "—"}</TableCell>

                    <TableCell className="text-right">{fmtMoney(Number(c?.monto||0))}</TableCell>
                    <TableCell className="text-right">{factCount} · {fmtMoney(factSum)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(otTotal)}</TableCell>
                    <TableCell className="text-right font-semibold">{fmtMoney(utilidad)}</TableCell>

                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="secondary" onClick={()=>setSel(c)} className="rounded-lg">Ver / editar</Button>
                        <Button size="sm" variant="ghost" onClick={()=>onDuplicar?.(c)} className="rounded-lg text-slate-600">Duplicar</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Controles de paginación */}
      {totalPaginas > 1 && (
        <Card className="bg-white/95 border-0 shadow-sm ring-1 ring-slate-100 backdrop-blur supports-[backdrop-filter]:backdrop-blur mt-4">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-600">
                Mostrando {inicio + 1} - {Math.min(fin, rowsAll.length)} de {rowsAll.length} cotizaciones
              </p>
              
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPaginaActual(p => Math.max(1, p - 1))}
                  disabled={paginaActual === 1}
                >
                  ← Anterior
                </Button>
                
                <div className="flex gap-1">
                  {Array.from({ length: totalPaginas }, (_, i) => i + 1).map(num => (
                    <Button
                      key={num}
                      variant={paginaActual === num ? "default" : "outline"}
                      size="sm"
                      onClick={() => setPaginaActual(num)}
                      className={paginaActual === num ? "bg-slate-900 text-white" : ""}
                    >
                      {num}
                    </Button>
                  ))}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPaginaActual(p => Math.min(totalPaginas, p + 1))}
                  disabled={paginaActual === totalPaginas}
                >
                  Siguiente →
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Modal de detalle */}
      <Dialog open={!!sel} onOpenChange={(o)=>{ if(!o) setSel(null); }}>
        <DialogContent className="w-[95vw] sm:max-w-[1320px] h-[90vh] overflow-y-auto sm:rounded-2xl border-0 shadow-2xl bg-white">
          <DialogHeader>
            <DialogTitle>Editar — {sel?.numero} · {sel ? getClienteNombre(sel) : ""}</DialogTitle>
          </DialogHeader>

          {sel && (
            <DetalleCotizacionEditable
              initial={sel}
              usarNetoSinIVA={usarNetoSinIVA}
              onSave={(updated)=>{
                onSaveCotizacion?.(updated);
                setSel(updated);
              }}
              onDelete={()=>{
                if (!sel) return;
                onDeleteCotizacion?.(sel.id);
                setSel(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

 
/********************
 * DETALLE / EDICIÓN COMPLETA
 * - Edita todos los campos
 * - Servicios con IVA/otro impuesto + PDFs por servicio
 * - Facturas múltiples + PDFs
 *******************/
function DetalleCotizacionEditable({ initial, usarNetoSinIVA, onSave, onDelete }){
  const toast = useToast();
  const { user } = useAuth();
  const [cot, setCot] = useState(()=> normalizeLocal(initial));
  useEffect(()=>{ setCot(normalizeLocal(initial)); }, [initial?.id]);

  // ======= Cargar datos del apartado de creación =======
  const [datosCreacion, setDatosCreacion] = useState({ cotizaciones: [], ordenesCompra: [] });
  const [cargandoCreacion, setCargandoCreacion] = useState(true);

  // Estados de búsqueda para filtrar opciones
  const [busquedaCot, setBusquedaCot] = useState("");
  const [busquedaOC, setBusquedaOC] = useState("");

  useEffect(() => {
    const cargarDatosCreacion = async () => {
      try {
        const res = await fetch(`http://localhost:3001/api/creacion?key=${encodeURIComponent(user)}`);
        if (res.ok) {
          const json = await res.json();
          setDatosCreacion({
            cotizaciones: (json.cotizaciones || []).filter(x => !x.deleted),
            ordenesCompra: (json.ordenesCompra || []).filter(x => !x.deleted)
          });
        }
      } catch (e) {
        console.error('Error al cargar datos de creación:', e);
      } finally {
        setCargandoCreacion(false);
      }
    };
    cargarDatosCreacion();
  }, [user]);

  // ======= helpers de estado =======
  const setField = (k, v) => setCot(prev => ({ ...prev, [k]: v }));
  const setOC    = (patch) => setCot(prev => ({ ...prev, oc: { ...(prev.oc||{}), ...patch } }));
  const setOT    = (patch) => setCot(prev => ({ ...prev, ot: { ...(prev.ot||{items:[]}), ...patch } }));
  const setFacturas = (arr) => setCot(prev => ({ ...prev, facturas: arr }));

  // ======= Autocompletar desde apartado de creación =======
  const autocompletarDesdeCotizacion = (cotizacionId) => {
    const cotSeleccionada = datosCreacion.cotizaciones.find(c => c.id === cotizacionId);
    if (!cotSeleccionada) return;

    // Autocompletar campos que coincidan
    const updates = {};
    if (cotSeleccionada.cliente) updates.cliente = cotSeleccionada.cliente?.nombre || cotSeleccionada.cliente?.empresa || cotSeleccionada.cliente;
    if (cotSeleccionada.cliente?.rut) updates.rut = cotSeleccionada.cliente.rut;
    if (cotSeleccionada.solicitud) updates.solicitud = cotSeleccionada.solicitud;
    if (cotSeleccionada.comentarios) updates.comentarios = cotSeleccionada.comentarios;
    if (cotSeleccionada.fecha) updates.fecha = cotSeleccionada.fecha;
    if (cotSeleccionada.monto != null) updates.monto = Number(cotSeleccionada.monto) || 0;
    if (cotSeleccionada.pdfs) updates.pdfs = [...cotSeleccionada.pdfs];

    setCot(prev => ({ ...prev, ...updates }));
    setBusquedaCot(""); // Limpiar búsqueda
    toast.success('Datos autocompletados desde cotización de creación');
  };

  const autocompletarDesdeOC = (ocId) => {
    const ocSeleccionada = datosCreacion.ordenesCompra.find(oc => oc.id === ocId);
    if (!ocSeleccionada) return;

    // Autocompletar campos de OC
    const ocPatch = {};
    if (ocSeleccionada.clienteNombre) ocPatch.clienteNombre = ocSeleccionada.clienteNombre;
    if (ocSeleccionada.clienteRUT) ocPatch.clienteRUT = ocSeleccionada.clienteRUT;
    if (ocSeleccionada.codigo) ocPatch.codigo = ocSeleccionada.codigo;
    if (ocSeleccionada.monto != null) ocPatch.monto = Number(ocSeleccionada.monto) || 0;
    if (ocSeleccionada.descripcion) ocPatch.descripcion = ocSeleccionada.descripcion;
    if (ocSeleccionada.comentarios) ocPatch.comentarios = ocSeleccionada.comentarios;
    if (ocSeleccionada.pdfs) ocPatch.pdfs = [...ocSeleccionada.pdfs];

    setOC(ocPatch);
    setBusquedaOC(""); // Limpiar búsqueda
    toast.success('Datos de OC autocompletados desde creación');
  };

  // Helper: actualizar financiamiento
const setFin = (patch) =>
  setCot(prev => ({
    ...prev,
    financiamiento: {
      ...(prev.financiamiento || { cliente:"", numeroDocumento:"", rut:"", monto:0, pdfs:[] }),
      ...patch
    }
  }));


  // archivos raíz
  const setCotPDFs = (files) => setField("pdfs", typeof files === "function" ? files(cot.pdfs||[]) : files);

  // ======= OT: items =======
  const items = cot?.ot?.items || [];
  const addItem = () => setOT({ ...(cot.ot||{}), items: [...items, { id:uid(), descripcion:"", cantidad:1, costo:0, conIVA:false, otroActivo:false, otroNombre:"", otroPorcentaje:0, pdfs:[], condicionesComerciales:"" }] });
  const rmItem  = (id) => setOT({ ...(cot.ot||{}), items: items.filter(i=>i.id!==id) });
  const upItem  = (id, patch) => setOT({ ...(cot.ot||{}), items: items.map(i=> i.id===id? { ...i, ...patch } : i) });

  // ======= Facturas =======
  const facturas = Array.isArray(cot.facturas) ? cot.facturas : [];
const addFactura = () => setFacturas([
  ...facturas,
  { id: uid(), fecha: todayISO(), total: 0, descripcion: "", comentarios: "", pdfs: [], clienteNombre: cot.cliente || "", clienteRUT: cot.rut || "" }
]);


  const rmFactura  = (id) => setFacturas(facturas.filter(f=>f.id!==id));
  const upFactura  = (id, patch) => setFacturas(facturas.map(f=> f.id===id ? { ...f, ...patch } : f));

  // ======= Totales =======
  const otTotal   = calcOTTotal(cot?.ot);
  const factSum   = sumFacturas(cot, usarNetoSinIVA);
  const utilidad  = Math.max(factSum - otTotal, 0);

  // ======= Guardar / Eliminar =======
  const saveAll = () => {
    const payload = sanitizeCotizacionForSave(cot, initial.id);
    onSave?.(payload);
    toast.success("Cambios guardados exitosamente");
  };

  const tryDelete = () => {
    if (confirm(`¿Eliminar la cotización ${initial.numero}? Esta acción no se puede deshacer.`)) {
      onDelete?.();
    }
  };

  // ======= UI =======
  const oc  = cot.oc || { clienteNombre:"", clienteRUT:"", codigo:"", monto:0, descripcion:"", pdfs:[] };
  const ot  = cot.ot || { numero:"", fecha: todayISO(), items:[], pdfs:[] };
  const cpdfs = cot.pdfs || [];
  const otpdfs = ot.pdfs || [];
  const fin = cot.financiamiento || { cliente:"", numeroDocumento:"", rut:"", monto:0, pdfs:[] };


  return (
    <div className="space-y-6 text-sm">
      {/* Acciones */}
      <div className="flex items-center justify-between">
        <div className="text-neutral-600">ID: {initial.id}</div>
        <div className="flex gap-2">
          <Button onClick={saveAll} className="rounded-lg">Guardar cambios</Button>
          <Button variant="destructive" onClick={tryDelete} className="rounded-lg">Eliminar</Button>
        </div>
      </div>

      {/* Autocompletar desde Creación */}
      {!cargandoCreacion && (datosCreacion.cotizaciones.length > 0 || datosCreacion.ordenesCompra.length > 0) && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h5 className="text-sm font-semibold text-blue-900 mb-3">Autocompletar desde Apartado de Creación</h5>
          <div className="grid md:grid-cols-2 gap-4">
            {datosCreacion.cotizaciones.length > 0 && (
              <div className="space-y-2">
                <Field label="Buscar Cotización (opcional)">
                  <Input
                    value={busquedaCot}
                    onChange={e => setBusquedaCot(e.target.value)}
                    placeholder="Escribe para filtrar..."
                    className="w-full"
                  />
                </Field>
                {busquedaCot && (
                  <div className="max-h-48 overflow-y-auto border border-slate-300 rounded-md bg-white">
                    {datosCreacion.cotizaciones
                      .filter(c => {
                        const numero = c.numero || '';
                        const cliente = typeof c.cliente === 'object'
                          ? (c.cliente?.nombre || c.cliente?.empresa || '')
                          : (c.cliente || '');
                        const search = busquedaCot.toLowerCase();
                        return numero.toLowerCase().includes(search) ||
                               cliente.toLowerCase().includes(search);
                      })
                      .map(c => (
                        <button
                          key={c.id}
                          onClick={() => autocompletarDesdeCotizacion(c.id)}
                          className="w-full text-left px-3 py-2 hover:bg-blue-100 text-sm border-b border-slate-200 last:border-b-0"
                        >
                          <div className="font-medium text-slate-900">{c.numero || 'Sin número'}</div>
                          <div className="text-xs text-slate-600">
                            {typeof c.cliente === 'object' ? (c.cliente?.nombre || c.cliente?.empresa) : c.cliente || 'Sin cliente'}
                            {c.monto ? ` • ${fmtMoney(c.monto)}` : ''}
                          </div>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}
            {datosCreacion.ordenesCompra.length > 0 && (
              <div className="space-y-2">
                <Field label="Buscar OC (opcional)">
                  <Input
                    value={busquedaOC}
                    onChange={e => setBusquedaOC(e.target.value)}
                    placeholder="Escribe para filtrar..."
                    className="w-full"
                  />
                </Field>
                {busquedaOC && (
                  <div className="max-h-48 overflow-y-auto border border-slate-300 rounded-md bg-white">
                    {datosCreacion.ordenesCompra
                      .filter(oc => {
                        const codigo = oc.codigo || oc.numero || '';
                        const cliente = oc.clienteNombre || '';
                        const search = busquedaOC.toLowerCase();
                        return codigo.toLowerCase().includes(search) ||
                               cliente.toLowerCase().includes(search);
                      })
                      .map(oc => (
                        <button
                          key={oc.id}
                          onClick={() => autocompletarDesdeOC(oc.id)}
                          className="w-full text-left px-3 py-2 hover:bg-blue-100 text-sm border-b border-slate-200 last:border-b-0"
                        >
                          <div className="font-medium text-slate-900">{oc.codigo || oc.numero || 'Sin código'}</div>
                          <div className="text-xs text-slate-600">
                            {oc.clienteNombre || 'Sin cliente'}
                            {oc.monto ? ` • ${fmtMoney(oc.monto)}` : ''}
                          </div>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <p className="text-xs text-blue-700 mt-2 italic">
            Escribe en los campos de búsqueda para filtrar y seleccionar. Los campos se autocompletarán y podrás editarlos manualmente.
          </p>
        </div>
      )}

      {/* Datos base */}
      <div className="grid md:grid-cols-3 gap-4">
        <Field label="Codigo Cotización"><Input value={cot.numero||""} onChange={e=>setField("numero", e.target.value)} /></Field>
        <Field label="Fecha"><Input type="date" value={cot.fecha||todayISO()} onChange={e=>setField("fecha", e.target.value)} /></Field>
        <Field label="Monto Cot. (registro)"><MoneyInput valueNumber={Number(cot.monto||0)} onValueNumberChange={(val)=>setField("monto", val)} placeholder="0" /></Field>

        <Field label="Cliente / Empresa"><Input value={cot.cliente||""} onChange={e=>setField("cliente", e.target.value)} /></Field>
        <Field label="RUT"><Input value={cot.rut||""} onChange={e=>setField("rut", e.target.value)} /></Field>
        <Field label="Solicitud / Proyecto"><Input value={cot.solicitud||""} onChange={e=>setField("solicitud", e.target.value)} /></Field>
      </div>

      <PDFManager label="PDF(s) de la Cotización" files={cpdfs} onChange={setCotPDFs} />

      {/* Comentarios de la cotización */}
<div className="md:col-span-3">
  <Field label="Comentarios de la cotización">
    <textarea
      value={cot.comentarios || ""}
      onChange={e=>setField("comentarios", e.target.value)}
      className="w-full min-h-[90px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
      placeholder="Notas internas, consideraciones, etc."
    />
  </Field>
</div>


      {/* OC */}
      <div className="space-y-2">
        <h4 className="font-semibold">OC del Cliente</h4>
        <div className="grid md:grid-cols-3 gap-4">
          <Field label="Cliente/Empresa (OC)"><Input value={oc.clienteNombre||""} onChange={e=>setOC({ clienteNombre: e.target.value })} /></Field>
          <Field label="RUT (OC)"><Input value={oc.clienteRUT||""} onChange={e=>setOC({ clienteRUT: e.target.value })} /></Field>
          <Field label="Código"><Input value={oc.codigo||""} onChange={e=>setOC({ codigo: e.target.value })} /></Field>

          <Field label="Monto (registro)"><MoneyInput valueNumber={Number(oc.monto||0)} onValueNumberChange={(val)=>setOC({ monto: val })} placeholder="0" /></Field>
          <Field label="Descripción" className="md:col-span-2"><Input value={oc.descripcion||""} onChange={e=>setOC({ descripcion: e.target.value })} /></Field>
        </div>
        <PDFManager label="PDF(s) de la OC del Cliente" files={oc.pdfs || []} onChange={(arr)=>setOC({ pdfs: arr })} />
      </div>

      {/* Comentarios OC */}
<div className="mt-3">
  <Field label="Comentarios OC">
    <textarea
      value={oc.comentarios || ""}
      onChange={e=>setOC({ comentarios: e.target.value })}
      className="w-full min-h-[90px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
      placeholder="Notas de la Orden de Compra del cliente"
    />
  </Field>
</div>


      {/* OT */}
      <div>
        <h4 className="font-semibold mb-2">Orden de Trabajo (OT)</h4>
        <div className="grid md:grid-cols-3 gap-4 mb-2">
          <Field label="Codigo OT"><Input value={ot.numero||""} onChange={e=>setOT({ ...(ot||{}), numero:e.target.value })} /></Field>
          <Field label="Fecha OT"><Input type="date" value={ot.fecha || todayISO()} onChange={e=>setOT({ ...(ot||{}), fecha:e.target.value })} /></Field>
          <div className="md:justify-self-end">
            <Label className="text-neutral-700">&nbsp;</Label>
            <div className="mt-1">
              <Button variant="secondary" className="gap-2" onClick={addItem}><Plus size={16}/> Agregar Servicio</Button>
            </div>
          </div>
        </div>

        {/* NUEVO: Factura de Venta Asociada */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h5 className="text-sm font-semibold text-blue-900">Facturas de Venta Asociadas</h5>
            <Button
              type="button"
              onClick={() => {
                const newFactura = { id: uid(), codigo: "", rut: "", monto: 0 };
                setOT({ ...(ot||{}), facturasVenta: [...(ot.facturasVenta || []), newFactura] });
              }}
              size="sm"
              className="bg-blue-600 hover:bg-blue-700"
            >
              + Agregar Factura
            </Button>
          </div>

          {(!ot.facturasVenta || ot.facturasVenta.length === 0) ? (
            <p className="text-sm text-blue-700 italic">No hay facturas de venta. Haz clic en "Agregar Factura".</p>
          ) : (
            <div className="space-y-3">
              {(ot.facturasVenta || []).map((factura) => (
                <div key={factura.id} className="grid md:grid-cols-[1fr_1fr_1fr_auto] gap-3 p-3 bg-white rounded-lg border border-blue-200">
                  <Field label="Código de Factura">
                    <Input
                      value={factura.codigo || ""}
                      onChange={e => setOT({
                        ...(ot||{}),
                        facturasVenta: (ot.facturasVenta || []).map(f =>
                          f.id === factura.id ? { ...f, codigo: e.target.value } : f
                        )
                      })}
                      placeholder="Ej: FV-1234"
                      className="h-9"
                    />
                  </Field>
                  <Field label="RUT Cliente">
                    <Input
                      value={factura.rut || ""}
                      onChange={e => setOT({
                        ...(ot||{}),
                        facturasVenta: (ot.facturasVenta || []).map(f =>
                          f.id === factura.id ? { ...f, rut: e.target.value } : f
                        )
                      })}
                      placeholder="76.123.456-7"
                      className="h-9"
                    />
                  </Field>
                  <Field label="Monto Total">
                    <MoneyInput
                      valueNumber={Number(factura.monto || 0)}
                      onValueNumberChange={val => setOT({
                        ...(ot||{}),
                        facturasVenta: (ot.facturasVenta || []).map(f =>
                          f.id === factura.id ? { ...f, monto: val } : f
                        )
                      })}
                      placeholder="0"
                      className="h-9"
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setOT({
                        ...(ot||{}),
                        facturasVenta: (ot.facturasVenta || []).filter(f => f.id !== factura.id)
                      })}
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

{/* Tabla de Servicios OT (EDICIÓN) */}
<Card className="bg-white/95 border-0 shadow-sm ring-1 ring-slate-100 backdrop-blur supports-[backdrop-filter]:backdrop-blur">
  <CardContent className="p-0">
    <Table className="text-sm
      [&_thead_th]:text-slate-600 [&_thead_th]:font-semibold [&_thead_th]:bg-slate-50/80
      [&_thead_th]:backdrop-blur [&_thead_th]:border-b [&_thead_th]:border-slate-200
      [&_tbody_tr]:hover:bg-slate-50
      [&_tbody_tr:nth-child(even)]:bg-white [&_tbody_tr:nth-child(odd)]:bg-slate-50/40
      [&_td]:align-top">
      <TableHeader>
        <TableRow>
          <TableHead>Descripción</TableHead>
          <TableHead className="w-20 text-right">Cantidad</TableHead>
          <TableHead className="w-32 text-right">Costo Unit.</TableHead>
          <TableHead className="w-28 text-center">Con IVA</TableHead>
          <TableHead className="w-[320px]">Otro impuesto</TableHead>
          <TableHead className="w-32 text-right">Subtotal</TableHead>
          <TableHead className="w-44 text-right">Acciones</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map(it => {
          const base = Number(it.cantidad||0) * Number(it.costo||0);
          const subtotal = itemSubtotal(it);
          return (
            <TableRow key={it.id} className="hover:bg-neutral-50 align-top">
              <TableCell className="min-w-[220px]">
                <Input value={it.descripcion} onChange={e=>upItem(it.id, { descripcion:e.target.value })} />
              </TableCell>
              <TableCell className="text-right">
                <Input type="number" value={it.cantidad} onChange={e=>upItem(it.id, { cantidad:Number(e.target.value) })} />
              </TableCell>
              <TableCell className="text-right">
                <MoneyInput valueNumber={it.costo} onValueNumberChange={(val)=>upItem(it.id, { costo: val })} placeholder="0" />
              </TableCell>

              {/* Con IVA 19% */}
              <TableCell className="text-center">
                <input type="checkbox" checked={!!it.conIVA} onChange={e=>upItem(it.id, { conIVA: e.target.checked })} />
                <div className="text-[11px] text-neutral-500 mt-1">19%</div>
              </TableCell>

              {/* Otro impuesto */}
              <TableCell>
                <div className="flex flex-col gap-2">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!it.otroActivo} onChange={e=>upItem(it.id, { otroActivo: e.target.checked })} />
                    <span className="text-neutral-700">Activar</span>
                  </label>
                  {it.otroActivo && (
                    <div className="grid grid-cols-5 gap-2">
                      <div className="col-span-3">
                        <Input placeholder="Nombre impuesto" value={it.otroNombre} onChange={e=>upItem(it.id, { otroNombre: e.target.value })} />
                      </div>
                      <div className="col-span-2">
                        <Input type="number" placeholder="%" value={it.otroPorcentaje} onChange={e=>upItem(it.id, { otroPorcentaje: Number(e.target.value) })} />
                      </div>
                    </div>
                  )}
                </div>
              </TableCell>

              <TableCell className="text-right font-medium align-middle">{fmtMoney(subtotal)}</TableCell>

              {/* Acciones: PDFs + eliminar */}
              <TableCell className="text-right">
                <div className="flex flex-col gap-2">
                  <div className="flex justify-end gap-2">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="secondary">PDFs ({(it.pdfs||[]).length})</Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                        <DialogHeader><DialogTitle>PDF(s) del servicio</DialogTitle></DialogHeader>
                        <PDFManager
                          label="Adjuntos del servicio"
                          files={it.pdfs || []}
                          onChange={(arr)=> upItem(it.id, { pdfs: arr })}
                        />
                      </DialogContent>
                    </Dialog>
                    <Button size="sm" variant="ghost" onClick={()=>rmItem(it.id)}><Trash2 size={16}/></Button>
                  </div>
                </div>
                <div className="text-[11px] text-neutral-500 mt-1">Base: {fmtMoney(base)}</div>
              </TableCell>
            </TableRow>
          );
        })}

        <TableRow>
          <TableCell colSpan={7} className="text-right py-3">
            <Button variant="secondary" className="gap-2" onClick={addItem}><Plus size={16}/> Agregar Servicio</Button>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell colSpan={5} className="text-right font-medium">Total OT (servicios + impuestos)</TableCell>
          <TableCell className="text-right font-semibold">{fmtMoney(otTotal)}</TableCell>
          <TableCell></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </CardContent>
</Card>


        <div className="mt-3">
          <PDFManager label="PDF(s) de la OT (generales)" files={otpdfs} onChange={(arr)=>setOT({ ...(ot||{}), pdfs: arr })} />
        </div>

        {/* Comentarios OT */}
<div className="mt-3">
  <Field label="Comentarios OT">
    <textarea
      value={ot.comentarios || ""}
      onChange={e=>setOT({ ...(ot||{}), comentarios: e.target.value })}
      className="w-full min-h-[90px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
      placeholder="Notas generales de la OT"
    />
  </Field>
</div>

      </div>

      {/* Facturas múltiples */}
      <div>
        <h4 className="font-semibold mb-2">Facturas de Venta</h4>
        <div className="flex items-center justify-between mb-2">
          <div></div>
          <Button variant="secondary" className="gap-2" onClick={addFactura}><Plus size={16}/> Agregar Factura</Button>
        </div>

        <Card className="bg-white/95 border-0 shadow-sm ring-1 ring-slate-100 backdrop-blur supports-[backdrop-filter]:backdrop-blur">

          <CardContent className="p-0">
            <Table className="text-sm
  [&_thead_th]:text-slate-600 [&_thead_th]:font-semibold [&_thead_th]:bg-slate-50/80
  [&_thead_th]:backdrop-blur [&_thead_th]:border-b [&_thead_th]:border-slate-200
  [&_tbody_tr]:hover:bg-slate-50
  [&_tbody_tr:nth-child(even)]:bg-white [&_tbody_tr:nth-child(odd)]:bg-slate-50/40
  [&_td]:align-top"
>

              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="w-40 text-right">Total (con IVA)</TableHead>
                  <TableHead>Cliente / Empresa</TableHead>
                  <TableHead className="w-40">RUT</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Comentarios</TableHead>
                  <TableHead className="w-48 text-right">Adjuntos</TableHead>
                  <TableHead className="w-14 text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {facturas.length===0 && (
  <TableRow><TableCell colSpan={7} className="text-center text-neutral-500 py-4">Sin facturas</TableCell></TableRow>
)}
{facturas.map(f => (
  <TableRow key={f.id} className="hover:bg-neutral-50">
    <TableCell className="w-40">
      <Input type="date" value={f.fecha} onChange={e=>upFactura(f.id, { fecha:e.target.value })} />
    </TableCell>
    <TableCell className="text-right">
      <MoneyInput valueNumber={f.total} onValueNumberChange={(val)=>upFactura(f.id, { total: val })} placeholder="0" />
    </TableCell>
    <TableCell>
      <Input value={f.clienteNombre || ""} onChange={e=>upFactura(f.id, { clienteNombre: e.target.value })} placeholder="Razón social o nombre" />
    </TableCell>
    <TableCell>
      <Input value={f.clienteRUT || ""} onChange={e=>upFactura(f.id, { clienteRUT: e.target.value })} placeholder="76.123.456-7" />
    </TableCell>
    <TableCell>
      <Input value={f.descripcion || ""} onChange={e=>upFactura(f.id, { descripcion: e.target.value })} placeholder="Glosa / detalle" />
    </TableCell>
    <TableCell>
   <textarea
     value={f.comentarios || ""}
     onChange={e=>upFactura(f.id, { comentarios: e.target.value })}
    className="w-full min-h-[60px] rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
     placeholder="Notas de la factura"
   />
  </TableCell>
    <TableCell className="text-right">
      <Dialog>
        <DialogTrigger asChild>
          <Button size="sm" variant="secondary">PDFs ({(f.pdfs||[]).length})</Button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>PDF(s) de la factura</DialogTitle></DialogHeader>
          <PDFManager
            label="Adjuntos de la factura"
            files={f.pdfs || []}
            onChange={(arr)=> upFactura(f.id, { pdfs: arr })}
          />
        </DialogContent>
      </Dialog>
    </TableCell>
    <TableCell className="text-right">
      <Button size="sm" variant="ghost" onClick={()=>rmFactura(f.id)}><Trash2 size={16}/></Button>
    </TableCell>
  </TableRow>
))}

 <TableRow>
   <TableCell colSpan={6} className="text-right font-medium">
     Total Facturas usado ({usarNetoSinIVA ? "neto" : "bruto"})
   </TableCell>
   <TableCell className="text-right font-semibold">{fmtMoney(factSum)}</TableCell>
   <TableCell></TableCell>
 </TableRow>

              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

          {/* FINANCIAMIENTO (EDICIÓN) */}
      <section className="space-y-3">
        <h4 className="font-semibold">Financiamiento</h4>
        <div className="grid md:grid-cols-4 gap-4">
          <Field label="Cliente / Banco">
            <Input 
              value={fin.cliente || ""} 
              onChange={e => setFin({ cliente: e.target.value })} 
              placeholder="Banco/Entidad o cliente" 
            />
          </Field>
          <Field label="N° Documento">
            <Input 
              value={fin.numeroDocumento || ""} 
              onChange={e => setFin({ numeroDocumento: e.target.value })} 
              placeholder="N° crédito / pagaré / doc." 
            />
          </Field>
          <Field label="RUT">
            <Input 
              value={fin.rut || ""} 
              onChange={e => setFin({ rut: e.target.value })} 
              placeholder="76.123.456-7" 
            />
          </Field>
          <Field label="Monto financiado">
            <MoneyInput 
              valueNumber={Number(fin.monto) || 0} 
              onValueNumberChange={(val) => setFin({ monto: val })} 
              placeholder="0" 
            />
          </Field>
        </div>
        <PDFManager 
          label="PDF(s) de Financiamiento" 
          files={fin.pdfs || []} 
          onChange={(arr) => setFin({ pdfs: arr })} 
        />
      </section>

      {/* Totales finales */}
      <div className="grid md:grid-cols-3 gap-2">
        <SumBox title="Total OT" value={fmtMoney(otTotal)} />
        <SumBox title={`Total Facturas (${usarNetoSinIVA ? "neto" : "bruto"})`} value={fmtMoney(factSum)} />
        <SumBox title="Utilidad" value={fmtMoney(utilidad)} highlight />
      </div>
    </div>
  );
}

/********************
 * Normalización/Sanitización
 *******************/
function normalizeLocal(c){
  const dc = deepClone(c || {});
  // normaliza facturas
  if (!Array.isArray(dc.facturas)) {
    dc.facturas = getFacturasArray(dc);
  }
  // asegura estructuras

  dc.comentarios = dc.comentarios || "";
  dc.oc = dc.oc || { clienteNombre:"", clienteRUT:"", codigo:"", monto:0, descripcion:"", pdfs:[], comentarios:"" };
  dc.ot = dc.ot || { numero:"", fecha: todayISO(), items:[], pdfs:[], comentarios:"", facturasVenta: [] };

  // Migración: facturaVenta (objeto antiguo) → facturasVenta (array nuevo)
  if (!dc.ot.facturasVenta || !Array.isArray(dc.ot.facturasVenta)) {
    // Si tiene facturaVenta (objeto antiguo), convertir a array
    if (dc.ot.facturaVenta && (dc.ot.facturaVenta.codigo || dc.ot.facturaVenta.rut || dc.ot.facturaVenta.monto)) {
      dc.ot.facturasVenta = [{ ...dc.ot.facturaVenta, id: uid() }];
      delete dc.ot.facturaVenta; // Eliminar campo antiguo
    } else {
      dc.ot.facturasVenta = [];
    }
  } else {
    // Asegurar que cada factura tenga un ID
    dc.ot.facturasVenta = dc.ot.facturasVenta.map(f => ({ ...f, id: f.id || uid(), monto: Number(f.monto || 0) }));
  }

  dc.ot.items = (dc.ot.items||[]).map(it => ({
    id: it.id || uid(),
    descripcion: it.descripcion || "",
    cantidad: Number(it.cantidad||0),
    costo: Number(it.costo||0),
    conIVA: !!it.conIVA,
    otroActivo: !!it.otroActivo,
    otroNombre: it.otroNombre || "",
    otroPorcentaje: Number(it.otroPorcentaje||0),
    pdfs: Array.isArray(it.pdfs) ? it.pdfs : [],
    condicionesComerciales: it.condicionesComerciales || "" // NUEVO
  }));
  dc.pdfs = Array.isArray(dc.pdfs) ? dc.pdfs : [];
  // asegura campos nuevos por factura
dc.facturas = (dc.facturas || []).map(f => ({
  id: f.id || uid(),
  fecha: f.fecha || todayISO(),
  total: Number(f.total || 0),
  descripcion: f.descripcion || "",
  comentarios: f.comentarios || "",              // NUEVO
  pdfs: Array.isArray(f.pdfs) ? f.pdfs : [],
  clienteNombre: f.clienteNombre || dc.cliente || "",
  clienteRUT: f.clienteRUT || dc.rut || "",
}));

// Financiamiento por defecto
dc.financiamiento = dc.financiamiento || {
  cliente: "",
  numeroDocumento: "",
  rut: "",
  monto: 0,
  pdfs: []
};

  // Normalizar cliente: si es objeto, convertir a string
  if (typeof dc.cliente === 'object' && dc.cliente !== null) {
    const clienteObj = dc.cliente; // Guardar referencia
    // Primero extraer el RUT si está en el objeto y no hay RUT ya
    if (!dc.rut && clienteObj.rut) {
      dc.rut = clienteObj.rut;
    }
    // Luego convertir cliente a string
    dc.cliente = clienteObj.nombre || clienteObj.empresa || "";
  }

  return dc;
}

function sanitizeCotizacionForSave(cot, idFixed){
  const payload = deepClone(cot);
  payload.id = idFixed;
  // tipa números
  payload.monto = Number(payload.monto||0);
  if (payload.oc) payload.oc.monto = Number(payload.oc.monto||0);
  // items
  payload.ot = payload.ot || { items:[] };
  payload.ot.items = (payload.ot.items||[]).map(it => ({
    ...it,
    cantidad: Number(it.cantidad||0),
    costo: Number(it.costo||0),
    otroPorcentaje: Number(it.otroPorcentaje||0),
  }));
  // facturas
payload.facturas = (payload.facturas||[]).map(f => ({
  id: f.id || uid(),
  fecha: f.fecha || todayISO(),
  total: Number(f.total||0),
  descripcion: f.descripcion || "",
  comentarios: f.comentarios || "",     // NUEVO
  pdfs: Array.isArray(f.pdfs) ? f.pdfs : [],
  clienteNombre: f.clienteNombre || payload.cliente || "",
  clienteRUT: f.clienteRUT || payload.rut || "",
}));

  // limpiamos cualquier rastro de `factura` viejo
  if ('factura' in payload) delete payload.factura;


  // Asegurar comentarios en OC y OT
if (payload.oc) {
  payload.oc.comentarios = payload.oc.comentarios || "";
}
if (payload.ot) {
  payload.ot.comentarios = payload.ot.comentarios || "";

  // Migración y sanitización de facturas de venta
  if (!payload.ot.facturasVenta || !Array.isArray(payload.ot.facturasVenta)) {
    // Si tiene facturaVenta (objeto antiguo), migrar a array
    if (payload.ot.facturaVenta && (payload.ot.facturaVenta.codigo || payload.ot.facturaVenta.rut || payload.ot.facturaVenta.monto)) {
      payload.ot.facturasVenta = [{ ...payload.ot.facturaVenta, id: uid(), monto: Number(payload.ot.facturaVenta.monto || 0) }];
    } else {
      payload.ot.facturasVenta = [];
    }
    // Eliminar campo antiguo
    delete payload.ot.facturaVenta;
  } else {
    // Sanitizar array de facturas
    payload.ot.facturasVenta = payload.ot.facturasVenta.map(f => ({
      ...f,
      id: f.id || uid(),
      monto: Number(f.monto || 0)
    }));
  }

  // NUEVO: Asegurar condicionesComerciales en cada item
  payload.ot.items = (payload.ot.items || []).map(it => ({
    ...it,
    condicionesComerciales: it.condicionesComerciales || ""
  }));
}

// Financiamiento: tipar monto y asegurar estructura
payload.financiamiento = payload.financiamiento || { cliente:"", numeroDocumento:"", rut:"", monto:0, pdfs:[] };
payload.financiamiento.monto = Number(payload.financiamiento.monto || 0);
if (!Array.isArray(payload.financiamiento.pdfs)) payload.financiamiento.pdfs = [];

  return payload;
}