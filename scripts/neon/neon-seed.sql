-- SOLO neondb, DESPUÉS de las migraciones Drizzle 0000-0003 y de
-- neon-academic-materials.sql / neon-academic-favorites.sql.
-- PROPUESTA NO EJECUTADA. Solo fixtures academicos INACTIVOS; nunca crea roles.
-- Requiere autorizacion especifica y respaldo restaurable comprobado antes de ejecutar.
-- psql -X -v ON_ERROR_STOP=1 -v authorize_academic_seed=true -v seed_week=YYYY-MM-DD
-- seed_week debe ser un lunes explicito; repetir la MISMA fecha es idempotente.
\if :{?authorize_academic_seed}
  \if :authorize_academic_seed
  \else
    \echo 'Academic seed is not authorized; no SQL executed.'
    \quit 3
  \endif
\else
  \echo 'Explicit authorize_academic_seed is required; no SQL executed.'
  \quit 3
\endif
\if :{?seed_week}
\else
  \echo 'Explicit seed_week is required; no SQL executed.'
  \quit 3
\endif
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT set_config('ecopulse.seed_week', :'seed_week', true);
DO $$ BEGIN
  IF current_database() <> 'neondb' THEN
    RAISE EXCEPTION 'Seed requires neondb';
  END IF;
  IF to_regclass('public.delivery_points') IS NULL
    OR to_regclass('public.delivery_point_materials') IS NULL
    OR to_regclass('public.rewards') IS NULL THEN
    RAISE EXCEPTION 'Seed requires migrated schema including academic tables';
  END IF;
  IF current_setting('ecopulse.seed_week') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR extract(isodow FROM current_setting('ecopulse.seed_week')::date) <> 1 THEN
    RAISE EXCEPTION 'seed_week must be an explicit ISO Monday';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.delivery_points p
    JOIN (VALUES
      ('e1f00101-0001-4000-8000-000000000001'::uuid,'eval-01'),
      ('e1f00101-0002-4000-8000-000000000002'::uuid,'eval-02'),
      ('e1f00101-0003-4000-8000-000000000003'::uuid,'eval-03'),
      ('e1f00101-0004-4000-8000-000000000004'::uuid,'eval-04'),
      ('e1f00101-0005-4000-8000-000000000005'::uuid,'eval-05'),
      ('e1f00101-0006-4000-8000-000000000006'::uuid,'eval-06'),
      ('e1f00101-0007-4000-8000-000000000007'::uuid,'eval-07'),
      ('e1f00101-0008-4000-8000-000000000008'::uuid,'eval-08')
    ) AS fixture(id,code) ON p.id=fixture.id OR p.code=fixture.code
    WHERE p.id<>fixture.id OR p.code<>fixture.code OR p.name NOT LIKE 'Centro académico%'
  ) THEN
    RAISE EXCEPTION 'Seed identifiers belong to a different or repurposed center';
  END IF;
END $$;

-- No bootstrap de administradores ni IDs Clerk. Los registros existentes,
-- incluso sus estados activos y validaciones, se conservan sin UPDATE.

INSERT INTO public.delivery_points
  (id, code, name, address, municipality, time_zone, appointment_required, active)
VALUES
  ('e1f00101-0001-4000-8000-000000000001', 'eval-01', 'Centro académico Villa Caribe', 'Sector Villa Caribe (ubicación ilustrativa)', 'Montería', 'America/Bogota', true, false),
  ('e1f00101-0002-4000-8000-000000000002', 'eval-02', 'Centro académico Centro', 'Sector Centro (ubicación ilustrativa)', 'Montería', 'America/Bogota', true, false),
  ('e1f00101-0003-4000-8000-000000000003', 'eval-03', 'Centro académico San Nicolás', 'Sector San Nicolás (ubicación ilustrativa)', 'Montería', 'America/Bogota', true, false),
  ('e1f00101-0004-4000-8000-000000000004', 'eval-04', 'Centro académico Los Ángeles', 'Sector Los Ángeles (ubicación ilustrativa)', 'Montería', 'America/Bogota', true, false),
  ('e1f00101-0005-4000-8000-000000000005', 'eval-05', 'Centro académico La Castellana', 'Sector La Castellana (ubicación ilustrativa)', 'Montería', 'America/Bogota', true, false),
  ('e1f00101-0006-4000-8000-000000000006', 'eval-06', 'Centro académico Sevilla', 'Sector Sevilla (ubicación ilustrativa)', 'Montería', 'America/Bogota', true, false),
  ('e1f00101-0007-4000-8000-000000000007', 'eval-07', 'Centro académico Barranquilla la Vieja', 'Sector Barranquilla la Vieja (ubicación ilustrativa)', 'Montería', 'America/Bogota', true, false),
  ('e1f00101-0008-4000-8000-000000000008', 'eval-08', 'Centro académico Puerta de Oro', 'Sector Puerta de Oro (ubicación ilustrativa)', 'Montería', 'America/Bogota', true, false)
ON CONFLICT (id) DO NOTHING;

-- Accepted categories are per center, not inferred from an illustrative map.
INSERT INTO public.delivery_point_materials (delivery_point_id, category_code)
SELECT p.id, accepted.category_code FROM public.delivery_points p
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

-- Mismos locks que el trigger: una consulta nueva DESPUES del lock ve las filas
-- de otra ejecucion que acaba de terminar. Nunca confiar en ON CONFLICT para
-- evitar el trigger BEFORE INSERT de solapamiento.
SELECT pg_advisory_xact_lock(hashtextextended(id::text, 0))
FROM public.delivery_points WHERE code IN ('eval-01','eval-02','eval-03','eval-04','eval-05','eval-06','eval-07','eval-08') ORDER BY id;
-- Dos borradores de horario por centro, anclados a fecha explicita y sin activar.
WITH windows AS (
  SELECT p.id AS point_id, week_offset,
    (current_setting('ecopulse.seed_week')::date
      + week_offset * interval '7 days' + interval '9 hours') AT TIME ZONE 'America/Bogota' AS starts_at
  FROM public.delivery_points p CROSS JOIN (VALUES (2), (3)) AS weeks(week_offset)
  WHERE p.code IN ('eval-01','eval-02','eval-03','eval-04','eval-05','eval-06','eval-07','eval-08') AND p.appointment_required=true
)
INSERT INTO public.delivery_slots
  (id, delivery_point_id, starts_at, ends_at, capacity, active)
SELECT gen_random_uuid(), point_id, starts_at, starts_at + interval '2 hours', 20, false
FROM windows w
WHERE NOT EXISTS (SELECT 1 FROM public.delivery_slots s WHERE s.delivery_point_id=w.point_id
  AND s.starts_at < w.starts_at + interval '2 hours' AND s.ends_at > w.starts_at)
ON CONFLICT (delivery_point_id, starts_at, ends_at) DO NOTHING;

-- Recompensas ilustrativas INACTIVAS: sin inventario, publicacion ni canje.
INSERT INTO public.rewards
  (id, title, description, cost, active)
VALUES
  ('e1f00201-0001-4000-8000-000000000001', 'Kit digital de reciclaje', 'Guía descargable creada para el ejercicio académico; sin entrega comercial.', 20, false),
  ('e1f00201-0002-4000-8000-000000000002', 'Insignia Huella Verde', 'Reconocimiento virtual dentro de la simulación universitaria.', 40, false),
  ('e1f00201-0003-4000-8000-000000000003', 'Fondo virtual de naturaleza', 'Imagen digital de ejemplo, sin intercambio con terceros.', 80, false)
ON CONFLICT (id) DO NOTHING;
COMMIT;
