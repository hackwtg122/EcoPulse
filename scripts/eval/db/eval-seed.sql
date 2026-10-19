-- Solo ecopulse_eval. Ejecutar con psql -X -v ON_ERROR_STOP=1
-- -v academic_admin_clerk_id=user_... -v academic_operator_clerk_id=user_...
-- Las dos identidades deben existir en Clerk y pertenecer a personas autorizadas.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'ecopulse_eval' OR to_regclass('public.delivery_points') IS NULL
    OR to_regclass('public.delivery_point_materials') IS NULL
    OR to_regclass('public.rewards') IS NULL THEN
    RAISE EXCEPTION 'Academic seed requires migrated ecopulse_eval';
  END IF;
END $$;

-- Los identificadores Clerk son parámetros, nunca credenciales ni usuarios inventados.
INSERT INTO users (clerk_user_id, role) VALUES
  (:'academic_admin_clerk_id', 'admin'),
  (:'academic_operator_clerk_id', 'verifier')
ON CONFLICT (clerk_user_id) DO NOTHING;
DO $$ BEGIN
  -- La comprobación de roles se realiza más abajo con los parámetros psql.
END $$;
SELECT 1 / CASE WHEN
 (SELECT role = 'admin' FROM users WHERE clerk_user_id = :'academic_admin_clerk_id')
 AND (SELECT role = 'verifier' FROM users WHERE clerk_user_id = :'academic_operator_clerk_id')
 AND :'academic_admin_clerk_id' <> :'academic_operator_clerk_id'
 AND :'academic_admin_clerk_id' ~ '^user_[A-Za-z0-9]+$'
 AND :'academic_operator_clerk_id' ~ '^user_[A-Za-z0-9]+$'
 THEN 1 ELSE 0 END AS valid_academic_roles;

INSERT INTO delivery_points
  (id, code, name, address, municipality, time_zone, appointment_required, active,
   validation_reference, validated_by, validated_at)
VALUES
  ('e1f00101-0001-4000-8000-000000000001', 'eval-01', 'Centro académico Villa Caribe', 'Sector Villa Caribe (ubicación ilustrativa)', 'Montería', 'America/Bogota', true, true, 'academic:ecopulse/centro-01', :'academic_admin_clerk_id', now()),
  ('e1f00101-0002-4000-8000-000000000002', 'eval-02', 'Centro académico Centro', 'Sector Centro (ubicación ilustrativa)', 'Montería', 'America/Bogota', true, true, 'academic:ecopulse/centro-02', :'academic_admin_clerk_id', now()),
  ('e1f00101-0003-4000-8000-000000000003', 'eval-03', 'Centro académico San Nicolás', 'Sector San Nicolás (ubicación ilustrativa)', 'Montería', 'America/Bogota', true, true, 'academic:ecopulse/centro-03', :'academic_admin_clerk_id', now()),
  ('e1f00101-0004-4000-8000-000000000004', 'eval-04', 'Centro académico Los Ángeles', 'Sector Los Ángeles (ubicación ilustrativa)', 'Montería', 'America/Bogota', true, true, 'academic:ecopulse/centro-04', :'academic_admin_clerk_id', now()),
  ('e1f00101-0005-4000-8000-000000000005', 'eval-05', 'Centro académico La Castellana', 'Sector La Castellana (ubicación ilustrativa)', 'Montería', 'America/Bogota', true, true, 'academic:ecopulse/centro-05', :'academic_admin_clerk_id', now()),
  ('e1f00101-0006-4000-8000-000000000006', 'eval-06', 'Centro académico Sevilla', 'Sector Sevilla (ubicación ilustrativa)', 'Montería', 'America/Bogota', true, true, 'academic:ecopulse/centro-06', :'academic_admin_clerk_id', now()),
  ('e1f00101-0007-4000-8000-000000000007', 'eval-07', 'Centro académico Barranquilla la Vieja', 'Sector Barranquilla la Vieja (ubicación ilustrativa)', 'Montería', 'America/Bogota', true, true, 'academic:ecopulse/centro-07', :'academic_admin_clerk_id', now()),
  ('e1f00101-0008-4000-8000-000000000008', 'eval-08', 'Centro académico Puerta de Oro', 'Sector Puerta de Oro (ubicación ilustrativa)', 'Montería', 'America/Bogota', true, true, 'academic:ecopulse/centro-08', :'academic_admin_clerk_id', now())
ON CONFLICT (id) DO NOTHING;

-- Accepted categories are per center, not inferred from an illustrative map.
INSERT INTO delivery_point_materials (delivery_point_id, category_code)
SELECT p.id, accepted.category_code FROM delivery_points p
JOIN (VALUES
  ('eval-01','plastic'), ('eval-01','metal'), ('eval-01','paper'),
  ('eval-02','glass'), ('eval-02','paper'),
  ('eval-03','plastic'), ('eval-03','organic'),
  ('eval-04','metal'), ('eval-04','glass'),
  ('eval-05','paper'),
  ('eval-06','plastic'), ('eval-06','metal'), ('eval-06','glass'),
  ('eval-07','organic'), ('eval-07','other'),
  ('eval-08','paper'), ('eval-08','plastic')
) AS accepted(point_code, category_code) ON accepted.point_code = p.code
ON CONFLICT (delivery_point_id, category_code) DO NOTHING;

-- Dos horarios futuros por centro, zona horaria Bogotá; ventana semanal estable.
-- En reejecución: no modifica reservas, horarios previos ni cupos ocupados.
WITH windows AS (
  SELECT p.id AS point_id, week_offset,
    (date_trunc('week', now() AT TIME ZONE 'America/Bogota')
      + week_offset * interval '7 days' + interval '9 hours') AT TIME ZONE 'America/Bogota' AS starts_at
  FROM delivery_points p CROSS JOIN (VALUES (2), (3)) AS weeks(week_offset)
  WHERE p.code IN ('eval-01','eval-02','eval-03','eval-04','eval-05','eval-06','eval-07','eval-08')
)
INSERT INTO delivery_slots
  (id, delivery_point_id, starts_at, ends_at, capacity, active, validation_reference, validated_by, validated_at)
SELECT gen_random_uuid(), point_id, starts_at, starts_at + interval '2 hours', 20, true,
  'academic:ecopulse/horario', :'academic_admin_clerk_id', now()
FROM windows
ON CONFLICT (delivery_point_id, starts_at, ends_at) DO NOTHING;

-- Recompensas ilustrativas: canje interno, sin patrocinadores, marcas ni entrega física prometida.
INSERT INTO rewards
  (id, title, description, cost, active, inventory_remaining, fulfillment_reference, validated_by, validated_at)
VALUES
  ('e1f00201-0001-4000-8000-000000000001', 'Kit digital de reciclaje', 'Guía descargable creada para el ejercicio académico; sin entrega comercial.', 20, true, 100, 'academic:ecopulse/recompensa-01', :'academic_admin_clerk_id', now()),
  ('e1f00201-0002-4000-8000-000000000002', 'Insignia Huella Verde', 'Reconocimiento virtual dentro de la simulación universitaria.', 40, true, 60, 'academic:ecopulse/recompensa-02', :'academic_admin_clerk_id', now()),
  ('e1f00201-0003-4000-8000-000000000003', 'Fondo virtual de naturaleza', 'Imagen digital de ejemplo, sin intercambio con terceros.', 80, true, 30, 'academic:ecopulse/recompensa-03', :'academic_admin_clerk_id', now())
ON CONFLICT (id) DO NOTHING;
COMMIT;
