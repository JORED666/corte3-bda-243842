# 🐾 Clínica Veterinaria — Sistema Full-Stack con Seguridad de BD

Sistema de gestión para una clínica veterinaria construido con **PostgreSQL + Redis + Node.js + React**, con seguridad de base de datos como eje central: roles granulares, Row-Level Security, caché distribuido y hardening contra SQL Injection.

---

## ¿Qué hace el sistema?

El sistema permite a tres tipos de personal operar la clínica con acceso restringido según su rol:

| Rol | Qué puede hacer |
|-----|----------------|
| **Veterinario** | Ve solo las mascotas que él atiende. Registra citas y aplica vacunas a sus pacientes. |
| **Recepción** | Ve todas las mascotas y dueños. Agenda citas para cualquier veterinario. |
| **Administrador** | Acceso total. Gestiona inventario, usuarios y asignaciones. |

Estas restricciones no están solo en el frontend — están **enforceadas a nivel de base de datos** con Row-Level Security, de forma que aunque alguien acceda directamente a PostgreSQL con credenciales de veterinario, solo ve sus propios datos.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Base de datos | PostgreSQL 16 |
| Caché | Redis 7 |
| Backend / API | Node.js 20 + Express |
| Frontend | React 18 + Vite |
| Contenedores | Docker + Docker Compose |

---

## Medidas de seguridad implementadas

### 1. Roles y mínimo privilegio (GRANT / REVOKE)
Tres roles de PostgreSQL con permisos tabla por tabla:
- `rol_veterinario` — SELECT en mascotas (filtrado por RLS), INSERT en citas y vacunas_aplicadas
- `rol_recepcion` — SELECT en mascotas y dueños, INSERT en citas. **Sin acceso a vacunas_aplicadas**
- `rol_admin` — ALL PRIVILEGES

```sql
-- Recepción no puede ver información médica
GRANT SELECT ON mascotas TO rol_recepcion;
GRANT SELECT ON duenos   TO rol_recepcion;
-- vacunas_aplicadas: sin GRANT → acceso denegado automáticamente
```

### 2. Row-Level Security (RLS)
Políticas aplicadas sobre tres tablas (`mascotas`, `citas`, `vacunas_aplicadas`). Un veterinario que consulta `SELECT * FROM mascotas` recibe **solo sus pacientes**.

```sql
CREATE POLICY pol_mascotas_veterinario
ON mascotas FOR SELECT TO rol_veterinario
USING (
    id IN (
        SELECT mascota_id FROM vet_atiende_mascota
        WHERE vet_id = NULLIF(current_setting('app.vet_id', true), '')::INT
          AND activa = true
    )
);
```

### 3. Hardening contra SQL Injection
Toda query con input del usuario usa **parámetros posicionales** del driver `pg`. Nunca se concatena input en strings SQL.

```javascript
await client.query(
    'SELECT * FROM mascotas WHERE nombre ILIKE $1',
    [`%${nombre}%`]
);
```

Tres ataques documentados que el sistema resiste (ver `cuaderno_ataques.md`):
- `' OR '1'='1` — quote-escape clásico
- `'; DROP TABLE mascotas; --` — stacked query
- `' UNION SELECT cedula FROM veterinarios --` — union-based

### 4. Caché Redis con invalidación activa
La consulta de vacunación pendiente se cachea con TTL de 5 minutos. Al aplicar una vacuna nueva, el caché se invalida inmediatamente.

```
[CACHE MISS] vacunacion_pendiente — consultando BD  (187ms)
[CACHE HIT]  vacunacion_pendiente                   (4ms)
[CACHE INVALIDADO] vacunacion_pendiente — nueva vacuna aplicada
```

---

## Cómo ejecutar

### Requisitos
- Docker y Docker Compose
- Node.js 20+ (para el frontend)

### Backend + BD + Redis
```bash
git clone https://github.com/JORED666/corte3-bda-243842.git
cd corte3-bda-243842
docker compose up --build
```

Docker carga automáticamente el schema, datos de prueba, roles y políticas RLS.

### Frontend
```bash
cd frontend
npm install
npm run dev
# Abre http://localhost:5173
```

### Probar los roles
En el dropdown de la Pantalla 1 cambia el rol y consulta mascotas:

| Rol | Mascotas visibles |
|-----|-------------------|
| Dr. López | Firulais, Toby, Max |
| Dra. García | Misifú, Luna, Dante |
| Dr. Méndez | Rocky, Pelusa, Coco, Mango |
| Recepcionista | Todas (10) |
| Administrador | Todas (10) |

---

## Estructura del repositorio

```
corte3-bda-243842/
├── README.md
├── cuaderno_ataques.md          # 3 ataques + demo RLS + demo Redis
├── schema_corte3.sql
├── docker-compose.yml
├── backend/
│   ├── 01_procedures.sql        # sp_agendar_cita, fn_total_facturado
│   ├── 02_triggers.sql          # trg_historial_cita
│   ├── 03_views.sql             # v_mascotas_vacunacion_pendiente
│   ├── 04_roles_y_permisos.sql  # GRANT / REVOKE
│   └── 05_rls.sql               # Políticas RLS
├── api/
│   ├── index.js                 # Express + hardening + Redis
│   ├── package.json
│   └── Dockerfile
└── frontend/
    └── src/
        └── App.jsx              # Login, búsqueda de mascotas, vacunación
```

---

## Decisiones de diseño

### 1 Política RLS en `mascotas`

```sql
CREATE POLICY pol_mascotas_veterinario
ON mascotas FOR SELECT TO rol_veterinario
USING (
    id IN (
        SELECT mascota_id FROM vet_atiende_mascota
        WHERE vet_id = NULLIF(current_setting('app.vet_id', true), '')::INT
          AND activa = true
    )
);
```

Filtra las filas de `mascotas` para que el veterinario solo vea las asignadas a él en `vet_atiende_mascota`. `current_setting('app.vet_id', true)` lee el id que el backend inyectó en la sesión con `SET LOCAL app.vet_id = '1'`. El `NULLIF(..., '')` evita error cuando la variable no está seteada (caso admin/recepción).

### 2 Vector de ataque de la estrategia de identificación

Un cliente malicioso podría falsificar el header `x-rol` para obtener acceso de admin. En producción esto se previene con JWT firmados: el backend verifica la firma antes de determinar el rol, por lo que sin la clave secreta no se puede fabricar un token válido.

### 3 Por qué no se usó SECURITY DEFINER

Los roles tienen los permisos necesarios directamente sobre las tablas — no fue necesario elevar privilegios en ningún procedure. Esto elimina el vector de escalada por manipulación del `search_path` que SECURITY DEFINER introduce.

### 4 TTL de 5 minutos en Redis

La consulta tarda ~150-300ms. Con invalidación activa al aplicar vacunas, el riesgo de datos obsoletos es mínimo. TTL demasiado bajo (~10s) haría el caché inútil. TTL demasiado alto (~1h) mostraría mascotas vacunadas como pendientes durante mucho tiempo.

### 5 Línea exacta de hardening

**Archivo:** `api/index.js`, línea ~78:
```javascript
const result = await client.query(
    `SELECT ... FROM mascotas m JOIN duenos d ON d.id = m.dueno_id
     WHERE m.nombre ILIKE $1 ORDER BY m.nombre`,
    [`%${nombre}%`]  // ← input del usuario como parámetro, nunca concatenado
);
```
El driver `pg` envía query y valor como mensajes separados en el protocolo binario de PostgreSQL. El motor nunca interpreta el input como SQL.

### 6 — ¿Qué se rompe si se revocan todos los permisos del veterinario excepto SELECT en mascotas?

1. **Registrar citas** — `sp_agendar_cita` hace `INSERT INTO citas`, falla con "permission denied"
2. **Aplicar vacunas** — `POST /vacunas` hace `INSERT INTO vacunas_aplicadas`, mismo error
3. **Ejecutar el procedure** — `GRANT EXECUTE` también se revocaría, el veterinario ni puede llamarlo

---

## Alumno

**Edy Jordan González A** · Ingeniería en Software · Universidad Politécnica de Chiapas · Matrícula: 243842