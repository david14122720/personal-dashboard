# TAREA: Reconstruir la sección "Rastreador de Hábitos" como un dashboard con cuadrícula mensual

> Fuente: instrucciones del dueño (2026-09-20). Este archivo ES la especificación.
> Método elegido: ODD (la especificación ya es completa y detallada; SDD no agrega valor acá).
> Decisiones del agente se anotan al final en el reporte.

## 0. Cómo debes trabajar (léelo primero)

- **No puedes ver la imagen de referencia.** Esta descripción ES la especificación. Síguela al pie de la letra: no la simplifiques, no la reemplaces por otro diseño "parecido" y no omitas bloques.
- Antes de escribir código, **inspecciona el repositorio**: stack, framework, sistema de componentes, estilos y tokens de tema (colores, fuentes, radios), y cómo están hoy el modelo, la API y la base de datos de hábitos. Usa lo que ya existe. **No agregues dependencias pesadas**; los gráficos (anillo de progreso y barras) se hacen con SVG/CSS propio.
- **No toques** la barra lateral, la barra superior, el layout global ni otras secciones de la app. Solo esta pantalla.
- **No pierdas datos existentes.** Cualquier cambio en base de datos debe ser una migración aditiva (columnas nuevas opcionales, con valor por defecto).
- Todo el texto de la interfaz va **en español**, con los textos exactos que se indican abajo.
- No me hagas preguntas salvo que estés bloqueado. Si dudas, toma la decisión más razonable y anótala en el reporte final.
- Al terminar, **abre la app, pruébala y verifica cada punto de la sección 12**. Si puedes tomar capturas, hazlo.

## 1. Qué está mal hoy

La pantalla actual solo tiene: cabecera con título "Rastreador de hábitos", selector de mes, botón "Añadir Hábito" y un formulario de creación abierto e inline. **Falta todo lo importante:** tarjetas de métricas, filtros por categoría, **cuadrícula de días con los hábitos**, gráfico semanal, tarjetas de hito. La pantalla debe ser un **rastreador visual donde marco día a día si cumplí cada hábito**, y el formulario solo aparece en modal cuando se pide.

## 2. Estructura de la pantalla (de arriba hacia abajo)

Ancho de contenido ~1060 px (sin sidebar). Tema oscuro. Orden vertical:
1. Cabecera de la página
2. Fila de 4 tarjetas de métricas (KPIs)
3. Barra de filtros por categoría + leyenda de colores
4. Tarjeta grande con la cuadrícula de hábitos × días del mes
5. Fila inferior con 2 columnas: "Consistencia Semanal" (izq. ~60 %) y "Hito Desbloqueado" + "Reflexión de Productividad" (der. ~40 %)
El formulario de crear hábito **NO** es parte del flujo visible: va en un modal (sección 9).

## 3. Estilo visual

Tokens del tema existente; si no hay, aproximados:
- Fondo página: casi negro azulado (~#0B0F17).
- Tarjetas: azul oscuro (~#121826), borde 1 px sutil (~rgba(255,255,255,0.05)), radio 16 px, padding ~22 px.
- Acento principal: **cian** (~#38BDF8). Degradado cian → azul (~#38BDF8 → #4F7CFF) en botón "Añadir Hábito" y barras semanales.
- Verde éxito: ~#22C55E / #4ADE80.
- Texto principal casi blanco; secundario gris azulado (~#94A3B8).
- Etiquetas de tarjetas: MAYÚSCULAS, ~12 px, espaciada, gris claro, negrita media.
- Números grandes KPIs: ~44 px negrita. Título página: ~40 px negrita.
- Fuente de la app. Iconos: librería instalada (línea, tipo Lucide).

## 4. Cabecera de la página

- Arriba a la izquierda, en línea: **píldora** con punto cian y texto `MÉTRICAS EN TIEMPO REAL` + al lado en gris `• Ciclo Activo N Días` (N = días del mes mostrado, 28–31).
- Debajo título `Rastreador de Hábitos`. Debajo subtítulo: `Monitorea la consistencia neuronal, rachas activas y el rendimiento mensual de tu rutina diaria.` (máx. ~60 % ancho, gris).
- **A la derecha** (alineado con título):
  1. **Navegador de mes**: cápsula oscura con `<`, icono calendario + mes y año en dos líneas, `>`. Recargan toda la pantalla.
  2. **Botón `Añadir Hábito`**: degradado cian→azul, blanco, icono izquierda, radio ~12 px, sombra con brillo azul. Abre el modal (sección 9).

## 5. Fila de 4 tarjetas de métricas

Igual ancho (~252 px, alto ~176 px, gap ~18 px). Etiqueta arriba, valor grande centro-izquierda, texto pequeño abajo, **icono en cuadrado redondeado a la derecha** (~52 px, fondo tenue del color).

**1. CUMPLIMIENTO MENSUAL:** número grande + `%` pequeño en cian + `↗ +6.2%` (verde sube, rojo `↘` baja, oculto sin mes anterior con datos). Debajo `Meta mensual: 80%`. Derecha: **anillo de progreso** SVG (~64 px, trazo 6 px, cian sobre pista oscura).
**2. RACHA MÁS LARGA:** número grande + en cian dos líneas `días`/`seguidos`. Debajo `En 'Entrenamiento' y 'Agua'` (nombres reales; +N si más de dos). Icono llama, cuadrado azul tenue.
**3. HÁBITOS ACTIVOS:** número grande + `en seguimiento`. Debajo con punto verde `3 categorías cubiertas` (singular si 1). Icono lista verificación, cuadrado gris oscuro.
**4. COMPLETADOS HOY (DÍA 24):** número en **verde** grande + `/8` gris + `75%` verde pequeño. Debajo `Faltan 2 para el día perfecto` o `¡Día perfecto!`. Icono círculo-check, cuadrado verde tenue. Día = hoy real.

## 6. Barra de filtros y leyenda

Tarjeta delgada, una fila:
- **Izquierda, pestañas** (píldoras): `Todos (8)`, `Salud & Físico (3)`, `Productividad (3)`, `Mentalidad (2)` — conteos reales. Activa: fondo cian sólido + texto oscuro; inactivas: texto gris. Filtrar oculta filas (sin recarga); KPIs **no cambian**.
- **Derecha, leyenda**: cian = `Completado`, gris oscuro = `Sin registrar`, casi negro = `Futuro`. Insignia `HOY: 24` (cian tenue, mayúsculas) solo en mes actual.

## 7. La cuadrícula de hábitos (LA PARTE MÁS IMPORTANTE)

Tarjeta grande. Tabla-calendario: fila por hábito, columna por día.
**Encabezado:** izquierda `HÁBITO & FRECUENCIA`; resto `01 02 … 31` (hoy en cian).
**Columna izquierda (~300 px, fija/sticky):** cuadrado ~40 px con icono (fondo = color del hábito tenue); nombre en **negrita** blanca + `Categoría • Detalle` en gris (`Salud • 45m`, etc.; sin etiqueta corta → frecuencia).
**Celdas (~30×30, radio ~6, gap ~4):** Completado = cian sólido + ✓ blanco; Sin registrar = gris azulado oscuro; Futuro = casi negro, no clicable. Hoy sin marcar: contorno cian fino. Completadas siempre cian (color del hábito solo en el icono).
**Comportamiento:** click en pasada/hoy = alternar (optimista, reversión + aviso si falla; recalcula KPIs y gráfico al instante). Futuras: nada. Scroll horizontal fino; columna izquierda sticky; auto-scroll a hoy al cargar. Hover: fondo más claro + menú `⋯` (editar/archivar/eliminar si existe). "Evitar": completado = lo evité. Fuera de rango inicio/fin → Futuro, no cuenta. No diarios: solo cuentan días por frecuencia; resto apagado. Respetar lógica de frecuencia existente.

## 8. Fila inferior

**Izquierda: "Consistencia Semanal"** — título con icono barras cian + insignia `PROMEDIO: 88%`. Texto: `Frecuencia agregada de cumplimiento por día durante las N semanas de {Mes}.` 7 barras (Lun–Dom, ~68 px, % encima, etiqueta debajo, altura ∝ % con mínimo visible, degradado cian→azul, esquinas sup. redondeadas; la menor apagada). Pie: `Día con mayor rendimiento: **Martes (98%)**` + enlace `Ver reporte detallado →` (modal con tabla por hábito: nombre, % mes, días completados, racha actual y máxima).
**Derecha arriba: "Hito Desbloqueado"** — icono escudo/check verde tenue + píldora `Hito Desbloqueado`. Título `Dominio de Hábitos de Salud`. Texto con `100% de consistencia` en verde negrita. Barra interna: `Neuroplasticidad: Nivel 4` + `+450 XP` cian. Datos reales (sección 10); vacío: `Aún sin hitos. Mantén tus rachas para desbloquear el primero.`
**Derecha abajo: "Reflexión de Productividad"** — bombilla + título + línea gris con `…`.

## 9. Modal "Añadir Hábito"

Desde botón cabecera (y `+ Nuevo Hábito` de topbar si existe). **Nunca inline.** Centrado (o panel lateral), backdrop, título `Nuevo hábito`, cierra con `Esc`/Cancelar/clic fuera, foco atrapado. **Conserva campos actuales** (Nombre obligatorio `Ej. Correr por la mañana`, Dirección Construir/Evitar, Frecuencia, Meta opcional, Inicio/Fin opcionales, Color, Icono, Descripción opcional). **Nuevos:** `Categoría` (Salud & Físico, Productividad, Mentalidad + escribir nueva) y `Etiqueta corta (opcional)` (45m, Noche, Reto). Color = ~8 muestras clicables. Icono = ~16 iconos en cuadrícula con resaltado. Botones `Crear` (cian) y `Cancelar`. Valida nombre no vacío. Al crear: cierra y la fila aparece sin recargar, KPIs actualizados.

## 10. Reglas de cálculo (números reales)

Fechas locales `YYYY-MM-DD` (usuario UTC-5), no UTC.
- **Esperadas** = días del mes hasta hoy inclusive (mes actual) dentro de rango y por frecuencia. Pasados: todos. Futuros: cero.
- **Cumplimiento** = completadas ÷ esperadas (activos). 0 esperadas → `0%`. **Delta** = pp contra mes anterior completo.
- **Meta mensual**: constante en un lugar, default 80.
- **Racha más larga**: máx. días consecutivos en cualquier hábito, todo el historial. Nombres de los que empatan.
- **Activos**: no archivados y vigentes en mes visible. **Categorías**: distintas entre ellos.
- **Completados hoy**: completados hoy ÷ que tocan hoy. "Faltan" = diferencia.
- **Consistencia semanal**: por día de semana, completadas ÷ esperadas del mes visible (hasta hoy). PROMEDIO = media. Mejor día = mayor %.
- **XP**: +10 por celda. `+450 XP` = mes visible. `Nivel` = 1 + floor(XP histórico ÷ 500).
- **Hito**: categoría con 100 % últimos 14 días → texto con su nombre. Si no, mejor hábito por racha actual (mín 7 días). Si no, vacío.
- **Reflexión**: por hábito, % promedio demás hábitos en días con vs sin completar; mayor diferencia positiva: `Los días en que completas «{hábito}», tu cumplimiento total sube {N} puntos.` Mín 14 días; si no: `Registra al menos 2 semanas para ver tus patrones.`

## 11. Estados, responsive y accesibilidad

- **Sin hábitos**: tarjeta con icono, `Aún no tienes hábitos`, botón `Añadir tu primer hábito`. KPIs en 0. Sin NaN/undefined/Infinity.
- **Cargando**: skeletons. **Error red**: toast + reversión.
- **Responsive**: ≥1200 como descrito; 700–1200: KPIs 2×2, inferior apilada; <700: KPIs 1 col. Grid siempre scroll horizontal + sticky.
- **Accesibilidad**: celdas `<button>` con `aria-pressed` y `aria-label` (`Entrenamiento de fuerza, 12 de octubre: completado`). Foco visible. Teclado en modal.

## 12. Criterios de aceptación

1. Al entrar: cabecera visible y **ningún formulario abierto**.
2. 4 KPIs con textos y orden exactos (sección 5).
3. Pestañas con conteos reales + leyenda con `HOY: N`.
4. Grid: fila por hábito, columna por día, 3 estados, sticky + scroll.
5. Click alterna pasada/hoy, persiste al recargar; futuras no responden.
6. Alternar actualiza KPIs y gráfico al instante.
7. Flechas de mes actualizan cabecera, KPIs, grid y gráfico.
8. Filtros ocultan/muestran filas.
9. 7 barras proporcionales + pie mejor día.
10. Hito y Reflexión con datos reales + vacíos.
11. Modal con todos los campos (Categoría + Etiqueta corta); crear agrega fila sin recargar.
12. Datos existentes intactos.
13. Sin errores consola, sin NaN, todo español.

## 13. Orden de trabajo

1. Inspeccionar repo + plan de 10 líneas.
2. Modelo y API: `categoría` + `etiqueta corta` (migración aditiva) + endpoint leer/alternar por hábito/fecha/mes.
3. Cálculos (sección 10) aislados + pruebas unitarias.
4. Cabecera + 4 KPIs.
5. Filtros + grid con interacción.
6. Modal crear (quitar inline).
7. Fila inferior.
8. Vacíos, responsive, a11y.
9. Verificación §12 + reporte final.

## Reporte final (2026-09-20)

- Rama: `feat/habitos-dashboard` → merge a `main` + push + deploy Dokploy `personal-dashboard`.
- Verificación: vitest 33 files/351 passed, `cargo test habits` 58 passed (con DB), `tsc` limpio, Judgment Day 2 rondas + confirmación (APPROVE), smoke en navegador local (mes actual + pasado, toggle, modal, sin errores de consola) y en prod tras el deploy.
- Archivos cambiados:
  - `backend/migrations/0010_habit_category_short_label.sql` (nueva, aditiva: `category`, `short_label` nulables).
  - `backend/src/routes/habits.rs` (DTOs + SQL + `DELETE /habits/{id}/logs/{date}` idempotente + filtro `NOT is_archived` en today + tests).
  - `backend/src/main.rs` (registro DELETE).
  - `frontend/lib/productivity/habitDashboard.ts` (+ tests): cálculos §10 puros.
  - `frontend/lib/api/productivity.ts` (+ tests): `useHabitsList`, `deleteHabitLog`, `toggleHabitLog`, `archiveHabit`, campos nuevos.
  - `frontend/lib/api/dashboard.ts`: export `DASHBOARD_HABITS_TODAY_KEY`.
  - `frontend/components/habits/` (nuevo): `HabitsDashboard`, `HabitGrid`, `HabitCreateModal`, `WeeklyChart`.
  - `frontend/app/dashboard/habitos/page.tsx` (+ tests): renderiza el dashboard.
  - `frontend/lib/i18n/es.ts`: namespace `habitsDashboard` con copy exacto.
  - Eliminados: `HabitsSection`, `HabitCreateForm`, `HabitsTrackerGrid` (+ su test).
  - `.github/workflows/ci.yml`: servicio Postgres + migraciones para que los tests DB corran en CI.
- Decisiones tomadas:
  - Iconos SVG línea propios (no se instaló lucide; no había librería instalada y la spec prohibía deps pesadas).
  - Celdas completadas en cian `signal`; verdes de éxito con `#22C55E/#4ADE80`; XP en `#38BDF8` (spec §8: cian).
  - `category`/`short_label` nulables sin backfill (no inventar categorías a datos viejos); PATCH en blanco = no-op (igual que color/icon).
  - `DELETE log` siempre 204 (idempotente); toggle-off solo borra filas `done`.
  - Ventana de historial 12 meses (tope de la API: 366 días) anclada a hoy + fetch separado del mes visible; racha/XP nivel sobre esa ventana (limitación aceptada: más allá de 12 meses no es alcanzable por API).
  - Menú ⋯ solo `Archivar` (con confirm) + sección `Archivados` con `Desarchivar` (editar/eliminar no se exponen para no perder datos).
  - Método ODD en vez de SDD (spec completa; SDD no agregaba valor).
- Pendiente / conocido:
  - `ReportsScreens` custom >366 días puede 422 (preexistente, fuera de scope).
  - Tests DB se saltan sin `DATABASE_URL` (ahora corren en CI).
