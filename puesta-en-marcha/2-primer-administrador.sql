-- =====================================================================
-- Primer dueño de la app
-- 1. En Supabase → Authentication → Users → "Add user" → "Create new user":
--    poné el mail y una contraseña, y tildá "Auto Confirm User".
-- 2. Cambiá el mail y el nombre de abajo y corré esto en el SQL Editor.
-- Los demás usuarios se invitan desde la app (Administración → Usuarios).
-- =====================================================================
insert into perfiles (id, nombre, email, rol)
select id, 'Seba', email, 'admin' from auth.users where email = 'CAMBIAR@mail.com'
on conflict (id) do update set rol = 'admin', activo = true;

select nombre, email, rol from perfiles;   -- tiene que aparecer una fila con rol admin
