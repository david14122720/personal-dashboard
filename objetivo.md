Quiero que desarrolles una plataforma web personal privada que funcione como un centro de control de mi vida personal.

La plataforma debe combinar principalmente:

* Finanzas personales.
* Seguimiento de hábitos.
* Metas personales.
* Tareas.
* Calendario.
* Suscripciones.
* Deudas.
* Patrimonio personal.
* Notas.
* Estadísticas y gráficos.

El objetivo es tener un único lugar donde pueda consultar rápidamente cómo están mis finanzas, qué hábitos estoy construyendo o intentando dejar, qué metas estoy cumpliendo y cuáles son mis pendientes.

La plataforma debe ser muy completa internamente, pero extremadamente sencilla de utilizar.

## Dashboard principal

La página principal debe mostrar un resumen general de mi situación actual.

Debe poder mostrar:

* Dinero disponible.
* Ingresos del mes.
* Gastos del mes.
* Ahorro del mes.
* Balance mensual.
* Porcentaje de ahorro.
* Próximos pagos.
* Deudas pendientes.
* Suscripciones activas.
* Hábitos de hoy.
* Racha de hábitos.
* Tareas pendientes.
* Próximos eventos.
* Progreso de metas.

También debe existir una sección de gráficos que permita visualizar rápidamente la evolución de mis finanzas y progreso personal. Decisión: dashboard completo desde el arranque con los 14 widgets listados más gráficos, sin versión recortada inicial.

El dashboard debe poder personalizarse para mostrar u ocultar diferentes secciones.

---

# Finanzas personales

Debe existir un módulo completo para gestionar mis finanzas personales.

Decisión: todo se maneja solo en pesos colombianos (COP), sin multi-moneda ni conversiones. Toda carga es 100% manual: los montos se escriben a mano y cuentas/categorías/métodos se eligen por nombre en selectores simples, sin UUIDs ni IDs técnicos visibles.

## Cuentas

Debe permitir registrar diferentes cuentas y fuentes de dinero.

Por ejemplo:

* Cuenta bancaria.
* Cuenta de ahorros.
* Efectivo.
* Billetera digital.
* Tarjeta de crédito.
* Inversiones.
* Otras cuentas.

Cada cuenta debe mostrar su saldo actual. Decisión: el saldo inicial se carga manual y luego se mueve con los movimientos, pero el saldo es editable libre y el usuario puede corregirlo directo cuando quiera.

Debe poder consultar el historial de movimientos de cada cuenta.

## Ingresos

Debe permitir registrar ingresos de forma manual y simple. Yo mismo ingreso a mano el monto que gané. Nunca debe pedirse ni mostrarse UUIDs ni IDs técnicos: la cuenta y la categoría se eligen por nombre en un selector simple.

Cada ingreso puede incluir:

* Fecha.
* Valor.
* Fuente.
* Cuenta donde fue recibido.
* Categoría.
* Descripción.
* Tipo de ingreso.

Por ejemplo:

* Salario.
* Trabajo independiente.
* Ventas.
* Transferencias.
* Otros ingresos.

## Gastos

Debe permitir registrar gastos de forma manual y simple. Yo mismo ingreso a mano el monto que gasté. Nunca debe pedirse ni mostrarse UUIDs ni IDs técnicos: la cuenta, la categoría y el método de pago se eligen por nombre en selectores simples.

Cada gasto debe incluir:

* Fecha.
* Valor.
* Categoría.
* Cuenta utilizada.
* Descripción.
* Método de pago.
* Tipo de gasto.

Las categorías deben poder personalizarse.

Por ejemplo:

* Alimentación.
* Transporte.
* Vivienda.
* Educación.
* Entretenimiento.
* Tecnología.
* Salud.
* Ropa.
* Servicios.
* Compras.
* Otros.

## Transferencias

Debe existir una forma simple y manual de registrar transferencias entre mis propias cuentas. Elijo origen y destino por nombre y escribo el monto a mano. Nunca debe pedirse ni mostrarse UUIDs ni IDs técnicos.

Una transferencia no debe contabilizarse como un ingreso o gasto real.

El sistema debe mantener correctamente los saldos de ambas cuentas.

---

# Presupuestos

Debe existir un sistema de presupuestos.

Debe poder establecer cuánto quiero gastar en determinadas categorías durante un período.

Por ejemplo:

* Alimentación: $500.000.
* Transporte: $200.000.
* Entretenimiento: $100.000.

El sistema debe mostrar:

* Presupuesto establecido.
* Dinero gastado.
* Dinero restante.
* Porcentaje utilizado.

Debe advertir cuando me esté acercando o superando un presupuesto. Decisión: el presupuesto es solo aviso visual (barras/colores), nunca bloquea ni impide registrar gastos.

---

# Gráficos financieros

La sección financiera debe tener visualizaciones completas pero fáciles de entender.

Debe incluir gráficos como:

* Ingresos vs gastos.
* Evolución del saldo.
* Gastos por categoría.
* Ingresos por fuente.
* Evolución del ahorro.
* Gastos mensuales.
* Comparación entre meses.
* Distribución de gastos.
* Evolución del patrimonio.

Debe poder seleccionar diferentes períodos:

* Semana.
* Mes.
* Trimestre.
* Año.
* Período personalizado.

Los gráficos deben permitir comprender rápidamente en qué estoy gastando mi dinero y cómo está evolucionando mi situación financiera.

---

# Análisis financiero

La plataforma debe generar indicadores útiles.

Por ejemplo:

* Tasa de ahorro.
* Promedio de gastos.
* Promedio de ingresos.
* Categoría donde más gasto.
* Variación respecto al mes anterior.
* Gastos recurrentes.
* Gastos extraordinarios.
* Mes con mayor gasto.
* Mes con mayor ahorro.

También debe destacar cambios importantes.

Por ejemplo:

"Este mes gastaste 18% más en alimentación que el mes anterior."

"Tu ahorro aumentó respecto al mes pasado."

La información debe presentarse como análisis personal y no como asesoramiento financiero profesional.

---

# Ahorros

Debe existir un módulo para objetivos de ahorro.

Cada objetivo debe permitir definir:

* Nombre.
* Valor objetivo.
* Valor ahorrado.
* Fecha objetivo.
* Descripción.

Debe mostrar visualmente el progreso.

Por ejemplo:

"Comprar portátil"

$2.000.000 / $4.000.000

50%

También debe mostrar cuánto falta para alcanzar el objetivo.

---

# Deudas

Debe existir un módulo para administrar deudas.

Cada deuda puede incluir:

* Nombre.
* Acreedor.
* Valor original.
* Valor pendiente.
* Fecha de inicio.
* Fecha límite.
* Cuota.
* Intereses, cuando corresponda.
* Estado.

Debe mostrar gráficamente el progreso de pago.

También debe poder registrar abonos y actualizar automáticamente el saldo pendiente. Decisión: modelo simple — debo, aboné, falta. Sin cuotas enredadas ni intereses compuestos.

---

# Tarjetas de crédito

Debe existir soporte para tarjetas de crédito.

Debe permitir registrar:

* Límite.
* Saldo utilizado.
* Saldo disponible.
* Fecha de corte.
* Fecha de pago.
* Compras.
* Pagos.

Debe mostrar visualmente cuánto del límite estoy utilizando. Decisión: la tarjeta se maneja como una cuenta con límite, saldo usado/disponible, fecha de corte y pago, y alerta de uso alto.

También debe advertir cuando el uso de una tarjeta esté alcanzando niveles elevados.

---

# Suscripciones

Debe existir un apartado para controlar suscripciones y pagos recurrentes.

Por ejemplo:

* Netflix.
* Spotify.
* Servicios de software.
* Hosting.
* Dominios.
* Servicios de IA.
* Aplicaciones.
* Membresías.

Cada suscripción debe incluir:

* Nombre.
* Precio.
* Frecuencia.
* Fecha del próximo cobro.
* Categoría.
* Método de pago.
* Estado.

Debe calcular cuánto gasto mensualmente y anualmente en suscripciones.

Debe mostrar los próximos cobros. Decisión: todo lo recurrente es manual, nada se genera ni se cobra automático; el usuario confirma cada movimiento a mano.

---

# Patrimonio personal

Debe existir una sección para conocer mi patrimonio.

Debe poder registrar:

* Dinero.
* Cuentas.
* Inversiones.
* Equipos.
* Vehículos.
* Propiedades.
* Otros activos.

También debe registrar obligaciones y deudas.

Debe mostrar:

**Patrimonio neto = activos - obligaciones**

Decisión: patrimonio simple, solo el número (activos - deudas) con carga manual de activos. Sin desglose complejo ni evolución por ahora; el gráfico de evolución no es requerido en esta versión.

Gráfico de evolución del patrimonio: NO requerido en esta versión (patrimonio simple, solo el número).

---

# Seguimiento de hábitos

Debe existir un módulo completo de seguimiento de hábitos, también conocido como Habit Tracker.

Debe permitir crear hábitos que quiero:

* Construir.
* Mantener.
* Reducir.
* Dejar.

Cada hábito debe tener:

* Nombre.
* Descripción.
* Tipo.
* Frecuencia.
* Fecha de inicio.
* Objetivo.
* Recordatorio opcional.
* Categoría.

Ejemplos:

* Hacer ejercicio.
* Leer.
* Estudiar inglés.
* Beber agua.
* Dormir temprano.
* No fumar.
* Reducir redes sociales.
* Evitar determinado comportamiento.

## Registro diario

Cada día debe poder registrar fácilmente si cumplí o no un hábito.

La interfaz debe permitir marcar:

* Cumplido.
* No cumplido.
* Omitido, cuando corresponda.

Debe ser extremadamente rápido registrar los hábitos del día. Decisión: check diario simple (cumplido / no cumplido / omitido).

---

# Hábitos positivos y hábitos que quiero dejar

El sistema debe diferenciar entre hábitos que quiero aumentar y comportamientos que quiero reducir o dejar.

Para hábitos positivos:

Debe mostrar:

* Días cumplidos.
* Racha actual.
* Mejor racha.
* Porcentaje de cumplimiento.
* Progreso semanal.
* Progreso mensual.
* Progreso anual.

Para comportamientos que quiero reducir o dejar:

Debe permitir visualizar:

* Días consecutivos sin realizar el comportamiento.
* Mejor racha.
* Racha actual.
* Cantidad de recaídas o días no cumplidos.
* Evolución a lo largo del tiempo.

No debe utilizar un lenguaje que genere culpa o vergüenza cuando no se cumpla un objetivo. Decisión: se mantiene así, solo progreso y patrones, con días cumplidos, racha, mejor racha y porcentaje de cumplimiento.

Debe enfocarse en mostrar progreso y ayudarme a identificar patrones.

---

# Calendario de hábitos

Debe existir una vista tipo calendario donde pueda visualizar mi historial.

Cada día debe indicar visualmente:

* Hábitos cumplidos.
* Hábitos no cumplidos.
* Días sin registro.

Debe poder consultar cualquier fecha anterior.

También debe existir una vista de calendario mensual similar a un "heatmap" para identificar patrones de constancia. Decisión: el heatmap mensual es parte del alcance inicial.

---

# Estadísticas de hábitos

Debe existir un apartado de estadísticas.

Debe mostrar:

* Porcentaje de cumplimiento.
* Racha actual.
* Mejor racha.
* Días cumplidos.
* Días no cumplidos.
* Evolución semanal.
* Evolución mensual.
* Evolución anual.

Debe poder comparar diferentes hábitos. Decisión: stats base (racha actual, mejor racha, % cumplimiento) desde el arranque.

---

# Metas personales

Debe existir un módulo para establecer metas.

Las metas pueden pertenecer a diferentes áreas:

* Finanzas.
* Estudios.
* Trabajo.
* Salud.
* Productividad.
* Proyectos personales.
* Lectura.
* Aprendizaje.
* Otras.

Cada meta debe permitir establecer:

* Nombre.
* Descripción.
* Categoría.
* Fecha límite.
* Progreso.
* Estado.

Debe existir una representación visual del progreso.

---

# Tareas

Debe existir un sistema sencillo de tareas.

Debe permitir:

* Crear tareas.
* Editarlas.
* Completarlas.
* Eliminarlas.
* Establecer prioridad.
* Establecer fecha límite.
* Asociarlas con una meta.

Debe existir una vista de:

* Hoy.
* Próximas.
* Vencidas.
* Completadas.

La gestión de tareas debe mantenerse sencilla y no convertirse en un sistema excesivamente complejo.

---

# Calendario personal

Debe existir un calendario donde pueda registrar:

* Eventos.
* Citas.
* Fechas importantes.
* Recordatorios.
* Fechas de pago.
* Fechas relacionadas con metas.
* Fechas relacionadas con hábitos.

Debe permitir visualizar fácilmente mis compromisos.

---

# Notas personales

Debe existir un módulo sencillo para escribir y organizar notas.

Debe permitir:

* Crear notas.
* Editarlas.
* Eliminarlas.
* Buscar notas.
* Clasificarlas.
* Fijar notas importantes.

Debe ser rápido para capturar información.

---

# Recordatorios

La plataforma debe permitir configurar recordatorios para:

* Citas.
* Pagos.
* Suscripciones.
* Hábitos.
* Tareas.
* Metas.
* Fechas importantes.

Los recordatorios deben poder activarse o desactivarse individualmente. Decisión: solo dentro de la app (campanita, lista de vencidas y próximos pagos). Sin push ni email en esta versión.

---

# Búsqueda global

Decisión del dueño: no se implementa, la navegación debe hacer todo encontrable. Sin buscador global en esta versión; todo debe estar bien distribuido y fácil de encontrar por navegación.

Referencia de lo que NO se hará por ahora (se conserva solo como contexto):

* Movimientos financieros.
* Cuentas.
* Hábitos.
* Metas.
* Tareas.
* Eventos.
* Notas.
* Suscripciones.
* Deudas.

---

# Reportes

Debe existir una sección de reportes personales.

Debe permitir generar resúmenes de:

* Finanzas.
* Hábitos.
* Metas.
* Actividad personal.

Exportación a PDF/Excel: NO requerida en esta versión. Decisión: solo visualización en pantalla por período.

Debe ser posible seleccionar períodos específicos. Decisión: reportes solo en pantalla por período.

---

# Dashboard de progreso personal

Debe existir una sección que combine diferentes indicadores.

Por ejemplo:

### Finanzas

* Ahorro mensual.
* Gastos.
* Patrimonio.
* Progreso de objetivos financieros.

### Hábitos

* Cumplimiento general.
* Mejores rachas.
* Hábitos pendientes.
* Evolución semanal.

### Productividad

* Tareas completadas.
* Metas avanzadas.
* Próximos eventos.

El objetivo es poder abrir la plataforma y entender rápidamente cómo estoy progresando.

---

# Sistema de puntuación personal

Opcionalmente, debe existir un indicador general de progreso que combine diferentes áreas.

Debe mostrar de forma visual cómo estoy avanzando en:

* Finanzas.
* Hábitos.
* Metas.
* Productividad.

Este indicador debe ser únicamente una herramienta visual y no debe presentar conclusiones médicas, psicológicas o financieras.

---

# Privacidad y seguridad

Esta será una plataforma personal privada.

Toda la información debe estar protegida.

Debe existir autenticación segura.

Los datos financieros, hábitos, notas y demás información personal solamente deben ser accesibles por el usuario autorizado.

No debe existir exposición pública de información personal.

Las operaciones importantes deben estar correctamente protegidas.

---

# Diseño

La plataforma debe tener un diseño moderno, elegante y minimalista.

Debe sentirse como una aplicación personal premium.

Debe priorizar:

* Claridad.
* Velocidad.
* Facilidad de uso.
* Buena organización.
* Información visual.
* Gráficos fáciles de interpretar.

Debe funcionar perfectamente en:

* Computador.
* Tablet.
* Teléfono móvil.

La versión móvil debe ser completamente funcional.

---

# Personalización

Debe poder personalizar:

* Moneda: solo COP (pesos colombianos), sin multi-moneda ni conversiones.
* Categorías financieras.
* Categorías de hábitos.
* Categorías de metas.
* Presupuestos.
* Cuentas.
* Hábitos.
* Objetivos.
* Preferencias de visualización.

La plataforma debe estar preparada para crecer con nuevas funcionalidades.

---

# Resultado esperado

Quiero una plataforma web personal que funcione como mi centro de control.

Al entrar debería poder responder rápidamente:

**¿Cómo están mis finanzas?**

**¿Cuánto estoy gastando y ahorrando?**

**¿En qué estoy gastando más?**

**¿Cuánto dinero tengo?**

**¿Cuánto debo?**

**¿Cuánto valen mis activos?**

**¿Qué hábitos estoy cumpliendo?**

**¿Qué hábitos estoy intentando dejar?**

**¿Cuáles son mis mejores rachas?**

**¿Qué metas estoy alcanzando?**

**¿Qué tareas tengo pendientes?**

**¿Qué eventos y pagos tengo próximamente?**

La plataforma debe ser visualmente muy completa y ofrecer estadísticas detalladas, pero todas las acciones cotidianas deben ser rápidas y sencillas.

No quiero únicamente una colección de pantallas bonitas. Todas las funcionalidades deben estar conectadas y utilizar información real almacenada en la plataforma.

...
Cuando algún detalle no esté especificado, toma decisiones razonables priorizando simplicidad, privacidad, facilidad de uso, claridad visual y utilidad práctica para el día a día.

---

# Arquitectura Técnica Seleccionada

**Ruta:** Opción 1 (Equilibrada y Escalable)

*   **Backend:** Rust con **Axum** y **PostgreSQL**.
*   **Frontend:** **Next.js** (React) y **Tailwind CSS**.
*   **Comunicación:** API REST.

...
## Estructura de Carpetas Propuesta

```text
personal_dashboard/
├── backend/                # Proyecto Rust (Axum)
│   ├── src/                # Código fuente del servidor
│   ├── tests/              # Pruebas integrales
│   ├── Cargo.toml          # Dependencias de Rust
│   └── .env                # Variables de entorno del backend
├── frontend/               # Proyecto Next.js (Static Export)
│   ├── app/                # App Router (páginas y layouts)
│   ├── components/         # Componentes reutilizables (UI/Business)
│   ├── lib/                # Utilidades y clientes de API
│   ├── public/             # Activos estáticos
│   ├── package.json         # Dependencias de Node.js
│   └── tailwind.config.js  # Configuración de estilos
├── docker/                 # Configuraciones de despliegue
│   ├── postgres/           # Configuración de DB
│   └── backend.Dockerfile  # Imagen de Rust (Sirve archivos estáticos del frontend)
├── docker-compose.yml      # Orquestación local
└── .gitignore              # Archivos excluidos del repositorio
```

# Optimización para Servidor Limitado (1 CPU, 1GB RAM)

Para garantizar que la plataforma funcione con fluidez en un entorno de recursos restringidos, se aplica la siguiente estrategia:

**Frontend Estático (`output: 'export'`)**
- El frontend de Next.js no se ejecutará como un servidor de Node.js en producción.
- Se generará un export estático (HTML, CSS, JS) durante el proceso de build.
- Estos archivos serán servidos directamente por el backend de Rust (Axum) o un servidor ligero (Nginx).
- **Beneficio:** Reducción drástica del consumo de RAM del frontend (de ~300MB a ~5MB).
