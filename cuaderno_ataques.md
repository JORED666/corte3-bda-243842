# Cuaderno de Ataques
## Corte 3 · Base de Datos Avanzadas · UP Chiapas

---

## Sección 1: Tres ataques de SQL Injection que fallan

### Ataque 1 — Quote-escape clásico (`' OR '1'='1`)

**Input exacto probado:**
```
' OR '1'='1
```

**Pantalla:** Búsqueda de mascotas (campo de texto "Nombre de mascota").

**Resultado:** El sistema devuelve cero resultados. No hay error, no hay datos extras. El ataque falla silenciosamente.

**Por qué falló — línea exacta en `api/index.js`:**
```javascript
// Línea ~78 en api/index.js
const result = await client.query(
    `SELECT m.id, m.nombre, m.especie, m.fecha_nacimiento,
            d.nombre AS dueno, d.telefono
     FROM mascotas m
     JOIN duenos d ON d.id = m.dueno_id
     WHERE m.nombre ILIKE $1
     ORDER BY m.nombre`,
    [`%${nombre}%`]   // ← Esta línea. El driver pg escapa el input.
);
```

El driver `pg` de Node.js envía la query y el valor como mensajes separados al protocolo de PostgreSQL. El motor nunca interpreta el input como SQL — es tratado siempre como un string literal. El `' OR '1'='1` queda como el string `%' OR '1'='1%` buscando literalmente esas comillas en el nombre de la mascota.

---

### Ataque 2 — Stacked query (`'; DROP TABLE mascotas; --`)

**Input exacto probado:**
```
'; DROP TABLE mascotas; --
```

**Pantalla:** Búsqueda de mascotas (mismo campo).

**Resultado:** La tabla `mascotas` sigue existiendo después del ataque. La query devuelve cero resultados (ninguna mascota tiene ese string en el nombre).

**Por qué falló — misma línea en `api/index.js` (~78):**

El parámetro posicional `$1` no permite stacked queries. PostgreSQL con parámetros posicionales ejecuta exactamente una query por llamada a `client.query()`. El `;` en el valor de `$1` es literalmente el carácter punto y coma, no un separador de statements SQL.

---

### Ataque 3 — Union-based (`' UNION SELECT id, cedula, nombre, activo, dias_descanso FROM veterinarios --`)

**Input exacto probado:**
```
' UNION SELECT id, cedula, nombre, activo, dias_descanso FROM veterinarios --
```

**Pantalla:** Búsqueda de mascotas.

**Resultado:** Cero resultados. No se filtran datos de la tabla `veterinarios`.

**Por qué falló — misma línea en `api/index.js` (~78):**

Igual que los casos anteriores: el input completo es el valor de `$1`. PostgreSQL lo interpreta como el string literal que el usuario tecleó, no como fragmento SQL. El `UNION SELECT` nunca se ejecuta.

---

## Sección 2: Demostración de RLS en acción

### Setup

Los datos de prueba del schema ya incluyen las asignaciones:
- **Dr. López (vet_id=1):** atiende a Firulais, Toby, Max
- **Dra. García (vet_id=2):** atiende a Misifú, Luna, Dante
- **Dr. Méndez (vet_id=3):** atiende a Rocky, Pelusa, Coco, Mango

### Demostración

**Request como Dr. López** (`x-rol: vet_lopez`):
```
GET /mascotas HTTP/1.1
x-rol: vet_lopez
```
Resultado:
```json
[
  { "id": 1, "nombre": "Firulais", ... },
  { "id": 5, "nombre": "Toby", ... },
  { "id": 7, "nombre": "Max", ... }
]
```
Solo 3 mascotas — las suyas.

**Request como Dra. García** (`x-rol: vet_garcia`):
```
GET /mascotas HTTP/1.1
x-rol: vet_garcia
```
Resultado:
```json
[
  { "id": 2, "nombre": "Misifú", ... },
  { "id": 4, "nombre": "Luna", ... },
  { "id": 9, "nombre": "Dante", ... }
]
```
Otro conjunto distinto — las 3 suyas.

**Request como Admin** (`x-rol: admin`):
```json
[ 10 mascotas — todas ]
```

### Política RLS que produce este comportamiento

```sql
-- En 05_rls.sql
CREATE POLICY pol_mascotas_veterinario
ON mascotas
FOR SELECT
TO rol_veterinario
USING (
    id IN (
        SELECT mascota_id
        FROM vet_atiende_mascota
        WHERE vet_id = NULLIF(current_setting('app.vet_id', true), '')::INT
          AND activa = true
    )
);
```

La política filtra las filas de `mascotas` para que el veterinario solo vea aquellas cuyo `id` aparece en `vet_atiende_mascota` con su propio `vet_id`. El backend comunica ese `vet_id` a PostgreSQL con `SET LOCAL app.vet_id = '1'` al inicio de cada transacción.

---

## Sección 3: Demostración de caché Redis

### Configuración

- **Key:** `vacunacion_pendiente`
- **TTL:** 300 segundos (5 minutos)
- **Invalidación:** el endpoint `POST /vacunas` llama `redisClient.del('vacunacion_pendiente')` inmediatamente después de aplicar una vacuna.

**Justificación del TTL:** La consulta recorre todas las mascotas y vacunas (~100-300ms en BD). Se llama con frecuencia desde la pantalla de recepción. 5 minutos es aceptable porque cuando los datos cambian (nueva vacuna), el caché se invalida activamente en ese mismo request — no hay que esperar a que expire.

### Logs del sistema (ejemplo)

```
# Primera consulta — cache MISS
[CACHE MISS] vacunacion_pendiente — consultando BD
[BD] vacunacion_pendiente tardó 187ms

# Segunda consulta inmediata — cache HIT
[CACHE HIT] vacunacion_pendiente

# POST /vacunas — se aplica vacuna a Rocky
[CACHE INVALIDADO] vacunacion_pendiente — nueva vacuna aplicada

# Siguiente consulta — cache MISS de nuevo
[CACHE MISS] vacunacion_pendiente — consultando BD
[BD] vacunacion_pendiente tardó 203ms
```

### Secuencia de prueba para la defensa

1. Abrir la Pantalla 3 en el navegador
2. Hacer click en "Consultar" → ver latencia ~150-300ms en el navegador
3. Hacer click de nuevo → ver latencia ~5-20ms (Redis)
4. Desde otro tab o curl, hacer `POST /vacunas` con datos válidos
5. Volver a consultar → latencia alta de nuevo (cache MISS)