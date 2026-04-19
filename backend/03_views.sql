-- =============================================================
-- 03_views.sql
-- Corte 3 · Base de Datos Avanzadas · UP Chiapas
-- =============================================================

CREATE OR REPLACE VIEW v_mascotas_vacunacion_pendiente AS
WITH ultima_vacuna AS (
    -- Calcula la fecha de la vacuna más reciente por mascota
    SELECT
        mascota_id,
        MAX(fecha_aplicacion) AS fecha_ultima_vacuna
    FROM vacunas_aplicadas
    GROUP BY mascota_id
)
SELECT
    m.id                                                AS mascota_id,
    m.nombre                                            AS nombre,
    m.especie                                           AS especie,
    d.nombre                                            AS nombre_dueno,
    d.telefono                                          AS telefono_dueno,
    uv.fecha_ultima_vacuna                              AS fecha_ultima_vacuna,
    CASE
        WHEN uv.fecha_ultima_vacuna IS NULL THEN NULL
        ELSE (CURRENT_DATE - uv.fecha_ultima_vacuna)
    END                                                 AS dias_desde_ultima_vacuna,
    CASE
        WHEN uv.fecha_ultima_vacuna IS NULL THEN 'NUNCA_VACUNADA'
        ELSE 'VENCIDA'
    END                                                 AS prioridad
FROM mascotas m
JOIN duenos d ON d.id = m.dueno_id
LEFT JOIN ultima_vacuna uv ON uv.mascota_id = m.id
WHERE uv.fecha_ultima_vacuna IS NULL
   OR (CURRENT_DATE - uv.fecha_ultima_vacuna) > 365;