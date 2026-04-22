-- STORED PROCEDURE: sp_agendar_cita

CREATE OR REPLACE PROCEDURE sp_agendar_cita(
    p_mascota_id     INT,
    p_veterinario_id INT,
    p_fecha_hora     TIMESTAMP,
    p_motivo         TEXT,
    OUT p_cita_id    INT
)
LANGUAGE plpgsql AS $$
DECLARE
    v_mascota_existe  BOOLEAN;
    v_vet_activo      BOOLEAN;
    v_dias_descanso   VARCHAR(50);
    v_dia_semana      TEXT;
    v_colision        INT;
BEGIN
    -- Validación 1: ¿existe la mascota?
    SELECT TRUE INTO v_mascota_existe
    FROM mascotas WHERE id = p_mascota_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La mascota con id % no existe.', p_mascota_id;
    END IF;

    -- Validación 2: ¿existe el veterinario y está activo?
    -- FOR UPDATE: bloquea la fila para evitar colisiones concurrentes
    SELECT activo, dias_descanso
    INTO v_vet_activo, v_dias_descanso
    FROM veterinarios
    WHERE id = p_veterinario_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El veterinario con id % no existe.', p_veterinario_id;
    END IF;

    IF v_vet_activo IS NOT TRUE THEN
        RAISE EXCEPTION 'El veterinario con id % no está activo.', p_veterinario_id;
    END IF;

    -- Validación 3: ¿es día de descanso?
    v_dia_semana := TRIM(TO_CHAR(p_fecha_hora, 'day'));

    IF v_dias_descanso <> '' AND
       v_dia_semana = ANY(string_to_array(v_dias_descanso, ','))
    THEN
        RAISE EXCEPTION 'El veterinario no trabaja los %. Elige otra fecha.', v_dia_semana;
    END IF;

    -- Validación 4: colisión de horario
    SELECT id INTO v_colision
    FROM citas
    WHERE veterinario_id = p_veterinario_id
      AND fecha_hora     = p_fecha_hora
      AND estado         = 'AGENDADA';

    IF FOUND THEN
        RAISE EXCEPTION 'El veterinario ya tiene una cita agendada para esa fecha y hora.';
    END IF;

    -- Insertar la cita
    INSERT INTO citas (mascota_id, veterinario_id, fecha_hora, motivo, estado)
    VALUES (p_mascota_id, p_veterinario_id, p_fecha_hora, p_motivo, 'AGENDADA')
    RETURNING id INTO p_cita_id;

EXCEPTION
    WHEN OTHERS THEN
        RAISE; -- Propaga sin ROLLBACK explícito
END;
$$;

CREATE OR REPLACE FUNCTION fn_total_facturado(
    p_mascota_id INT,
    p_anio       INT
) RETURNS NUMERIC
LANGUAGE plpgsql AS $$
DECLARE
    v_total_citas   NUMERIC;
    v_total_vacunas NUMERIC;
BEGIN
    SELECT COALESCE(SUM(costo), 0)
    INTO v_total_citas
    FROM citas
    WHERE mascota_id = p_mascota_id
      AND estado     = 'COMPLETADA'
      AND EXTRACT(YEAR FROM fecha_hora) = p_anio;

    SELECT COALESCE(SUM(costo_cobrado), 0)
    INTO v_total_vacunas
    FROM vacunas_aplicadas
    WHERE mascota_id = p_mascota_id
      AND EXTRACT(YEAR FROM fecha_aplicacion) = p_anio;

    RETURN v_total_citas + v_total_vacunas;
END;
$$;