-- Usuarios de prueba para la base local (uno por rol). NO se corre en Supabase.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'seba@prueba.local'),
  ('00000000-0000-0000-0000-000000000002', 'encargado@prueba.local'),
  ('00000000-0000-0000-0000-000000000003', 'juan@prueba.local'),
  ('00000000-0000-0000-0000-000000000004', 'parrilla@prueba.local'),
  ('00000000-0000-0000-0000-000000000005', 'barra@prueba.local');
insert into perfiles (id, nombre, email, rol) values
  ('00000000-0000-0000-0000-000000000001', 'Seba', 'seba@prueba.local', 'admin'),
  ('00000000-0000-0000-0000-000000000002', 'Lucía', 'encargado@prueba.local', 'encargado'),
  ('00000000-0000-0000-0000-000000000003', 'Juan', 'juan@prueba.local', 'mozo'),
  ('00000000-0000-0000-0000-000000000004', 'Parrilla', 'parrilla@prueba.local', 'cocina'),
  ('00000000-0000-0000-0000-000000000005', 'Barra', 'barra@prueba.local', 'barra');
