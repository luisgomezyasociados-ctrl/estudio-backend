async function listTeam() {
  const [teamRecords, emailRecords] = await Promise.all([
    base(T_TEAM).select({}).all(),
    base(T_EMAILS).select({}).all(),
  ]);

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

  return teamRecords.map((r) => {
    const f = r.fields;
    const name = pick(f, 'Name', 'Nombre');
    const c = counts[name] || { done: 0, pending: 0 };
    return {
      id: r.id,
      Name: name,
      Role: pick(f, 'Role', 'Rol'),
      Done: c.done,
      Pending: c.pending,
    };
  });
}
