-- Authorized one-time promotion of eight existing EcoPulse sectors to
-- managed zones that accept PENDING DIGITAL REQUESTS, not confirmed physical drop-offs.
-- The exact handoff location remains undisclosed until administration coordinates it.
-- All existing primary keys, material associations and prior histories are preserved.
-- Run only after a Neon point-in-time branch backup; intended for production once.
BEGIN;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.delivery_points WHERE code IN
      ('eval-01','eval-02','eval-03','eval-04','eval-05','eval-06','eval-07','eval-08')
      AND active AND validation_reference LIKE 'academic:%') <> 8 THEN
    RAISE EXCEPTION 'Expected exactly 8 untouched legacy active sectors; refusing migration';
  END IF;
  IF (SELECT count(*) FROM public.users WHERE role='admin') <> 1 THEN
    RAISE EXCEPTION 'Expected one authorized administrator; refusing migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.deliveries d JOIN public.delivery_points p ON p.id=d.delivery_point_id
    WHERE p.code IN ('eval-01','eval-02','eval-03','eval-04','eval-05','eval-06','eval-07','eval-08')
    AND d.status NOT IN ('cancelled','rejected')
  ) THEN RAISE EXCEPTION 'Existing noncancelled deliveries must be resolved first'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.delivery_points p
    WHERE p.code IN ('eval-01','eval-02','eval-03','eval-04','eval-05','eval-06','eval-07','eval-08')
    AND NOT EXISTS (SELECT 1 FROM public.delivery_point_materials m
      JOIN public.material_categories c ON c.code=m.category_code
      WHERE m.delivery_point_id=p.id AND c.active)
  ) THEN RAISE EXCEPTION 'Cannot promote a sector without recorded active materials'; END IF;
END $$;

-- Legacy appointments were placeholders, not confirmed physical slots.
UPDATE public.delivery_slots SET active=false
WHERE active AND delivery_point_id IN (
  SELECT id FROM public.delivery_points WHERE code IN
  ('eval-01','eval-02','eval-03','eval-04','eval-05','eval-06','eval-07','eval-08')
);

-- Existing triggers require deactivation before replacing the public names/address.
UPDATE public.delivery_points SET active=false
WHERE active AND code IN
('eval-01','eval-02','eval-03','eval-04','eval-05','eval-06','eval-07','eval-08');

-- An administrator declares managed REQUEST zones, not a verified facility address.
-- appointment_required=false means "no appointment booked"; each request is PENDING
-- until a human operator actually receives and verifies material.
UPDATE public.delivery_points p
SET name = v.name,
    address = v.address,
    appointment_required = false,
    validation_reference = 'admin-declaration:v1',
    validated_by = (SELECT clerk_user_id FROM public.users WHERE role='admin' LIMIT 1),
    validated_at = now(),
    active = true
FROM (VALUES
  ('eval-01','Zona EcoPulse Villa Caribe','Sector Villa Caribe, Montería — punto de entrega por coordinar'),
  ('eval-02','Zona EcoPulse Centro','Sector Centro, Montería — punto de entrega por coordinar'),
  ('eval-03','Zona EcoPulse San Nicolás','Sector San Nicolás, Montería — punto de entrega por coordinar'),
  ('eval-04','Zona EcoPulse Los Ángeles','Sector Los Ángeles, Montería — punto de entrega por coordinar'),
  ('eval-05','Zona EcoPulse La Castellana','Sector La Castellana, Montería — punto de entrega por coordinar'),
  ('eval-06','Zona EcoPulse Sevilla','Sector Sevilla, Montería — punto de entrega por coordinar'),
  ('eval-07','Zona EcoPulse Barranquilla la Vieja','Sector Barranquilla la Vieja, Montería — punto de entrega por coordinar'),
  ('eval-08','Zona EcoPulse Puerta de Oro','Sector Puerta de Oro, Montería — punto de entrega por coordinar')
) AS v(code, name, address)
WHERE p.code=v.code;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.delivery_points p WHERE
     p.code IN ('eval-01','eval-02','eval-03','eval-04','eval-05','eval-06','eval-07','eval-08')
     AND p.active AND NOT p.appointment_required
     AND p.validation_reference='admin-declaration:v1'
     AND p.validated_by IS NOT NULL AND p.validated_at IS NOT NULL) <> 8
  THEN RAISE EXCEPTION 'Unexpected promoted zone state'; END IF;
END $$;
COMMIT;
