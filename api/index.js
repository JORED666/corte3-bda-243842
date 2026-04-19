// api/index.js
// Backend Express para la clínica veterinaria
// Hardening: NUNCA se concatena input del usuario en queries SQL.
// Toda query usa parámetros posicionales ($1, $2, ...) de pg.

import express from 'express';
import cors from 'cors';
import pg from 'pg';
import redis from 'redis';

const { Pool } = pg;

const app = express();
app.use(cors());
app.use(express.json());

// =============================================================
// CONEXIÓN A POSTGRESQL
// =============================================================
const pool = new Pool({
    host:     process.env.PG_HOST     || 'localhost',
    port:     parseInt(process.env.PG_PORT || '5432'),
    database: process.env.PG_DB       || 'clinica_vet',
    user:     process.env.PG_USER     || 'administrador',
    password: process.env.PG_PASSWORD || 'admin123',
});

// =============================================================
// CONEXIÓN A REDIS
// =============================================================
const redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redisClient.on('error', (err) => console.error('[REDIS ERROR]', err));
await redisClient.connect();

// =============================================================
// HELPER: obtener cliente con rol y vet_id correctos
// El backend setea app.vet_id en cada transacción para que
// las políticas RLS sepan quién está consultando.
// =============================================================
async function getClientForUser(rol, vetId = null) {
    const client = await pool.connect();

    // Mapeamos el rol del frontend al usuario de PostgreSQL
    const userMap = {
        admin:       { user: 'administrador', password: 'admin123' },
        recepcion:   { user: 'recepcionista', password: 'recepcion123' },
        vet_lopez:   { user: 'vet_lopez',     password: 'lopez123',  vetId: 1 },
        vet_garcia:  { user: 'vet_garcia',    password: 'garcia123', vetId: 2 },
        vet_mendez:  { user: 'vet_mendez',    password: 'mendez123', vetId: 3 },
    };

    const creds = userMap[rol];
    if (!creds) throw new Error('Rol no reconocido');

    // SET ROLE cambia el rol activo en la sesión
    await client.query(`SET ROLE ${creds.user}`);

    // Si es veterinario, comunicamos su id a RLS via setting de sesión
    if (creds.vetId) {
        // SET LOCAL aplica solo a la transacción actual
        await client.query(`SET LOCAL app.vet_id = $1`, [String(creds.vetId)]);
    }

    return client;
}

// =============================================================
// MIDDLEWARE: extraer rol del header Authorization
// En producción esto sería un JWT. Aquí es un header simple
// para facilitar las pruebas de RLS en la defensa oral.
// =============================================================
function getRol(req) {
    return req.headers['x-rol'] || 'admin';
}

// =============================================================
// ENDPOINTS
// =============================================================

// GET /mascotas?nombre=xxx
// Búsqueda de mascotas — superficie principal para SQL injection.
// HARDENING: el input del usuario va en $1, nunca concatenado.
// Línea crítica: pool.query('... WHERE m.nombre ILIKE $1', [`%${nombre}%`])
app.get('/mascotas', async (req, res) => {
    const rol = getRol(req);
    const nombre = req.query.nombre || '';  // input del usuario

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const creds = getRolCreds(rol);
        await client.query(`SET ROLE ${creds.dbUser}`);
        if (creds.vetId) {
            await client.query(`SET LOCAL app.vet_id = '${creds.vetId}'`);
        }

        // HARDENING: nombre va como parámetro $1, no concatenado.
        // Esto previene ataques tipo ' OR '1'='1 y stacked queries.
        const result = await client.query(
            `SELECT m.id, m.nombre, m.especie, m.fecha_nacimiento,
                    d.nombre AS dueno, d.telefono
             FROM mascotas m
             JOIN duenos d ON d.id = m.dueno_id
             WHERE m.nombre ILIKE $1
             ORDER BY m.nombre`,
            [`%${nombre}%`]  // $1: el driver escapa esto, nunca es SQL
        );

        await client.query('COMMIT');
        res.json(result.rows);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[ERROR /mascotas]', err.message);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// GET /vacunacion-pendiente
// Consulta cara — se cachea en Redis con TTL de 5 minutos.
// Justificación del TTL: la consulta recorre todas las mascotas
// y vacunas (~100ms en BD). Se llama unas 20 veces por hora.
// 5 minutos es aceptable porque si se vacuna a una mascota,
// el endpoint POST /vacunas invalida el caché inmediatamente.
const CACHE_KEY_VACUNACION = 'vacunacion_pendiente';
const CACHE_TTL_SECONDS    = 300; // 5 minutos

app.get('/vacunacion-pendiente', async (req, res) => {
    // Intentar cache hit primero
    const cached = await redisClient.get(CACHE_KEY_VACUNACION);
    if (cached) {
        console.log(`[CACHE HIT] ${CACHE_KEY_VACUNACION}`);
        return res.json(JSON.parse(cached));
    }

    console.log(`[CACHE MISS] ${CACHE_KEY_VACUNACION} — consultando BD`);
    const start = Date.now();

    try {
        const result = await pool.query(
            'SELECT * FROM v_mascotas_vacunacion_pendiente ORDER BY prioridad, dias_desde_ultima_vacuna NULLS FIRST'
        );
        const latencia = Date.now() - start;
        console.log(`[BD] vacunacion_pendiente tardó ${latencia}ms`);

        // Guardar en Redis con TTL
        await redisClient.setEx(
            CACHE_KEY_VACUNACION,
            CACHE_TTL_SECONDS,
            JSON.stringify(result.rows)
        );

        res.json(result.rows);
    } catch (err) {
        console.error('[ERROR /vacunacion-pendiente]', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /vacunas
// Aplica una vacuna. Invalida el caché de vacunación pendiente.
app.post('/vacunas', async (req, res) => {
    const rol = getRol(req);
    // Inputs del usuario — van como parámetros, nunca concatenados
    const { mascota_id, vacuna_id, veterinario_id, costo_cobrado } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const creds = getRolCreds(rol);
        await client.query(`SET ROLE ${creds.dbUser}`);
        if (creds.vetId) {
            await client.query(`SET LOCAL app.vet_id = '${creds.vetId}'`);
        }

        // HARDENING: todos los valores van como parámetros posicionales
        await client.query(
            `INSERT INTO vacunas_aplicadas
                (mascota_id, vacuna_id, veterinario_id, fecha_aplicacion, costo_cobrado)
             VALUES ($1, $2, $3, CURRENT_DATE, $4)`,
            [mascota_id, vacuna_id, veterinario_id, costo_cobrado]
        );

        await client.query('COMMIT');

        // Invalidar caché — los datos de vacunación cambiaron
        await redisClient.del(CACHE_KEY_VACUNACION);
        console.log(`[CACHE INVALIDADO] ${CACHE_KEY_VACUNACION} — nueva vacuna aplicada`);

        res.json({ ok: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[ERROR /vacunas]', err.message);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// POST /citas
// Agenda una cita usando el procedure sp_agendar_cita.
// HARDENING: los parámetros van como $1..$4, nunca concatenados.
app.post('/citas', async (req, res) => {
    const rol = getRol(req);
    const { mascota_id, veterinario_id, fecha_hora, motivo } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const creds = getRolCreds(rol);
        await client.query(`SET ROLE ${creds.dbUser}`);
        if (creds.vetId) {
            await client.query(`SET LOCAL app.vet_id = '${creds.vetId}'`);
        }

        // Llama al procedure con parámetros posicionales
        const result = await client.query(
            'CALL sp_agendar_cita($1, $2, $3, $4, NULL)',
            [mascota_id, veterinario_id, fecha_hora, motivo]
        );

        await client.query('COMMIT');
        res.json({ ok: true, cita_id: result.rows[0]?.p_cita_id });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[ERROR /citas]', err.message);
        res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});

// GET /veterinarios — para el dropdown del frontend
app.get('/veterinarios', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, nombre FROM veterinarios WHERE activo = true ORDER BY nombre'
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /inventario-vacunas — para el dropdown de vacunas
app.get('/inventario-vacunas', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, nombre, stock_actual, costo_unitario FROM inventario_vacunas ORDER BY nombre'
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================
// HELPER: mapeo de rol frontend → credenciales de BD
// =============================================================
function getRolCreds(rol) {
    const map = {
        admin:      { dbUser: 'administrador', vetId: null },
        recepcion:  { dbUser: 'recepcionista', vetId: null },
        vet_lopez:  { dbUser: 'vet_lopez',     vetId: 1 },
        vet_garcia: { dbUser: 'vet_garcia',    vetId: 2 },
        vet_mendez: { dbUser: 'vet_mendez',    vetId: 3 },
    };
    const creds = map[rol];
    if (!creds) throw new Error(`Rol desconocido: ${rol}`);
    return creds;
}

// =============================================================
// INICIO DEL SERVIDOR
// =============================================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`[API] Servidor corriendo en http://localhost:${PORT}`);
});