-- =============================================================
-- 04_roles_y_permisos.sql
-- Corte 3 · Base de Datos Avanzadas · UP Chiapas
--
-- Tres roles basados en las reglas de negocio:
--   rol_veterinario  — ve solo sus mascotas (RLS lo filtra)
--   rol_recepcion    — ve mascotas y dueños, agenda citas, NO ve vacunas
--   rol_admin        — acceso total
-- =============================================================

-- Limpiar si ya existen (para poder reejecutar el archivo)
DROP ROLE IF EXISTS rol_veterinario;
DROP ROLE IF EXISTS rol_recepcion;
DROP ROLE IF EXISTS rol_admin;

-- =============================================================
-- ROL: rol_admin
-- Acceso total. Gestiona usuarios, inventario y asignaciones.
-- =============================================================
CREATE ROLE rol_admin;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO rol_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO rol_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO rol_admin;
GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA public TO rol_admin;

-- =============================================================
-- ROL: rol_recepcion
-- Ve mascotas y dueños. Agenda citas. NO ve información médica.
-- Mínimo privilegio: solo las tablas que necesita.
-- =============================================================
CREATE ROLE rol_recepcion;

-- Puede ver mascotas y dueños para agendar citas
GRANT SELECT ON mascotas TO rol_recepcion;
GRANT SELECT ON duenos   TO rol_recepcion;

-- Puede ver y crear citas
GRANT SELECT, INSERT ON citas TO rol_recepcion;
GRANT USAGE, SELECT ON SEQUENCE citas_id_seq TO rol_recepcion;

-- Puede ver veterinarios (para saber a quién agendar)
GRANT SELECT ON veterinarios TO rol_recepcion;

-- Puede ejecutar el procedure de agendar
GRANT EXECUTE ON PROCEDURE sp_agendar_cita(INT, INT, TIMESTAMP, TEXT, INT) TO rol_recepcion;

-- NO tiene acceso a información médica
-- (vacunas_aplicadas e inventario_vacunas quedan sin GRANT)

-- =============================================================
-- ROL: rol_veterinario
-- Ve solo SUS mascotas (RLS filtra). Registra citas y vacunas.
-- NO puede gestionar inventario ni ver datos de otros vets.
-- =============================================================
CREATE ROLE rol_veterinario;

-- Ve mascotas (RLS filtra cuáles)
GRANT SELECT ON mascotas TO rol_veterinario;

-- Ve y crea citas (RLS filtra cuáles ve)
GRANT SELECT, INSERT ON citas TO rol_veterinario;
GRANT USAGE, SELECT ON SEQUENCE citas_id_seq TO rol_veterinario;

-- Ve y registra vacunas aplicadas (RLS filtra cuáles ve)
GRANT SELECT, INSERT ON vacunas_aplicadas TO rol_veterinario;
GRANT USAGE, SELECT ON SEQUENCE vacunas_aplicadas_id_seq TO rol_veterinario;

-- Ve inventario para saber qué vacunas hay disponibles
GRANT SELECT ON inventario_vacunas TO rol_veterinario;

-- Ve dueños para datos de contacto
GRANT SELECT ON duenos TO rol_veterinario;

-- Ve su propia tabla de asignaciones
GRANT SELECT ON vet_atiende_mascota TO rol_veterinario;

-- Puede ejecutar el procedure de agendar
GRANT EXECUTE ON PROCEDURE sp_agendar_cita(INT, INT, TIMESTAMP, TEXT, INT) TO rol_veterinario;

-- NO puede ver historial de otros ni gestionar inventario

-- =============================================================
-- USUARIOS DE PRUEBA (para demostrar RLS en el cuaderno)
-- =============================================================
-- Limpiar si ya existen
DROP USER IF EXISTS vet_lopez;
DROP USER IF EXISTS vet_garcia;
DROP USER IF EXISTS vet_mendez;
DROP USER IF EXISTS recepcionista;
DROP USER IF EXISTS administrador;

CREATE USER vet_lopez    WITH PASSWORD 'lopez123';
CREATE USER vet_garcia   WITH PASSWORD 'garcia123';
CREATE USER vet_mendez   WITH PASSWORD 'mendez123';
CREATE USER recepcionista WITH PASSWORD 'recepcion123';
CREATE USER administrador WITH PASSWORD 'admin123';

GRANT rol_veterinario TO vet_lopez;
GRANT rol_veterinario TO vet_garcia;
GRANT rol_veterinario TO vet_mendez;
GRANT rol_recepcion   TO recepcionista;
GRANT rol_admin       TO administrador;
