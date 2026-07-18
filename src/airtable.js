async function listTeam() {
  const [teamRecords, emailRecords, clientRecords] = await Promise.all([
    base(T_TEAM).select({}).all(),
    base(T_EMAILS).select({}).all(),
    base(T_CLIENTS).select({}).all(),
  ]);

  const roleByName = {};
  teamRecords.forEach((r) => {
    const f = r.fields;
    const name = pick(f, 'Name', 'Nombre');
    if (name) roleByName[name] = pick(f, 'Role', 'Rol');
  });

  const counts = {};
  emailRecords.forEach((r) => {
    const colaborador = (r.fields['Colaborador'] || '').toString().trim();
    if (!colaborador) return;
    if (!counts[colaborador]) counts[colaborador] = { done: 0, pending: 0 };
    if ((r.fields['Status'] || '').toString().trim() === 'Pendiente') {
      counts[colaborador].pending += 1;
    } else {
      counts[colaborador].done += 1;
    }
  });

  const nombres = new Set();
  clientRecords.forEach((r) => {
    const nombre = pick(r.fields, 'Colaborador', 'Categoría', 'Categoria', 'Category');
    if (nombre) nombres.add(nombre);
  });

  return Array.from(nombres).map((name) => {
    const c = counts[name] || { done: 0, pending: 0 };
    return {
      id: name,
      Name: name,
      Role: roleByName[name] || '',
      Done: c.done,
      Pending: c.pending,
    };
  });
}
