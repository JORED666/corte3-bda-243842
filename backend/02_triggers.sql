CREATE OR REPLACE FUNCTION fn_historial_cita()
RETURNS TRIGGER AS $$
DECLARE
    v_nombre_mascota     VARCHAR(50);
    v_nombre_veterinario VARCHAR(100);
BEGIN
    SELECT nombre INTO v_nombre_mascota
    FROM mascotas WHERE id = NEW.mascota_id;

    SELECT nombre INTO v_nombre_veterinario
    FROM veterinarios WHERE id = NEW.veterinario_id;

    INSERT INTO historial_movimientos (tipo, referencia_id, descripcion)
    VALUES (
        'CITA_AGENDADA',
        NEW.id,
        'Cita para ' || v_nombre_mascota ||
        ' con ' || v_nombre_veterinario ||
        ' el ' || TO_CHAR(NEW.fecha_hora, 'DD/MM/YYYY')
    );

    RETURN NULL; 
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_historial_cita ON citas;

CREATE TRIGGER trg_historial_cita
AFTER INSERT ON citas
FOR EACH ROW
EXECUTE FUNCTION fn_historial_cita();