# 📈 Mis Cuentas

App personal para controlar gastos, ingresos, inversiones y **salud financiera**.
Se sincroniza entre el móvil y el ordenador (Supabase) y registra sola los movimientos
leyendo las notificaciones del **Banco Sabadell** en Android (MacroDroid).

```
Notificación Sabadell ──► MacroDroid (Android) ──► Supabase (base de datos) ◄──► App (móvil y PC, GitHub Pages)
```

## Qué hace

- **Resumen** del mes: ingresos, gastos, balance, «Has ahorrado un X %», reparto por categorías y presupuestos.
- **Movimientos**: lista por días, buscador y filtro *Por revisar*. Cada notificación entra sola; tú solo confirmas la categoría.
- **Compensaciones**: si un amigo te devuelve por Bizum su parte de una cena, márcalo como *Compensación → Fiesta*: no cuenta como ingreso y reduce ese gasto.
- **Reglas automáticas**: EJ: «si el concepto contiene MERCADONA → Comida».
- **Patrimonio**: cuentas, efectivo e inversiones con su rentabilidad. Objetivos: superar la inflación y balance ≥ 0 (de momento).
- **Salud financiera** (0–100): ahorro, colchón de emergencia (hay que poner myinvestor y alguna manera revolut para poder llevar a cabo un seguimiento de mis inversiones desde la misma app), inversión, presupuestos e ingresos propios, con recomendaciones.
- Exportar a CSV, modo oscuro y se puede instalar como app.

---

## Puesta en marcha (una sola vez)

### 1 · Supabase: crear la base de datos
1. Entra en tu proyecto **mis cuentas** en <https://supabase.com/dashboard>.
2. Menú izquierdo → **SQL Editor** → **New query**.
3. Abre `supabase/01_esquema.sql`, copia **todo**, pégalo y pulsa **Run**. Debe salir *Success*.

### 2 · Supabase: copiar la clave pública
1. Ve a **Project Settings** (rueda dentada) → **API Keys**.
2. Copia la **Publishable key** (empieza por `sb_publishable_…`).
   Si solo ves claves antiguas, ve a la pestaña **Legacy API keys** y copia la **anon public** (empieza por `eyJ…`).
3. Abre `config.js` y pégala en lugar de `PEGA_AQUI_TU_CLAVE_PUBLISHABLE`.

> ⚠️ Nunca uses la clave **secret** ni la **service_role**: esas dan acceso total.

### 3 · GitHub: subir la app y publicarla
1. En tu repositorio → **Add file → Upload files**.
2. Arrastra **todo el contenido** de esta carpeta (incluidas las carpetas `icons` y `supabase`) → **Commit changes**.
3. **Settings → Pages** → *Source*: **Deploy from a branch** → *Branch*: **main** y **/(root)** → **Save**.
4. En 1–2 minutos la app estará en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`
   (la dirección exacta aparece arriba en esa misma página).

### 4 · Supabase: permitir esa dirección
**Authentication → URL Configuration**:
- **Site URL**: pega la dirección de tu app (la del paso 3).
- **Redirect URLs** → *Add URL*: la misma dirección.

Así el email de confirmación te lleva de vuelta a tu app.

### 5 · Crear tu usuario
Abre la app → escribe tu email y una contraseña → **Crear cuenta** → confirma el email que te llega → **Entrar**.

### 6 · (Opcional) Importar tu Excel
Ejecuta en el **SQL Editor** el archivo `02_importar_excel.sql` que te entregué aparte
(enero–mayo 2026 y tu patrimonio). **No lo subas a GitHub**: contiene tus datos.

### 7 · Instalar en el móvil
Abre la dirección en **Chrome** (Android) → menú **⋮** → **Instalar aplicación** (o *Añadir a pantalla de inicio*).
En el ordenador, en Chrome/Edge aparece un icono de instalar en la barra de direcciones.

---

## Conectar las notificaciones del Sabadell (MacroDroid)

1. Instala **MacroDroid** desde Google Play.
2. En la app **Mis Cuentas → Ajustes → Conexión con las notificaciones** tienes la URL, la clave y el cuerpo. Toca cada uno para copiarlo.
3. En MacroDroid → **Añadir macro**:
   - **Disparador**: *Notificación* → **Notificación recibida** → *Seleccionar aplicaciones*: **Banco Sabadell** → *Contenido*: cualquiera.
   - **Acción**: *Web* → **Petición HTTP**:
     - Método: **POST**
     - URL: `https://biuosgtrwjytonsimhaj.supabase.co/rest/v1/rpc/registrar_notificacion`
     - Cabeceras: `apikey` = tu clave pública · `Content-Type` = `application/json`
     - Cuerpo (tipo *application/json*):
       ```json
       {"p_token":"TU_TOKEN","p_titulo":"[notification_title]","p_texto":"[notification]"}
       ```
       `[notification]` y `[notification_title]` son *texto mágico* de MacroDroid. Si no se rellenan solos, bórralos e insértalos con el botón de texto mágico: *Texto de la notificación* y *Título de la notificación*.
   - Ponle de nombre **Mis Cuentas** y guarda.
4. Da a MacroDroid el permiso de **acceso a notificaciones** cuando te lo pida.
5. **Ajustes de Android → Aplicaciones → MacroDroid → Batería → Sin restricciones**. Si no, Android puede cerrarlo.
6. Prueba: en **Ajustes → Probar con una notificación de ejemplo**, o espera a tu próxima compra. Abajo verás *Últimas notificaciones recibidas*.

### Qué notificaciones entiende
| Notificación | Resultado |
|---|---|
| `Has recibido un Bizum de 23,00 EUR de MARIA…` | Ingreso 23,00 € · «Bizum de MARIA…» (a revisar: ¿ingreso o compensación?) |
| `💳 Nueva compra de 12,00 EUR TORRES, ES, r…` | Gasto 12,00 € · «TORRES» |
| `Has enviado un Bizum de 5,00 EUR a PABLO` | Gasto 5,00 € · «Bizum a PABLO» |
| `… transferencia de 150,00 EUR de …` | Ingreso 150,00 € |
| Avisos sin importe (códigos, publicidad…) | Se ignoran (quedan en el registro) |

Si alguna se lee mal, mándame el texto que aparece en *Últimas notificaciones recibidas* y ajusto el lector (`leer_notificacion` en `01_esquema.sql`).

---

## Estructura

```
index.html            página de la app
app.js                lógica (vistas, cálculos, diagnóstico)
styles.css            estilos (claro / oscuro)
config.js             URL y clave pública de Supabase
manifest.webmanifest  datos para instalarla como app
sw.js                 service worker (instalación / arranque rápido)
icons/                iconos
supabase/01_esquema.sql  tablas, seguridad y lector de notificaciones
```

## Seguridad
- Cada tabla tiene reglas (RLS): solo tu usuario puede ver o modificar tus datos.
- La clave pública de `config.js` puede estar en GitHub sin problema: por sí sola no da acceso a tus datos.
- El **token** de MacroDroid solo permite *añadir* movimientos. Si se filtra, cámbialo en Ajustes → *Cambiar token*.
