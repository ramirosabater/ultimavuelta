-- =====================================================================
-- Última Vuelta · Anular una compra mal cargada
--   Saca del stock lo que había sumado, vuelve el costo del artículo al de la compra anterior
--   (si nadie lo cambió después) y borra el gasto que había dejado.
--
--   Si la base ya está andando, este archivo se pega solo en el SQL Editor (una vez).
-- =====================================================================

create or replace function anular_compra(p_compra bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m record; v_prev numeric; v_n int := 0; v_total numeric;
begin
  perform exigir(es_gestion(), 'Solo dueños y encargados anulan compras.');
  select total into v_total from compras where id = p_compra for update;
  perform exigir(found, 'No encontramos esa compra.');
  for m in select ms.id, ms.insumo_id, ms.cantidad, ms.costo_unit, ms.hora, i.costo
           from movimientos_stock ms join insumos i on i.id = ms.insumo_id
           where ms.compra_id = p_compra and ms.tipo = 'compra' for update of i loop
    -- El costo que tenía antes de esta compra (la compra anterior de ese artículo)
    select costo_unit into v_prev from movimientos_stock
     where insumo_id = m.insumo_id and tipo = 'compra' and costo_unit > 0 and id <> m.id
       and (compra_id is distinct from p_compra) and (hora, id) < (m.hora, m.id)
     order by hora desc, id desc limit 1;
    update insumos set cantidad = cantidad - m.cantidad,
                       costo = case when v_prev is not null and costo = m.costo_unit then v_prev else costo end
     where id = m.insumo_id;
    v_n := v_n + 1;
  end loop;
  delete from movimientos_stock where compra_id = p_compra;
  delete from gastos where compra_id = p_compra and origen = 'compra';
  delete from compras where id = p_compra;
  return jsonb_build_object('articulos', v_n, 'total', v_total);
end $$;

revoke execute on function anular_compra(bigint) from public, anon;
grant execute on function anular_compra(bigint) to authenticated, service_role;
