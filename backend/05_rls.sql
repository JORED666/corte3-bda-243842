-- =============================================================
-- 05_rls.sql
-- Corte 3 · Base de Datos Avanzadas · UP Chiapas
--
-- Row-Level Security sobre tres tablas:
--   mascotas, citas, vacunas_aplicadas
--
-- Estrategia de identificación:
--   Usamos current_setting('app.vet_id', true) para que el
--   backend comunique a PostgreSQL el id del veterinario que
--   está haciendo la consulta. El backend ejecuta:
--     SET LOCAL app.vet_id = '2';
--   al inicio de cada transacción antes de cualquier query.
--
--   'true' en current_setting significa "devuelve NULL si la
--   variable no existe" en vez de lanzar excepción — importante
--   para que admin y recepción (que no setean app.vet_id)
--   no rompan las políticas.
-- =============================================================

-- =============================================================
-- TABLA: mascotas
-- Veterinario: solo ve sus mascotas (via vet_atiende_mascota)
-- Recepción y admin: ven todo
-- =============================================================
ALTER TABLE mascotas ENABLE ROW LEVEL SECURITY;

-- Política para veterinarios: filtra por vet_atiende_mascota
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

-- Política para recepción: ve todas las mascotas
CREATE POLICY pol_mascotas_recepcion
ON mascotas
FOR SELECT
TO rol_recepcion
USING (true);

-- Política para admin: ve todo, puede hacer todo
CREATE POLICY pol_mascotas_admin
ON mascotas
FOR ALL
TO rol_admin
USING (true)
WITH CHECK (true);

-- =============================================================
-- TABLA: citas
-- Veterinario: solo ve citas donde él es el veterinario
-- Recepción: ve todas
-- Admin: ve todo
-- =============================================================
ALTER TABLE citas ENABLE ROW LEVEL SECURITY;

-- Política para veterinarios
CREATE POLICY pol_citas_veterinario
ON citas
FOR ALL
TO rol_veterinario
USING (
    veterinario_id = NULLIF(current_setting('app.vet_id', true), '')::INT
)
WITH CHECK (
    veterinario_id = NULLIF(current_setting('app.vet_id', true), '')::INT
);

-- Política para recepción: ve y crea todas las citas
CREATE POLICY pol_citas_recepcion
ON citas
FOR ALL
TO rol_recepcion
USING (true)
WITH CHECK (true);

-- Política para admin
CREATE POLICY pol_citas_admin
ON citas
FOR ALL
TO rol_admin
USING (true)
WITH CHECK (true);

-- =============================================================
-- TABLA: vacunas_aplicadas
-- Veterinario: solo ve vacunas de SUS mascotas
-- Recepción: NO tiene GRANT sobre esta tabla (controlado en 04)
-- Admin: ve todo
-- =============================================================
ALTER TABLE vacunas_aplicadas ENABLE ROW LEVEL SECURITY;

-- Política para veterinarios
CREATE POLICY pol_vacunas_veterinario
ON vacunas_aplicadas
FOR ALL
TO rol_veterinario
USING (
    mascota_id IN (
        SELECT mascota_id
        FROM vet_atiende_mascota
        WHERE vet_id = NULLIF(current_setting('app.vet_id', true), '')::INT
          AND activa = true
    )
)
WITH CHECK (
    mascota_id IN (
        SELECT mascota_id
        FROM vet_atiende_mascota
        WHERE vet_id = NULLIF(current_setting('app.vet_id', true), '')::INT
          AND activa = true
    )
);

-- Política para admin
CREATE POLICY pol_vacunas_admin
ON vacunas_aplicadas
FOR ALL
TO rol_admin
USING (true)
WITH CHECK (true);