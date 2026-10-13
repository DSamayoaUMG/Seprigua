/* In-memory HTTP contracts. No SQL connection or production data. */
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guatemala',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function backend(){
 const state={calls:[],vacations:[],cancellations:[],quotes:[],agendaTarget:12,agendaMinute:540,conflict:false};
 const staff=[{id:12,nombre:'Empleado Supervisor',puesto:'Supervisor',categoria:'SUPERVISOR',estado:'ACTIVO',disponibilidad:'DISPONIBLE',codigo:'EMP-12'},{id:13,nombre:'Empleado Operario',puesto:'Operario',categoria:'OPERARIO',estado:'ACTIVO',disponibilidad:'DISPONIBLE',codigo:'EMP-13'}];
 const order=id=>({id,numero:'OT-'+String(id).padStart(3,'0'),cliente:'Cliente de prueba',tipo:'Drenajes',servicio:'Drenajes',estado:'PROGRAMADA',estado_codigo:'PROGRAMADA',sede:'Sede Central',prioridad:'MEDIA',programada:today()+'T15:00:00Z',creado:today()+'T12:00:00Z',clasificacion:'PROGRAMADO',tecnicos:1});
 const list=(items,u,extra={})=>{const size=Number(u.searchParams.get('tamano')||10),page=Number(u.searchParams.get('pagina')||1);return {ok:true,items:items.slice((page-1)*size,page*size),total:items.length,pagina:page,paginas:Math.max(1,Math.ceil(items.length/size)),tamano:size,...extra};};
 const quoteDetail=()=>({ok:true,item:{id:7,numero_cotizacion:'COT-7',numero_orden:'OT-001',cliente:'Cliente de prueba',cotizacion_estado:'BORRADOR',numero_version:1,orden_id:1},lineas:state.quotes[0]?.lineas.map(l=>({...l,precio_unitario:l.precio,total_linea:Number(l.precio)*Number(l.cantidad)}))||[],versiones:[{version:1,estado:'BORRADOR',total:100}]});
 function handle(url,method='GET',body={},profile='COORDINADOR'){
  const u=new URL(url,'http://test.local'),p=u.pathname,role=['SUPERVISOR','OPERARIO'].includes(profile)?'TECNICO':profile;state.calls.push({p,method,body,query:u.search,role});
  if(p==='/api/auth/me')return {ok:true,user:{usuario_id:role==='CLIENTE'?10:4,rol:role,rol_nombre:profile,modulos:role==='CLIENTE'?['dashboard','solicitudes','sedes','ordenes','cotizaciones','documentos','garantia','notificaciones','cuenta']:['dashboard','ordenes','agenda','equipo_mantenimiento','vacaciones','documentos','notificaciones','cuenta'],nombre:'Usuario de prueba',empleado_id:role==='CLIENTE'?null:12,cliente_id:role==='CLIENTE'?10:null}};
  if(p==='/api/catalogos')return {ok:true,tipos_servicio:[{id:1,nombre:'Drenajes'}],clientes:[{id:10,nombre:'Cliente de prueba'}],tecnicos:staff,equipos:[{id:1,nombre:'Bomba',codigo:'E-1',estado:'DISPONIBLE'}],estados_orden:[{id:1,codigo:'PROGRAMADA',nombre:'Programada',es_final:false}],puestos:[{id:1,nombre:'Supervisor'}]};
  if(p==='/api/db/health')return {ok:true,system_migration:true};
  if(p==='/api/push/config')return {ok:true,enabled:false};
  if(p==='/api/notificaciones/resumen')return {ok:true,no_leidas:0,items:[]};
  if(p==='/api/dashboard')return {ok:true,cards:{ordenes_activas:2,solicitudes_pendientes:1,emergencias:0,tecnicos_disponibles:2,equipos_disponibles:1,clientes_activos:1,finalizadas:3,documentos:1,solicitudes:1},recent:[order(1)],chart:[]};
  if(p==='/api/vacaciones/personal')return {ok:true,items:staff};
  if(p==='/api/vacaciones') {if(method==='POST'){state.vacations.push({id:state.vacations.length+1,empleado_id:12,empleado:staff[0].nombre,inicio:body.inicio,fin:body.fin,motivo:body.motivo,estado:'PENDIENTE',dias:2,solicitada:today()});return {ok:true,message:'Solicitud registrada.'};}return list(state.vacations.map(x=>({...x,Estado:x.estado})),u);}
  if(/^\/api\/vacaciones\/\d+$/.test(p)){const x=state.vacations.find(x=>x.id===Number(p.split('/').at(-1)));if(method==='PATCH')Object.assign(x,body);return {ok:true,item:x};}
  if(p==='/api/ordenes')return list(Array.from({length:105},(_,i)=>order(i+1)),u);
  if(/^\/api\/ordenes\/\d+$/.test(p))return {ok:true,item:order(Number(p.split('/').at(-1))),tecnicos:[{empleado_id:12,nombre:staff[0].nombre,puesto:'Supervisor',funcion:'ENCARGADO',estado:'ASIGNADO'}],actividades:[],incidencias:[],evidencias:[],equipos:[],cambios:[],cambios_alcance:[],cotizaciones:[],reglas_cierre:{ticket_requerido:false}};
  if(p==='/api/solicitudes')return list([{id:1,cliente:'Cliente de prueba',sede:'Sede Central',tipo:'Drenajes',descripcion:'Servicio programado',Estado:'RECIBIDA',clasificacion:'PROGRAMADO',urgencia:'MEDIA',creada:today()}],u);
  if(p==='/api/personal')return list(staff,u,{resumen:{total:2,activos:2,disponibles:2,asignados:0,vacaciones:0},facetas:{puesto:['Supervisor','Operario'],estado:['ACTIVO'],disponibilidad:['DISPONIBLE']}});
  if(/^\/api\/personal\/\d+$/.test(p))return {ok:true,item:{...staff[0],nombres:'Empleado',apellidos:'Supervisor',ingreso:'2024-01-01',contratacion:'INDEFINIDO'}};
  if(p==='/api/equipos')return list([{id:1,codigo:'E-1',nombre:'Bomba',categoria:'BOMBA',estado:'DISPONIBLE',activo:true,fallas_abiertas:0}],u,{resumen:{total:1,disponibles:1}});
  if(p==='/api/equipos/1')return {ok:true,item:{EquipoId:1,Nombre:'Bomba',CodigoEquipo:'E-1',Activo:true,Estado:'DISPONIBLE'},fallas:[],inspecciones:[],mantenimientos:[]};
  if(p==='/api/mantenimientos')return list([{id:1,equipo:'Bomba',codigo_equipo:'E-1',tipo:'PREVENTIVO',estado:'PROGRAMADO'}],u,{resumen:{total:1,programados:1}});
  if(p==='/api/mantenimientos/1')return {ok:true,item:{MantenimientoEquipoId:1,Equipo:'Bomba',Estado:'PROGRAMADO',TipoMantenimiento:'PREVENTIVO',EjecutadoPorEmpleadoId:12},repuestos:[]};
  if(p==='/api/catalogo-maestro')return list([{id:'custom:8',concepto_id:8,codigo:'C8',nombre:'Limpieza',descripcion:'Limpieza',unidad:'Servicio',precio:100,activo:true}],u);
  if(p==='/api/cotizaciones'){if(method==='POST'){state.quotes.push(body);return {ok:true,item:{id:7}};}return list(state.quotes.map((x,i)=>({id:i+7,numero:'COT-'+(i+7),orden:'OT-001',cliente:'Cliente de prueba',estado:'BORRADOR',version:1,total:100})),u);}
  if(p==='/api/cotizaciones/7/detalle')return quoteDetail();
  if(p==='/api/cancelaciones'){if(method==='POST'){state.cancellations.push({id:1,...body,estado:'PENDIENTE',numero:'Solicitud 1',cliente:'Cliente de prueba',solicitada:today()});return {ok:true};}return list(state.cancellations.filter(x=>!u.searchParams.get('estado')||x.estado===u.searchParams.get('estado')),u);}
  if(p==='/api/cancelaciones/1'&&method==='PATCH'){Object.assign(state.cancellations[0],body,{resolucion:body.observaciones});return {ok:true};}
  if(p==='/api/produccion'||/^\/api\/produccion\/\d+$/.test(p))return {ok:true,items:[],resumen:{ordenes_unicas:0,participaciones:0},desde:u.searchParams.get('desde'),hasta:u.searchParams.get('hasta'),nota_horas:'La duración de la OT no representa horas pagables.',total:0,pagina:1,paginas:1};
  if(p==='/api/agenda-operativa/guardar'){if(state.conflict)return {ok:false,message:'Conflicto de horario.',__status:409};const c=body.cambios[0];state.agendaTarget=c.empleado_destino||12;state.agendaMinute=Number(c.programada_para.slice(11,13))*60+Number(c.programada_para.slice(14,16));return {ok:true};}
  if(p==='/api/agenda-operativa')return {ok:true,fecha:today(),hoy:today(),ahora:today()+'T08:00:00-06:00',editable:role==='COORDINADOR',resumen:{tecnicos:2,ordenes:1,emergencias:0},tecnicos:staff.map(x=>({...x,ordenes:x.id===state.agendaTarget?[{...order(1),minuto:state.agendaMinute,programada_version:today()+'T15:00:00Z',integrantes:1}]:[]}))};
  if(p==='/api/garantias')return {ok:true,items:[],solicitudes:[],resumen:{}};
  if(p==='/api/usuarios/catalogos')return {ok:true,roles:[],empleados:staff,contactos:[]};
  if(p==='/api/usuarios')return {ok:true,items:[],pagination:{total:0,pagina:1,paginas:1},summary:{}};
  if(p==='/api/roles-accesos')return {ok:true,roles:[],modulos:[],permisos:[]};
  if(p==='/api/documentos-laborales/catalogos')return {ok:true,empleados:staff,tipos:[]};
  if(p==='/api/cuenta')return {ok:true,item:{nombre:'Usuario de prueba',usuario:'prueba',puesto:profile}};
  return list([],u);
 }
 return {state,handle};
}
module.exports={backend,today};
